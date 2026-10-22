/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { dirname, isEqual, isEqualOrParent, joinPath, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandEvent, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IChecksumService } from '../../../../../platform/checksum/common/checksumService.js';
import { FileSystemProviderCapabilities, IFileChange, IFileService, IWatchOptions } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { IUndoRedoElement, IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasFile } from '../../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfMirrorRoot } from '../../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfModelCredentialStore } from '../../common/basehalfModelCredentialStore.js';
import {
	BASEHALF_VIDEO_PROVIDER_COMMANDS,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoDownloadRequest,
	IBaseHalfVideoSubmitRequest,
	IBaseHalfVideoTaskRef
} from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfDraftMoveOptions, IBaseHalfDraftOperations, IBaseHalfDraftSnapshot, IBaseHalfGenerationTaskStore } from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfReferenceEditOptions, IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService, IBaseHalfReferenceStoreEdit, IBaseHalfReferenceStoreResult } from '../../../references/common/basehalfReferenceEdit.js';
import { baseHalfSidecarUpstreamText, baseHalfUpstreamSidecarResource } from '../../../references/common/basehalfReferenceStore.js';
import { ACME, BOREALIS } from '../common/basehalfVideoCatalogFixture.js';

/** The first bytes of an MP4: a `ftyp` box. */
export const FAKE_MP4 = VSBuffer.wrap(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32]));
/** The first bytes of a PNG: its signature and the start of its header. */
export const FAKE_PNG = VSBuffer.wrap(Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]));
/** The first bytes of a JPEG. */
export const FAKE_JPEG = VSBuffer.wrap(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]));

export class InMemoryCredentialStore implements IBaseHalfModelCredentialStore {
	declare readonly _serviceBrand: undefined;
	readonly values = new Map<string, string>();

	async get(key: string): Promise<string | undefined> {
		return this.values.get(key);
	}

	async set(key: string, value: string): Promise<void> {
		this.values.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
	}
}

/**
 * An in-memory file system that writes whole files (the in-memory
 * provider's open, write, and close path does not truncate) and whose
 * watchers correlate their events as the watcher of the disk does: a change
 * under a watch request with a correlation id is reported once more with
 * that id, to that watcher alone. Every window of a test that shares it sees
 * the changes the others make.
 */
export class BaseHalfTestFileSystemProvider extends InMemoryFileSystemProvider {
	private readonly providerChanges: Event<readonly IFileChange[]> = this.onDidChangeFile;
	private readonly changes = this._register(new Emitter<readonly IFileChange[]>());
	override readonly onDidChangeFile: Event<readonly IFileChange[]> = this.changes.event;
	private readonly watches = new Set<{ readonly resource: URI; readonly recursive: boolean; readonly correlationId: number }>();

	constructor() {
		super();
		this._register(this.providerChanges(changes => {
			this.changes.fire(changes);
			for (const watch of [...this.watches]) {
				const seen = changes.filter(change => watch.recursive
					? isEqualOrParent(change.resource, watch.resource)
					: isEqual(change.resource, watch.resource) || isEqual(dirname(change.resource), watch.resource));
				if (seen.length) {
					this.changes.fire(seen.map(change => ({ type: change.type, resource: change.resource, cId: watch.correlationId })));
				}
			}
		}));
	}

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities & ~FileSystemProviderCapabilities.FileOpenReadWriteClose;
	}

	override watch(resource: URI, options: IWatchOptions): IDisposable {
		if (typeof options.correlationId !== 'number') {
			return Disposable.None;
		}
		const watch = { resource, recursive: options.recursive, correlationId: options.correlationId };
		this.watches.add(watch);
		return toDisposable(() => this.watches.delete(watch));
	}
}

/**
 * A digest of 32 bytes in the form of the checksum service of the shared
 * process, base64 without padding. It is no SHA-256: the generation service
 * only compares the digests it got from the same service, and a digest made
 * here without a host promise keeps the faked timers of a test in order.
 */
export class TestChecksumService implements IChecksumService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly fileService: IFileService) { }

	async checksum(resource: URI): Promise<string> {
		return encodeBase64(VSBuffer.wrap(testDigest((await this.fileService.readFile(resource)).value.buffer))).replace(/=+$/, '');
	}
}

/** The digest of {@link TestChecksumService}: 32 bytes. */
export function testDigest(bytes: Uint8Array): Uint8Array {
	const digest = new Uint8Array(32);
	bytes.forEach((byte, index) => {
		const at = index % 32;
		digest[at] = (digest[at] * 31 + byte + index) & 0xFF;
	});
	digest[31] ^= bytes.length & 0xFF;
	return digest;
}

/** The digest of {@link TestChecksumService} as the generation service writes it into a record: lower-case hex. */
export function testDigestHex(bytes: VSBuffer): string {
	return [...testDigest(bytes.buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The undo stack of a test: what was pushed, in order. */
export class RecordingUndoRedoService {
	readonly elements: IUndoRedoElement[] = [];

	asService(): IUndoRedoService {
		const service: Partial<IUndoRedoService> = { pushElement: (element: IUndoRedoElement) => { this.elements.push(element); } };
		return service as IUndoRedoService;
	}
}

/** The layouts of the canvases of a test, by folder path: what was placed where. */
export class RecordingCanvasMirror {
	readonly layouts = new Map<string, IBaseHalfCanvasCard[]>();

	constructor(private readonly root: URI) { }

	place(folder: string, card: IBaseHalfCanvasCard): void {
		const cards = this.layouts.get(folder) ?? [];
		this.layouts.set(folder, [...cards.filter(existing => existing.path !== card.path), card]);
	}

	asService(): IBaseHalfCanvasMirrorService {
		const layout = (folder: IBaseHalfCanvasFolderState): IBaseHalfCanvasFile | null => {
			const cards = this.layouts.get(folder.relativePath);
			return cards ? { path: folder.relativePath, cards, edges: [] } : null;
		};
		const service: Partial<IBaseHalfCanvasMirrorService> = {
			readCanvas: async (folder: IBaseHalfCanvasFolderState) => layout(folder),
			updateCardGeometries: async (folder: IBaseHalfCanvasFolderState, cards: readonly IBaseHalfCanvasCard[]) => {
				for (const card of cards) {
					this.place(folder.relativePath, card);
				}
				return layout(folder);
			},
			canvasResource: (folder: IBaseHalfCanvasFolderState) => joinPath(baseHalfMirrorRoot(this.root), ...folder.relativePath.split('/').filter(Boolean), 'canvas.yaml')
		};
		return service as IBaseHalfCanvasMirrorService;
	}
}

/**
 * Draft operations over the file system of a test, as the canvas does them:
 * a move takes the draft's card information along and writes its new path
 * into the task records; a delete removes it and gives back its bytes.
 */
export class FakeDraftOperations implements IBaseHalfDraftOperations {
	declare readonly _serviceBrand: undefined;
	readonly moves: string[] = [];
	/** For each move, whether the caller held the workspace mutation lease and passed it. */
	readonly leased: boolean[] = [];
	readonly deleted: string[] = [];
	taskStore: IBaseHalfGenerationTaskStore | undefined;

	constructor(private readonly fileService: IFileService, private readonly root: URI) { }

	async move(draft: URI, target: URI, options?: IBaseHalfDraftMoveOptions): Promise<URI> {
		await this.fileService.move(this.mirror(draft), this.mirror(target), false);
		await this.taskStore?.retarget(draft, target);
		this.moves.push(`${this.path(draft)} -> ${this.path(target)}`);
		this.leased.push(!!options?.lease);
		return target;
	}

	async delete(draft: URI): Promise<IBaseHalfDraftSnapshot> {
		const files = new Map<string, Uint8Array>();
		const stat = await this.fileService.resolve(this.mirror(draft));
		for (const child of stat.children ?? []) {
			files.set(child.name, (await this.fileService.readFile(child.resource)).value.buffer);
		}
		await this.fileService.del(this.mirror(draft), { recursive: true, useTrash: false });
		this.deleted.push(this.path(draft));
		return { resource: draft, files };
	}

	async restore(snapshot: IBaseHalfDraftSnapshot): Promise<void> {
		for (const [name, bytes] of snapshot.files) {
			await this.fileService.createFile(joinPath(this.mirror(snapshot.resource), name), VSBuffer.wrap(bytes));
		}
	}

	private mirror(resource: URI): URI {
		return joinPath(baseHalfMirrorRoot(this.root), ...this.path(resource).split('/'));
	}

	private path(resource: URI): string {
		return relativePath(this.root, resource)!;
	}
}

/**
 * The reference edit service as a draft that is being made uses it: an
 * `append` writes the entries into the node's `upstream.yaml`, and a
 * `transition` writes the entries it goes to, removing the file for none.
 * Every edit and its options are kept.
 */
export class FakeReferenceEditService {
	readonly edits: { readonly edit: IBaseHalfReferenceStoreEdit; readonly options: IBaseHalfReferenceEditOptions }[] = [];

	constructor(private readonly fileService: IFileService) { }

	asService(): IBaseHalfReferenceEditService {
		const service: Partial<IBaseHalfReferenceEditService> = { apply: (edits: readonly IBaseHalfReferenceStoreEdit[], options: IBaseHalfReferenceEditOptions) => this.apply(edits, options) };
		return service as IBaseHalfReferenceEditService;
	}

	private async apply(edits: readonly IBaseHalfReferenceStoreEdit[], options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult> {
		const stores: IBaseHalfReferenceStoreResult[] = [];
		for (const edit of edits) {
			this.edits.push({ edit, options });
			const resource = baseHalfUpstreamSidecarResource(edit.node.workspaceFolder, edit.node.relativePath);
			const before = await this.fileService.readFile(resource).then((content): string[] => content.value.toString().split('\n').flatMap(line => line.startsWith('  - ') ? [line.slice(4)] : []), (): string[] => []);
			const operation = edit.operation;
			const after = operation.kind === 'append' ? [...before, ...operation.entries.filter(entry => !before.includes(entry))]
				: operation.kind === 'transition' ? operation.to.items.map(item => item.text)
					: before;
			const changed = after.join('\n') !== before.join('\n');
			if (changed && after.length) {
				await this.fileService.writeFile(resource, VSBuffer.fromString(baseHalfSidecarUpstreamText(after)));
			} else if (changed) {
				await this.fileService.del(resource);
			}
			const snapshot = (entries: readonly string[]) => ({ items: entries.map(text => ({ text, scalar: true })) });
			stores.push({ node: edit.node, storeKind: 'sidecar', storeResource: resource, outcome: changed ? 'changed' : 'unchanged', expected: snapshot(before), next: snapshot(after) });
		}
		return { stores, changed: stores.some(store => store.outcome === 'changed') };
	}
}

type Handler<T> = (argument: T) => Promise<unknown> | unknown;

/**
 * The provider commands of the AI Video extension, scripted, with the test
 * catalog of invented providers. The default check finds no problem, the
 * default submit makes a task, and the default download writes an MP4, or a
 * PNG for an image, where it is asked to.
 */
export class FakeProviderCommands implements ICommandService {
	declare readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly onDidExecuteCommand: Event<ICommandEvent> = Event.None;

	readonly calls: { readonly id: string; readonly argument: unknown }[] = [];
	catalog: Handler<unknown> = () => ({ ok: true, value: { schema: 1, providers: [ACME, BOREALIS] } });
	check: Handler<IBaseHalfVideoCheckRequest> = () => ({ ok: true, value: { problems: [] } });
	submit: Handler<IBaseHalfVideoSubmitRequest> = () => ({ ok: true, value: { remoteId: 'cgt-remote-1' } });
	poll: Handler<IBaseHalfVideoTaskRef> = () => ({ ok: true, value: { state: 'succeeded', videoUrl: 'https://cdn.example.com/video.mp4' } });
	download: Handler<IBaseHalfVideoDownloadRequest>;
	cancel: Handler<IBaseHalfVideoTaskRef> = () => ({ ok: true, value: { cancelled: true } });
	other: Handler<unknown> = () => undefined;

	constructor(private readonly fileService: IFileService) {
		this.download = async request => {
			const bytes = request.kind === 'image' ? FAKE_PNG : FAKE_MP4;
			await fileService.writeFile(URI.file(request.targetFsPath), bytes);
			return { ok: true, value: { size: bytes.byteLength, format: request.kind === 'image' ? 'png' : 'mp4' } };
		};
	}

	/** Writes a file into a target, as AI Video writes a file the provider answered with. */
	async write(target: string, bytes: VSBuffer): Promise<{ readonly written: string; readonly size: number; readonly format: 'png' | 'jpeg' | 'mp4' }> {
		await this.fileService.writeFile(URI.file(target), bytes);
		return { written: target, size: bytes.byteLength, format: bytes === FAKE_JPEG ? 'jpeg' : bytes === FAKE_MP4 ? 'mp4' : 'png' };
	}

	count(id: string): number {
		return this.calls.filter(call => call.id === id).length;
	}

	async executeCommand<R = unknown>(id: string, ...args: unknown[]): Promise<R> {
		const argument = args[0];
		this.calls.push({ id, argument });
		switch (id) {
			case BASEHALF_VIDEO_PROVIDER_COMMANDS.catalog: return await this.catalog(argument) as R;
			case BASEHALF_VIDEO_PROVIDER_COMMANDS.check: return await this.check(argument as IBaseHalfVideoCheckRequest) as R;
			case BASEHALF_VIDEO_PROVIDER_COMMANDS.submit: return await this.submit(argument as IBaseHalfVideoSubmitRequest) as R;
			case BASEHALF_VIDEO_PROVIDER_COMMANDS.poll: return await this.poll(argument as IBaseHalfVideoTaskRef) as R;
			case BASEHALF_VIDEO_PROVIDER_COMMANDS.download: return await this.download(argument as IBaseHalfVideoDownloadRequest) as R;
			case BASEHALF_VIDEO_PROVIDER_COMMANDS.cancel: return await this.cancel(argument as IBaseHalfVideoTaskRef) as R;
			default: return await this.other(argument) as R;
		}
	}
}

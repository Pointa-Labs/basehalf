/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { basename, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandEvent, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IBaseHalfModelCredentialStore } from '../../common/basehalfModelCredentialStore.js';
import {
	BASEHALF_VIDEO_PROVIDER_COMMANDS,
	baseHalfVideoInputKindOfPath,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoDownloadRequest,
	IBaseHalfVideoSubmitRequest,
	IBaseHalfVideoTaskRef
} from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoNodeSnapshot, IBaseHalfVideoNodeStore, IBaseHalfVideoResolvedInput } from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoNodeFields } from '../../common/basehalfVideoNode.js';
import { ACME, BOREALIS } from '../common/basehalfVideoCatalogFixture.js';

/** The first bytes of an MP4: a `ftyp` box. */
export const FAKE_MP4 = VSBuffer.wrap(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32]));

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

interface IFakeNode {
	readonly id: string;
	readonly title: string;
	readonly path: string;
	readonly upstream: readonly string[];
	fields: IBaseHalfVideoNodeFields;
}

/**
 * A node store over plain records: what the node document reader keeps in a
 * `.bhnode`. Every write is kept, so a test can read the transitions a
 * generation made.
 */
export class FakeVideoNodeStore implements IBaseHalfVideoNodeStore {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidWrite = new Emitter<URI>();
	readonly onDidWrite: Event<URI> = this._onDidWrite.event;

	readonly nodes = new ResourceMap<IFakeNode>();
	readonly writes = new ResourceMap<IBaseHalfVideoNodeFields[]>();
	readonly inputs = new Map<string, IBaseHalfVideoResolvedInput>();
	readonly siblings: { readonly from: URI; readonly fields: IBaseHalfVideoNodeFields; readonly upstream: readonly string[] }[] = [];
	private nextId = 1;

	constructor(readonly root: URI) { }

	dispose(): void {
		this._onDidWrite.dispose();
	}

	addNode(path: string, fields: IBaseHalfVideoNodeFields, upstream: readonly string[] = [], title = basename(URI.parse(`file:///${path}`)).replace(/\.bhnode$/, '')): URI {
		const resource = joinPath(this.root, path);
		this.nodes.set(resource, { id: `node-${this.nextId++}`, title, path, upstream, fields });
		return resource;
	}

	/** An upstream entry that resolves to a file in the workspace. */
	addInput(path: string, available = true, kind = baseHalfVideoInputKindOfPath(path)): void {
		this.inputs.set(path, { path, kind, available, ...(available ? { file: joinPath(this.root, path) } : {}) });
	}

	fields(resource: URI): IBaseHalfVideoNodeFields {
		return this.require(resource).fields;
	}

	history(resource: URI): readonly IBaseHalfVideoNodeFields[] {
		return this.writes.get(resource) ?? [];
	}

	/** Changes a node the way another window or an outside edit would. */
	replace(resource: URI, fields: IBaseHalfVideoNodeFields): void {
		this.require(resource).fields = fields;
	}

	async read(resource: URI): Promise<IBaseHalfVideoNodeSnapshot> {
		return this.snapshot(resource);
	}

	async update(resource: URI, mutate: (fields: IBaseHalfVideoNodeFields) => IBaseHalfVideoNodeFields): Promise<IBaseHalfVideoNodeSnapshot> {
		const node = this.require(resource);
		const next = mutate(node.fields);
		if (next !== node.fields) {
			node.fields = next;
			const history = this.writes.get(resource) ?? [];
			history.push(next);
			this.writes.set(resource, history);
			this._onDidWrite.fire(resource);
		}
		return this.snapshot(resource);
	}

	async reorderUpstream(resource: URI, upstream: readonly string[]): Promise<IBaseHalfVideoNodeSnapshot> {
		const node = this.require(resource);
		this.nodes.set(resource, { ...node, upstream });
		return this.snapshot(resource);
	}

	async resolveInputs(snapshot: IBaseHalfVideoNodeSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]> {
		return snapshot.upstream.map(path => this.inputs.get(path) ?? { path, kind: baseHalfVideoInputKindOfPath(path), available: false });
	}

	async createSibling(resource: URI, fields: IBaseHalfVideoNodeFields, upstream: readonly string[]): Promise<URI> {
		const node = this.require(resource);
		this.siblings.push({ from: resource, fields, upstream });
		const folder = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/') + 1) : '';
		return this.addNode(`${folder}${node.title}-2.bhnode`, fields, upstream, `${node.title} 2`);
	}

	videoTarget(snapshot: IBaseHalfVideoNodeSnapshot, taskId: string): URI {
		return joinPath(this.root, 'outputs', snapshot.id, `${taskId}.mp4`);
	}

	private snapshot(resource: URI): IBaseHalfVideoNodeSnapshot {
		const node = this.require(resource);
		return { resource, path: node.path, id: node.id, title: node.title, upstream: node.upstream, fields: node.fields };
	}

	private require(resource: URI): IFakeNode {
		const node = this.nodes.get(resource);
		if (!node) {
			throw new Error(`No node at ${resource.toString()}.`);
		}
		return node;
	}
}

type Handler<T> = (argument: T) => Promise<unknown> | unknown;

/**
 * The provider commands of the AI Video extension, scripted, with the test
 * catalog of invented providers. The default check finds no problem and
 * estimates ¥1.20; the default download writes {@link FAKE_MP4} where it is
 * asked to.
 */
export class FakeProviderCommands implements ICommandService {
	declare readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly onDidExecuteCommand: Event<ICommandEvent> = Event.None;

	readonly calls: { readonly id: string; readonly argument: unknown }[] = [];
	catalog: Handler<unknown> = () => ({ ok: true, value: { schema: 1, providers: [ACME, BOREALIS] } });
	check: Handler<IBaseHalfVideoCheckRequest> = () => ({ ok: true, value: { problems: [], estimate: { currency: 'CNY', min: 1.2, max: 1.2, priceDate: '2026-10-18' } } });
	submit: Handler<IBaseHalfVideoSubmitRequest> = () => ({ ok: true, value: { remoteId: 'cgt-remote-1' } });
	poll: Handler<IBaseHalfVideoTaskRef> = () => ({ ok: true, value: { state: 'succeeded', videoUrl: 'https://cdn.example.com/video.mp4' } });
	download: Handler<IBaseHalfVideoDownloadRequest>;
	cancel: Handler<IBaseHalfVideoTaskRef> = () => ({ ok: true, value: { cancelled: true } });
	other: Handler<unknown> = () => undefined;

	constructor(fileService: IFileService) {
		this.download = async request => {
			await fileService.writeFile(URI.file(request.targetFsPath), FAKE_MP4);
			return { ok: true, value: { size: FAKE_MP4.byteLength } };
		};
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

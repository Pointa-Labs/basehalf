/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IBulkEditService } from '../../../../editor/browser/services/bulkEditService.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfirmation, IConfirmationResult, IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { createFileSystemProviderError, FileSystemProviderCapabilities, FileSystemProviderErrorCode, IFileService, IFileWriteOptions, IStat } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService, IPromptChoice, IPromptOptions, NoOpProgress, NotificationMessage, Severity } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IUndoRedoService, UndoRedoSource } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../contrib/bulkEdit/browser/bulkEditService.js';
import { IExplorerService } from '../../../contrib/files/browser/files.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { TestContextService, TestWorkingCopy } from '../../../test/common/workbenchTestServices.js';
import { BaseHalfMirrorCascadeContribution } from '../../browser/basehalfMirrorCascade.contribution.js';
import { IBaseHalfMovedItem } from '../../common/basehalfMovedItems.js';
import { IBaseHalfMovedItemsService, IBaseHalfOwedEntryMove, IBaseHalfRecognizedMoves } from '../../common/basehalfMovedItemsService.js';
import { IBaseHalfPluginStructuralDeleteCleanupService } from '../../browser/basehalfPluginStructuralDeleteCleanup.js';
import { BaseHalfReferenceEditService } from '../../browser/basehalfReferenceEditService.js';
import { BaseHalfReferenceRefactorService, IBaseHalfReferenceRefactorService } from '../../browser/basehalfReferenceRefactorService.js';
import { BaseHalfRenameRefactorContribution } from '../../browser/basehalfRenameRefactor.contribution.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../common/basehalfAdhdMirror.js';
import { BaseHalfBadgeMirrorService, IBaseHalfBadgeMirrorService } from '../../common/basehalfBadgeMirror.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../common/basehalfCanvasEditing.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasViewportStateService } from '../../common/basehalfCanvasViewportState.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { createBaseHalfNodeDocument, IBaseHalfNodeDocument, parseBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { IBaseHalfVideoGenerationService } from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfReferenceEditService } from '../../common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../common/basehalfReferenceIndex.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';
import { BaseHalfInMemoryFileSearchService, baseHalfNoMovedItems } from './basehalfReferenceTestFixtures.js';

/** What BaseHalf last saw, reduced to what the entries of a move need: the moves that are owed, and the items it followed. */
class TestMovedItems {
	owed: IBaseHalfOwedEntryMove[] = [];
	private readonly _onDidRelocate = new Emitter<IBaseHalfRecognizedMoves>();
	readonly service: IBaseHalfMovedItemsService = {
		...baseHalfNoMovedItems,
		onDidRelocate: this._onDidRelocate.event,
		getOwedEntryMoves: () => this.owed,
		setOwedEntryMoves: (_workspaceFolder, moves) => { this.owed = [...moves]; }
	};

	/** The card information of items that were moved outside BaseHalf has followed them. */
	relocated(moves: IBaseHalfMovedItem[]): void {
		this._onDidRelocate.fire({ workspaceFolder: folder, moves });
	}

	dispose(): void {
		this._onDidRelocate.dispose();
	}
}

const folder = URI.file('/work');

/** Whole-file writes: the in-memory open/write/close path does not truncate. */
class TestFileSystemProvider extends InMemoryFileSystemProvider {
	/** When set, a read of a file waits for the promise it returns. */
	readGate: ((resource: URI) => Promise<void> | undefined) | undefined;

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities & ~FileSystemProviderCapabilities.FileOpenReadWriteClose;
	}

	/** When set, a write of a file it accepts is refused by the file system. */
	refuseWrite: ((resource: URI) => boolean) | undefined;

	override async readFile(resource: URI): Promise<Uint8Array> {
		await this.readGate?.(resource);
		return super.readFile(resource);
	}

	override async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		this.refuse(resource);
		return super.writeFile(resource, content, opts);
	}

	override async writeFileExclusiveAtomic(resource: URI, content: Uint8Array): Promise<IStat> {
		this.refuse(resource);
		return super.writeFileExclusiveAtomic(resource, content);
	}

	private refuse(resource: URI): void {
		if (this.refuseWrite?.(resource)) {
			throw createFileSystemProviderError('The file system refused the write.', FileSystemProviderErrorCode.NoPermissions);
		}
	}
}

/** A shown prompt. Closing it without a choice runs `onCancel`, as the workbench does. */
class RecordedPrompt implements INotificationHandle {
	readonly progress = new NoOpProgress();
	private readonly _onDidClose = new Emitter<void>();
	readonly onDidClose = this._onDidClose.event;
	readonly onDidChangeVisibility = Event.None;
	closed = false;

	constructor(readonly severity: Severity, public message: string, readonly choices: IPromptChoice[], private readonly options: IPromptOptions | undefined) { }

	updateSeverity(): void { }
	updateMessage(message: NotificationMessage): void {
		this.message = String(message);
	}
	updateActions(): void { }

	close(): void {
		if (!this.closed) {
			this.closed = true;
			this.options?.onCancel?.();
			this._onDidClose.fire();
			this._onDidClose.dispose();
		}
	}

	/** Runs a choice the way a notification button does: it closes without `onCancel`. */
	async choose(label: string): Promise<void> {
		const choice = this.choices.find(candidate => candidate.label === label);
		assert.ok(choice, `No choice "${label}" in: ${this.choices.map(candidate => candidate.label).join(', ')}`);
		this.closed = true;
		this._onDidClose.dispose();
		await choice.run();
	}
}

class RecordingNotificationService extends TestNotificationService {
	readonly prompts: RecordedPrompt[] = [];
	/** Every notification that is not a prompt: "nothing is shown" has to mean these too. */
	readonly notified: string[] = [];

	override notify(notification: INotification): INotificationHandle {
		this.notified.push(String(notification.message));
		return super.notify(notification);
	}

	override prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		const prompt = new RecordedPrompt(severity, message, choices, options);
		this.prompts.push(prompt);
		return prompt;
	}
}

class RecordingDialogService implements Partial<IDialogService> {
	readonly confirmations: IConfirmation[] = [];
	answer = true;

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.confirmations.push(confirmation);
		return { confirmed: this.answer };
	}
}

interface IHarness {
	readonly fileService: IFileService;
	readonly provider: TestFileSystemProvider;
	readonly flush: IBaseHalfEditorFlushService;
	readonly notifications: RecordingNotificationService;
	readonly dialogs: RecordingDialogService;
	readonly refactor: IBaseHalfReferenceRefactorService;
	readonly undoRedo: IUndoRedoService;
	readonly movedItems: TestMovedItems;
	/** A document was saved. */
	documentSaved(): void;
	move(from: string, to: string, isUndoing?: boolean): Promise<void>;
	/** A permanent workbench delete (the harness has no trash). */
	delete(path: string): Promise<void>;
	/** The prompt whose message contains `text`, once it is shown. */
	prompt(text: string): Promise<RecordedPrompt>;
	read(path: string): Promise<string | undefined>;
	/** Every workspace file below the folder with its text (`.bh/cache` left out). */
	tree(): Promise<Record<string, string>>;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>, options: { readonly generating?: readonly string[]; readonly partialIndex?: boolean } = {}): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	const provider = disposables.add(new TestFileSystemProvider());
	disposables.add(fileService.registerProvider(Schemas.file, provider));
	await fileService.createFolder(folder);
	for (const [path, content] of Object.entries(files)) {
		await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
	}
	await timeout(20);
	const configuration = new TestConfigurationService({ files: { autoSave: 'afterDelay', enableTrash: false, exclude: { hidden: true } } });
	const instantiationService = workbenchInstantiationService({ fileService: () => fileService, configurationService: () => configuration }, disposables);
	instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(folder)));
	instantiationService.stub(ISearchService, new BaseHalfInMemoryFileSearchService(fileService));
	const bulkEdit = instantiationService.createInstance(BulkEditService);
	instantiationService.stub(IBulkEditService, bulkEdit);
	const explorerUndoSource = new UndoRedoSource();
	instantiationService.stub(IExplorerService, {
		applyBulkEdit: async (edits, options) => {
			await bulkEdit.apply(edits, { undoRedoSource: explorerUndoSource, undoRedoGroup: options.undoRedoGroup, label: options.undoLabel, code: 'undoredo.explorerOperation', confirmBeforeUndo: options.confirmBeforeUndo });
		}
	} as Partial<IExplorerService> as IExplorerService);
	const flush = new BaseHalfEditorFlushService();
	instantiationService.stub(IBaseHalfEditorFlushService, flush);
	instantiationService.stub(IBaseHalfWorkspaceMutationCoordinator, new BaseHalfWorkspaceMutationCoordinator());
	const notifications = new RecordingNotificationService();
	instantiationService.stub(INotificationService, notifications);
	const dialogs = new RecordingDialogService();
	instantiationService.stub(IDialogService, dialogs as Partial<IDialogService> as IDialogService);
	instantiationService.stub(IBaseHalfCanvasNavigationService, {
		state: { canvasFolder: undefined, cardDetail: undefined },
		activeCanvasEditor: undefined,
		openCardDetail: async () => ({ handled: false, reason: 'unsupportedResource' })
	} as Partial<IBaseHalfCanvasNavigationService> as IBaseHalfCanvasNavigationService);
	const index = disposables.add(instantiationService.createInstance(BaseHalfReferenceIndexService));
	instantiationService.stub(IBaseHalfReferenceIndexService, index);
	instantiationService.stub(IBaseHalfAdhdMirrorService, disposables.add(instantiationService.createInstance(BaseHalfAdhdMirrorService)));
	instantiationService.stub(IBaseHalfReferenceEditService, disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService)));
	instantiationService.stub(IBaseHalfBadgeMirrorService, disposables.add(new BaseHalfBadgeMirrorService(fileService)));
	instantiationService.stub(IBaseHalfCanvasMirrorService, disposables.add(instantiationService.createInstance(BaseHalfCanvasMirrorService)));
	instantiationService.stub(IBaseHalfCanvasViewportStateService, { forgetSubtree: () => { }, moveSubtree: () => { } } as Partial<IBaseHalfCanvasViewportStateService> as IBaseHalfCanvasViewportStateService);
	instantiationService.stub(IBaseHalfVideoGenerationService, {
		onDidChangeProgress: Event.None,
		isGenerating: (resource: URI) => (options.generating ?? []).some(path => resource.path === joinPath(folder, ...path.split('/')).path)
	} as Partial<IBaseHalfVideoGenerationService> as IBaseHalfVideoGenerationService);
	instantiationService.stub(IBaseHalfPluginStructuralDeleteCleanupService, { stageDelete: async () => [] } as Partial<IBaseHalfPluginStructuralDeleteCleanupService> as IBaseHalfPluginStructuralDeleteCleanupService);
	const refactor = instantiationService.createInstance(BaseHalfReferenceRefactorService);
	if (options.partialIndex) {
		refactor.whenIndexReady = async () => 'partial';
	}
	instantiationService.stub(IBaseHalfReferenceRefactorService, refactor);
	await index.whenReady(folder);
	const movedItems = disposables.add(new TestMovedItems());
	instantiationService.stub(IBaseHalfMovedItemsService, movedItems.service);
	disposables.add(instantiationService.createInstance(BaseHalfMirrorCascadeContribution));
	disposables.add(instantiationService.createInstance(BaseHalfRenameRefactorContribution));
	const workingCopyFileService = instantiationService.get(IWorkingCopyFileService);
	const read = async (path: string) => {
		try {
			return (await fileService.readFile(joinPath(folder, ...path.split('/')))).value.toString();
		} catch {
			return undefined;
		}
	};
	return {
		fileService,
		provider,
		flush,
		notifications,
		dialogs,
		refactor,
		undoRedo: instantiationService.get(IUndoRedoService),
		movedItems,
		documentSaved: () => {
			const document = new TestWorkingCopy(joinPath(folder, 'saved.md'));
			const registration = instantiationService.get(IWorkingCopyService).registerWorkingCopy(document);
			document.setDirty(true);
			document.setDirty(false);
			registration.dispose();
			document.dispose();
		},
		async delete(path) {
			await workingCopyFileService.delete([{ resource: joinPath(folder, ...path.split('/')), recursive: true }], CancellationToken.None);
		},
		async move(from, to, isUndoing) {
			await workingCopyFileService.move([{ file: { source: joinPath(folder, ...from.split('/')), target: joinPath(folder, ...to.split('/')) } }], CancellationToken.None, isUndoing ? { isUndoing } : undefined);
		},
		async prompt(text) {
			await until(() => notifications.prompts.some(prompt => prompt.message.includes(text)), `no prompt containing "${text}": ${JSON.stringify(notifications.prompts.map(prompt => prompt.message))}`);
			return notifications.prompts.find(prompt => prompt.message.includes(text))!;
		},
		read,
		async tree() {
			const out: Record<string, string> = {};
			const stack = [folder];
			while (stack.length) {
				const stat = await fileService.resolve(stack.pop()!);
				for (const child of stat.children ?? []) {
					const path = getRelativePath(folder, child.resource)!;
					if (child.isDirectory) {
						if (path !== '.bh/cache') {
							stack.push(child.resource);
						}
					} else {
						out[path] = (await read(path)) ?? '';
					}
				}
			}
			return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)));
		}
	};
}

async function until(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
	for (let attempt = 0; attempt < 400; attempt++) {
		if (await condition()) {
			return;
		}
		await timeout(5);
	}
	assert.fail(message);
}

function nodeDocument(id: number, upstream: string[], task?: IBaseHalfNodeDocument['task']): string {
	return serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(id),
		kind: 'video',
		title: 'Clip',
		upstream,
		...(task ? { task } : {})
	}));
}

function upstreamOf(text: string | undefined): { upstream: unknown; task: unknown } {
	const document = parseBaseHalfNodeDocument(text ?? '');
	return { upstream: document.upstream, task: document.task?.state };
}

suite('BaseHalfRenameRefactor (workbench moves)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a move updates every store it may write, without asking and without a message, and adds no undo step of its own', async () => {
		const fixture: Record<string, string> = {
			'docs/a.md': '# A\n',
			'docs/b.md': '---\nupstream:\n  - docs/a.md\n---\n# B\n',
			'notes.md': '---\ntitle: Notes\nupstream:\n  - docs/a.md\n  - docs\n  - other.md\n---\n# Notes\n',
			'other.md': '# Other\n',
			'hidden/h.md': '---\nupstream: [docs/a.md]\n---\n',
			'pic.png': 'png',
			'.bh/mirror/pic.png/upstream.yaml': 'upstream:\n  - docs\n',
			'clip.bhnode': nodeDocument(1, ['docs/a.md', 'other.md']),
			'generating.bhnode': nodeDocument(2, ['docs/a.md'], {
				id: 'task-1',
				state: 'running',
				startedAt: '2026-10-15T08:00:00.000Z',
				channel: 'ark-1',
				remoteId: 'cgt-1',
				request: { provider: 'ark', model: 'seedance', prompt: '', inputs: ['docs/a.md'], mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true }
			})
		};
		const harness = await createHarness(disposables, fixture, { generating: ['generating.bhnode'] });
		const before = await harness.tree();

		await harness.move('docs', 'archive');
		await until(async () => (await harness.read('notes.md'))?.includes('archive/a.md') === true && (await harness.read('generating.bhnode'))?.includes('archive/a.md') === true, 'the entries were not updated after the move');
		const updated = await harness.tree();

		assert.deepStrictEqual({
			shown: [...harness.notifications.prompts.map(prompt => prompt.message), ...harness.notifications.notified],
			undoStep: harness.undoRedo.canUndo(BASEHALF_CANVAS_UNDO_REDO_SOURCE),
			owed: harness.movedItems.owed,
			files: {
				'archive/b.md': updated['archive/b.md'],
				'notes.md': updated['notes.md'],
				'hidden/h.md': updated['hidden/h.md'],
				'.bh/mirror/pic.png/upstream.yaml': updated['.bh/mirror/pic.png/upstream.yaml'],
				clip: upstreamOf(updated['clip.bhnode']),
				generating: upstreamOf(updated['generating.bhnode'])
			}
		}, {
			shown: [],
			undoStep: false,
			owed: [],
			files: {
				'archive/b.md': '---\nupstream:\n  - archive/a.md\n---\n# B\n',
				'notes.md': '---\ntitle: Notes\nupstream:\n  - archive/a.md\n  - archive\n  - other.md\n---\n# Notes\n',
				'hidden/h.md': '---\nupstream:\n  - archive/a.md\n---\n',
				'.bh/mirror/pic.png/upstream.yaml': 'upstream:\n  - archive\n',
				clip: { upstream: ['archive/a.md', 'other.md'], task: undefined },
				// A node that is generating is written at once; its task stays.
				generating: { upstream: ['archive/a.md'], task: 'running' }
			}
		});

		// Undoing the move is a move back, which updates the entries back.
		await harness.move('archive', 'docs', true);
		const restored = ['notes.md', '.bh/mirror/pic.png/upstream.yaml', 'clip.bhnode', 'generating.bhnode'];
		await until(async () => (await harness.read('notes.md')) === before['notes.md'], 'moving the folder back did not update the entries back');
		const undone = await harness.tree();
		assert.deepStrictEqual({
			// The flow list comes back as a block list.
			undone: [undone['docs/b.md'], undone['hidden/h.md'], ...restored.map(path => undone[path] === before[path])],
			shown: harness.notifications.prompts.length
		}, {
			undone: ['---\nupstream:\n  - docs/a.md\n---\n# B\n', '---\nupstream:\n  - docs/a.md\n---\n', true, true, true, true],
			shown: 0
		});
	});

	test('a marked folder is never rewritten by itself, and a move outside the workbench is updated once BaseHalf has followed it', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const marked = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note, '.basehalf-no-workspace-setup': '' });
		await marked.move('a.md', 'b.md');
		await timeout(80);

		// Renamed with the file system: nothing happens until the card information followed.
		const outside = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note, 'p.pdf': 'pdf', '.bh/mirror/p.pdf/upstream.yaml': 'upstream:\n  - a.md\n' });
		await outside.fileService.move(joinPath(folder, 'a.md'), joinPath(folder, 'b.md'));
		await timeout(80);
		const beforeFollowed = await outside.read('n.md');
		outside.movedItems.relocated([{ from: 'a.md', to: 'b.md', kind: 'file', rule: 'sameContent' }]);
		await until(async () => (await outside.read('n.md'))?.includes('b.md') === true, 'the entries of an item that was moved outside were not updated');

		assert.deepStrictEqual({
			marked: [await marked.read('n.md'), marked.notifications.prompts.length, marked.movedItems.owed],
			outside: [beforeFollowed, await outside.read('n.md'), await outside.read('.bh/mirror/p.pdf/upstream.yaml'), outside.notifications.prompts.length, outside.movedItems.owed]
		}, {
			marked: [note, 0, []],
			outside: [note, '---\nupstream:\n  - b.md\n---\n# N\n', 'upstream:\n  - b.md\n', 0, []]
		});
	});

	test('a move updates and carries the list BaseHalf keeps for a note that cannot hold one', async () => {
		const quote = '---\nA quote.\n---\nBody\n';
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'quote.md': quote,
			'.bh/mirror/quote.md/upstream.yaml': 'upstream:\n  - a.md\n'
		});
		// The node the list names moves, and then the note itself.
		await harness.move('a.md', 'docs/b.md');
		await until(async () => (await harness.read('.bh/mirror/quote.md/upstream.yaml'))?.includes('docs/b.md') === true, 'the kept list was not updated');
		await harness.move('quote.md', 'notes/quote.md');
		await until(async () => (await harness.read('.bh/mirror/notes/quote.md/upstream.yaml')) !== undefined, 'the kept list did not move with its note');
		const tree = await harness.tree();
		assert.deepStrictEqual({
			old: tree['.bh/mirror/quote.md/upstream.yaml'] ?? null,
			kept: tree['.bh/mirror/notes/quote.md/upstream.yaml'],
			note: tree['notes/quote.md'],
			shown: harness.notifications.prompts.length
		}, {
			old: null,
			kept: 'upstream:\n  - docs/b.md\n',
			note: quote,
			shown: 0
		});
	});

	test('a workbench move or permanent delete leaves no empty directory at the old mirror path, but keeps tombstones, siblings, and marked folders', async () => {
		const files = {
			'docs/x.md': '# X\n',
			'docs/sub/y.md': '# Y\n',
			'z.md': '# Z\n',
			'p.pdf': 'pdf',
			'q.md': '# Q\n',
			'.bh/mirror/docs/badge.yaml': 'path: "docs"\nkind: folder\n',
			'.bh/mirror/docs/sub/y.md/badge.yaml': 'path: "docs/sub/y.md"\nkind: file\n',
			'.bh/mirror/z.md/badge.yaml': 'path: "z.md"\nkind: file\ndescription: "Z"\n',
			'.bh/mirror/z.md/appearance.yaml': 'color: blue\n',
			'.bh/mirror/p.pdf/upstream.yaml': 'upstream:\n  - q.md\n',
			'.bh/mirror/q.md/badge.yaml': 'path: "q.md"\nkind: file\ndescription: "Q"\n'
		};
		const harness = await createHarness(disposables, files);
		await harness.move('docs', 'papers');
		await harness.move('z.md', 'papers/z.md');
		await harness.delete('p.pdf');
		await harness.delete('q.md');
		const exists = (path: string) => harness.fileService.exists(joinPath(folder, '.bh', 'mirror', ...path.split('/')));
		await until(async () => !await exists('docs') && !await exists('z.md') && !await exists('p.pdf'), 'empty mirror directories remained at the old paths');

		const marked = await createHarness(disposables, { ...files, '.basehalf-no-workspace-setup': '' });
		await marked.move('z.md', 'y.md');
		const markedExists = (path: string) => marked.fileService.exists(joinPath(folder, '.bh', 'mirror', ...path.split('/')));

		assert.deepStrictEqual({
			moved: [await exists('papers/badge.yaml'), await exists('papers/sub/y.md/badge.yaml'), await exists('papers/z.md/badge.yaml'), await exists('papers/z.md/appearance.yaml')],
			// Retiring q.md's badge leaves a tombstone, so its directory stays.
			tombstone: (await harness.read('.bh/mirror/q.md/badge.yaml')) ?? null,
			marked: [await markedExists('z.md'), await markedExists('y.md/badge.yaml')]
		}, {
			moved: [true, true, true, true],
			tombstone: 'path: "q.md"\nkind: file\n',
			marked: [true, true]
		});
	});

	test('moves compose: an item that moves again, and an item inside a folder that moved, end where they are', async () => {
		const again = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': '---\nupstream:\n  - a.md\n---\n# N\n' });
		await again.move('a.md', 'b.md');
		await again.move('b.md', 'c.md');
		await until(async () => (await again.read('n.md'))?.includes('c.md') === true, 'the entry did not follow both moves');

		const inside = await createHarness(disposables, { 'docs/x.md': '# X\n', 'docs/y.md': '# Y\n', 'n.md': '---\nupstream:\n  - docs/x.md\n  - docs/y.md\n---\n# N\n' });
		await inside.move('docs', 'notes');
		await inside.move('notes/x.md', 'archive/x.md');
		await until(async () => (await inside.read('n.md'))?.includes('archive/x.md') === true, 'the entry did not follow the item out of its folder');

		const order = await createHarness(disposables, { 'docs/a.md': '# A\n', 'docs/c.md': '# C\n', 'n.md': '---\nupstream:\n  - docs/a.md\n  - docs/c.md\n---\n# N\n' });
		await order.move('docs/a.md', 'docs/b.md');
		await order.move('docs', 'archive');
		await until(async () => (await order.read('n.md'))?.includes('archive/b.md') === true && (await order.read('n.md'))?.includes('archive/c.md') === true, 'a rename and a move of its folder did not both reach the entries');

		assert.deepStrictEqual({
			again: await again.read('n.md'),
			inside: await inside.read('n.md'),
			order: await order.read('n.md'),
			shown: [again, inside, order].map(harness => harness.notifications.prompts.length)
		}, {
			again: '---\nupstream:\n  - c.md\n---\n# N\n',
			inside: '---\nupstream:\n  - archive/x.md\n  - notes/y.md\n---\n# N\n',
			order: '---\nupstream:\n  - archive/b.md\n  - archive/c.md\n---\n# N\n',
			shown: [0, 0, 0]
		});
	});

	test('a move that lands after the update planned and before it wrote is composed, and the update re-plans', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const run = async (next: string) => {
			const harness = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note });
			// Hold the refactor's second read of n.md: its preflight check, after
			// it read the store and found that the old path names no node.
			let release!: () => void;
			const held = new Promise<void>(resolve => release = resolve);
			let reached!: () => void;
			const reading = new Promise<void>(resolve => reached = resolve);
			let armed = true;
			let reads = 0;
			harness.provider.readGate = resource => {
				if (armed && resource.path === '/work/n.md' && ++reads === 2) {
					armed = false;
					reached();
					return held;
				}
				return undefined;
			};
			await harness.move('a.md', 'b.md');
			await reading;
			// Undo of the rename (b.md → a.md), or a further move (b.md → c.md).
			await harness.move('b.md', next, next === 'a.md');
			release();
			if (next === 'a.md') {
				await timeout(100);
			} else {
				await until(async () => (await harness.read('n.md'))?.includes(next) === true, 'the update did not re-plan');
			}
			return { note: await harness.read('n.md'), shown: harness.notifications.prompts.length };
		};

		assert.deepStrictEqual({ movedOn: await run('c.md'), undone: await run('a.md') }, {
			movedOn: { note: '---\nupstream:\n  - c.md\n---\n# N\n', shown: 0 },
			// The rename was undone: the entry names the item again, and nothing is written.
			undone: { note, shown: 0 }
		});
	});

	test('an entry in a store that cannot be written right now is owed, and is written when it can be', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'n1.md': note, 'n2.md': note });
		// An open projection of n1.md whose pending edit can't be flushed: the
		// preflight check doesn't flush, so only the write finds it.
		const blocker = harness.flush.registerDocumentFlusher(joinPath(folder, 'n1.md').toString(), async () => false);

		await harness.move('a.md', 'b.md');
		await until(async () => (await harness.read('n2.md'))?.includes('b.md') === true && harness.movedItems.owed.length > 0, 'the store that could be written was not updated');
		const blocked = { files: [await harness.read('n1.md'), await harness.read('n2.md')], owed: [...harness.movedItems.owed] };

		// The item moves again while the entry is owed: what is owed leads to where the item is now.
		await harness.move('b.md', 'c.md');
		await until(async () => (await harness.read('n2.md'))?.includes('c.md') === true, 'the second move did not update the store that could be written');
		await timeout(40);
		const owedAfterSecondMove = [...harness.movedItems.owed];

		// What blocked it is gone, and a document is saved: BaseHalf tries again by itself.
		blocker.dispose();
		harness.documentSaved();
		await until(async () => (await harness.read('n1.md'))?.includes('c.md') === true && harness.movedItems.owed.length === 0, 'the entry that was owed was not written');

		assert.deepStrictEqual({ blocked, owedAfterSecondMove, written: await harness.read('n1.md'), shown: harness.notifications.prompts.length + harness.notifications.notified.length }, {
			blocked: { files: [note, '---\nupstream:\n  - b.md\n---\n# N\n'], owed: [{ from: 'a.md', to: 'b.md' }] },
			// One thing is owed: the entry still names the first path, and it has to end at the last.
			owedAfterSecondMove: [{ from: 'a.md', to: 'c.md' }],
			written: '---\nupstream:\n  - c.md\n---\n# N\n',
			shown: 0
		});
	});

	test('a write that the file system refuses shows nothing, also when another store was written, and is tried again', async () => {
		const quote = '---\nA quote.\n---\nBody\n';
		const kept = '.bh/mirror/quote.md/upstream.yaml';
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'n.md': '---\nupstream:\n  - a.md\n---\n# N\n',
			'quote.md': quote,
			[kept]: 'upstream:\n  - a.md\n'
		});
		// The list is written to a temporary file next to it first.
		harness.provider.refuseWrite = resource => resource.path.includes(kept);

		await harness.move('a.md', 'b.md');
		await until(() => harness.movedItems.owed.length > 0, 'the move whose entry could not be written is not owed');
		await timeout(40);
		const refused = { kept: await harness.read(kept), note: await harness.read('n.md'), owed: [...harness.movedItems.owed], shown: [...harness.notifications.prompts.map(prompt => prompt.message), ...harness.notifications.notified] };

		// The file system accepts the write again, and a document is saved: BaseHalf tries again by itself.
		harness.provider.refuseWrite = undefined;
		harness.documentSaved();
		await until(async () => (await harness.read(kept))?.includes('b.md') === true && harness.movedItems.owed.length === 0, 'the entry that was owed was not written');

		assert.deepStrictEqual({ refused, shown: [...harness.notifications.prompts.map(prompt => prompt.message), ...harness.notifications.notified] }, {
			refused: { kept: 'upstream:\n  - a.md\n', note: '---\nupstream:\n  - b.md\n---\n# N\n', owed: [{ from: 'a.md', to: 'b.md' }], shown: [] },
			shown: []
		});
	});

	test('a rename that gives a node its own store moves its upstream list into the file', async () => {
		const harness = await createHarness(disposables, {
			'x.md': '# X\n',
			'notes.txt': 'text\n',
			'.bh/mirror/notes.txt/upstream.yaml': 'upstream:\n  - x.md\n'
		});
		await harness.move('notes.txt', 'notes.md');
		await until(async () => (await harness.read('notes.md'))?.startsWith('---') === true, 'the list did not move into the file');
		const moved = await harness.tree();

		assert.deepStrictEqual({ moved: [moved['notes.md'], moved['.bh/mirror/notes.md/upstream.yaml'] ?? null], shown: harness.notifications.prompts.map(prompt => prompt.message) }, {
			moved: ['---\nupstream:\n  - x.md\n---\ntext\n', null],
			shown: []
		});
	});

	test('Relink Everywhere replaces a dangling path, including entries below it, after confirmation and as one undo step', async () => {
		const n1 = '---\nupstream:\n  - old/a.md\n  - other.md\n---\n# N1\n';
		const n2 = '---\nupstream:\n  - old\n  - old/sub/b.md\n---\n# N2\n';
		const harness = await createHarness(disposables, {
			'new/a.md': '# A\n',
			'new/sub/b.md': '# B\n',
			'other.md': '# Other\n',
			'n1.md': n1,
			'n2.md': n2,
			'pic.png': 'png',
			'.bh/mirror/pic.png/upstream.yaml': 'upstream:\n  - old/a.md\n'
		});

		harness.dialogs.answer = false;
		const declined = await harness.refactor.relinkEverywhere(folder, 'old', 'new');
		const afterDecline = [await harness.read('n1.md'), await harness.read('n2.md')];
		harness.dialogs.answer = true;
		const relinked = await harness.refactor.relinkEverywhere(folder, 'old', 'new');
		const report = await harness.prompt('Relinked');
		const files = await harness.tree();
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		const undone = await harness.tree();

		assert.deepStrictEqual({
			declined,
			afterDecline,
			relinked,
			confirmation: [harness.dialogs.confirmations[1].message, harness.dialogs.confirmations[1].detail],
			report: report.message,
			files: [files['n1.md'], files['n2.md'], files['.bh/mirror/pic.png/upstream.yaml']],
			undone: [undone['n1.md'], undone['n2.md'], undone['.bh/mirror/pic.png/upstream.yaml']]
		}, {
			declined: false,
			afterDecline: [n1, n2],
			relinked: true,
			confirmation: ['Replace old with new in 3 items?', 'n1.md, n2.md, pic.png'],
			report: 'Relinked 3 items.',
			files: [
				'---\nupstream:\n  - new/a.md\n  - other.md\n---\n# N1\n',
				'---\nupstream:\n  - new\n  - new/sub/b.md\n---\n# N2\n',
				'upstream:\n  - new/a.md\n'
			],
			undone: [n1, n2, 'upstream:\n  - old/a.md\n']
		});
	});
	test('deleting a folder named 09 retires its canvas row and never stops the cascade', async () => {
		const note = '  - path: "note.md"\n    kind: file\n    x: 1\n    y: 2\n    width: 300\n    height: 220\n';
		const harness = await createHarness(disposables, {
			'09/inner.md': '# Inner\n',
			'note.md': '# Note\n',
			'.bh/mirror/canvas.yaml': `path: ""\ncards:\n${note}  - path: "09"\n    kind: folder\n    x: 3\n    y: 4\n    width: 248\n    height: 188\nedges: []\n`
		});

		await harness.delete('09');

		assert.deepStrictEqual({
			prompts: harness.notifications.prompts.map(prompt => prompt.message),
			canvas: await harness.read('.bh/mirror/canvas.yaml')
		}, {
			prompts: [],
			canvas: `path: ""\ncards:\n${note}edges: []\n`
		});
	});

	test('a move or delete completes around mirror content that cannot be read and keeps its bytes', async () => {
		const unreadable = 'path: [unterminated';
		const harness = await createHarness(disposables, {
			'docs/a.md': '# A\n',
			'gone.md': '# Gone\n',
			'.bh/mirror/canvas.yaml': unreadable,
			'.bh/mirror/docs/canvas.yaml': unreadable,
			'.bh/mirror/docs/a.md/adhd.yaml': unreadable,
			'.bh/mirror/docs/a.md/badge.yaml': 'path: "docs/a.md"\nkind: link\n',
			'.bh/mirror/gone.md/adhd.yaml': unreadable,
			'.bh/mirror/gone.md/badge.yaml': unreadable
		});

		await harness.move('docs', 'papers');
		await harness.delete('gone.md');

		assert.deepStrictEqual({
			prompts: harness.notifications.prompts.map(prompt => prompt.message),
			files: [await harness.read('docs/a.md') ?? null, await harness.read('papers/a.md'), await harness.read('gone.md') ?? null],
			mirror: [
				await harness.read('.bh/mirror/canvas.yaml'),
				await harness.read('.bh/mirror/docs/canvas.yaml'),
				await harness.read('.bh/mirror/docs/a.md/adhd.yaml'),
				await harness.read('.bh/mirror/gone.md/adhd.yaml'),
				await harness.read('.bh/mirror/gone.md/badge.yaml'),
				// A badge travels with its node; only its path line is rewritten.
				await harness.read('.bh/mirror/papers/a.md/badge.yaml')
			]
		}, {
			prompts: [],
			files: [null, '# A\n', null],
			mirror: [unreadable, unreadable, unreadable, unreadable, unreadable, 'path: "papers/a.md"\nkind: link\n']
		});
	});

	test('a metadata update the file system refuses offers Retry and Skip; Skip releases the workspace and Retry resumes', async () => {
		const badge = (path: string) => `path: "${path}"\nkind: file\ndescription: "Kept"\n`;
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'b.md': '# B\n',
			'c.md': '# C\n',
			'.bh/mirror/a.md/badge.yaml': badge('a.md'),
			'.bh/mirror/c.md/badge.yaml': badge('c.md')
		});
		// A directory where the root canvas.yaml belongs: every read of it fails
		// for a cause that no retry inside BaseHalf can cure.
		const blocker = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		await harness.fileService.createFolder(blocker);

		const deletingA = harness.delete('a.md');
		const promptA = await harness.prompt('Your change is done (delete "a.md")');
		let refusedWhilePending = '';
		await harness.delete('b.md').catch(error => { refusedWhilePending = String(error); });
		await promptA.choose('Skip');
		await deletingA;

		const deletingC = harness.delete('c.md');
		const promptC = await harness.prompt('Your change is done (delete "c.md")');
		await harness.fileService.del(blocker, { recursive: true });
		await promptC.choose('Retry');
		await deletingC;

		assert.deepStrictEqual({
			choices: promptA.choices.map(choice => choice.label),
			// Plain words and the cause; the stage and "metadata" stay in the log.
			namesCause: /Cause: \S/.test(promptA.message),
			codeWords: /metadata|canvas subtree retirement|\.bh|yaml/i.test(promptA.message),
			refusedWhilePending: /Choose Retry or Skip/.test(refusedWhilePending),
			files: [await harness.read('a.md') ?? null, await harness.read('b.md'), await harness.read('c.md') ?? null],
			// Skip dropped the stages after the failed one, so a.md's badge was
			// not retired. Retry ran them, so c.md's badge is a tombstone.
			badges: [await harness.read('.bh/mirror/a.md/badge.yaml'), await harness.read('.bh/mirror/c.md/badge.yaml')]
		}, {
			choices: ['Retry', 'Skip'],
			namesCause: true,
			codeWords: false,
			refusedWhilePending: true,
			files: [null, '# B\n', null],
			badges: [badge('a.md'), 'path: "c.md"\nkind: file\n']
		});
	});
});

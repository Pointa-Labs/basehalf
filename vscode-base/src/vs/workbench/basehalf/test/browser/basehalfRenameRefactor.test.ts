/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IBulkEditService } from '../../../../editor/browser/services/bulkEditService.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfirmation, IConfirmationResult, IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, IPromptChoice, IPromptOptions, NoOpProgress, NotificationMessage, Severity } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IUndoRedoService, UndoRedoSource } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../contrib/bulkEdit/browser/bulkEditService.js';
import { IExplorerService } from '../../../contrib/files/browser/files.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../test/common/workbenchTestServices.js';
import { BaseHalfMirrorCascadeContribution } from '../../browser/basehalfMirrorCascade.contribution.js';
import { IBaseHalfNodeExecutionService } from '../../browser/basehalfNodeExecutionService.js';
import { BaseHalfNodeRunLeaseStore } from '../../browser/basehalfNodeRunLease.js';
import { IBaseHalfPluginStructuralDeleteCleanupService } from '../../browser/basehalfPluginStructuralDeleteCleanup.js';
import { BaseHalfReferenceEditService } from '../../browser/basehalfReferenceEditService.js';
import { BaseHalfReferenceRefactorService, IBaseHalfReferenceRefactorService } from '../../browser/basehalfReferenceRefactorService.js';
import { BaseHalfRenameRefactorContribution, capAgentMoveList } from '../../browser/basehalfRenameRefactor.contribution.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../common/basehalfAdhdMirror.js';
import { BaseHalfBadgeMirrorService, IBaseHalfBadgeMirrorService } from '../../common/basehalfBadgeMirror.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../common/basehalfCanvasEditing.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasViewportStateService } from '../../common/basehalfCanvasViewportState.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { createBaseHalfNodeDocument, parseBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { IBaseHalfReferenceEditService } from '../../common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../common/basehalfReferenceIndex.js';
import { BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING, BASEHALF_WORKSPACE_AGENT_MOVE_COMMAND_ID, IBaseHalfAgentMoveResult } from '../../common/basehalfRenameRefactor.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';
import { BaseHalfInMemoryFileSearchService } from './basehalfReferenceTestFixtures.js';

const folder = URI.file('/work');

/** Whole-file writes: the in-memory open/write/close path does not truncate. */
class TestFileSystemProvider extends InMemoryFileSystemProvider {
	/** When set, a read of a file waits for the promise it returns. */
	readGate: ((resource: URI) => Promise<void> | undefined) | undefined;

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities & ~FileSystemProviderCapabilities.FileOpenReadWriteClose;
	}

	override async readFile(resource: URI): Promise<Uint8Array> {
		await this.readGate?.(resource);
		return super.readFile(resource);
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

	override prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		const prompt = new RecordedPrompt(severity, message, choices, options);
		this.prompts.push(prompt);
		return prompt;
	}
}

class RecordingConfigurationService extends TestConfigurationService {
	readonly updates: [string, unknown][] = [];

	override async updateValue(key: string, value: unknown): Promise<void> {
		this.updates.push([key, value]);
		await this.setUserConfiguration(key, value);
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
	readonly configuration: RecordingConfigurationService;
	readonly dialogs: RecordingDialogService;
	readonly refactor: IBaseHalfReferenceRefactorService;
	readonly undoRedo: IUndoRedoService;
	/** The undo source of Explorer bulk edits, which agent moves use. */
	readonly explorerUndoSource: UndoRedoSource;
	move(from: string, to: string, isUndoing?: boolean): Promise<void>;
	/** Runs the agent move command, as the node command handler does after validating both paths. */
	agentMove(from: string, to: string, token?: CancellationToken): Promise<IBaseHalfAgentMoveResult>;
	/** The prompt whose message contains `text`, once it is shown. */
	prompt(text: string): Promise<RecordedPrompt>;
	read(path: string): Promise<string | undefined>;
	/** Every workspace file below the folder with its text (`.bh/cache` left out). */
	tree(): Promise<Record<string, string>>;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>, setting?: string, options: { readonly structuralRefusal?: string; readonly partialIndex?: boolean } = {}): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	const provider = disposables.add(new TestFileSystemProvider());
	disposables.add(fileService.registerProvider(Schemas.file, provider));
	await fileService.createFolder(folder);
	for (const [path, content] of Object.entries(files)) {
		await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
	}
	await timeout(20);
	const configuration = new RecordingConfigurationService({
		files: { autoSave: 'afterDelay', enableTrash: false, exclude: { hidden: true } },
		...(setting ? { [BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING]: setting } : {})
	});
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
	instantiationService.stub(IBaseHalfAdhdMirrorService, instantiationService.createInstance(BaseHalfAdhdMirrorService));
	instantiationService.stub(IBaseHalfReferenceEditService, disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService)));
	instantiationService.stub(IBaseHalfBadgeMirrorService, new BaseHalfBadgeMirrorService(fileService));
	instantiationService.stub(IBaseHalfCanvasMirrorService, instantiationService.createInstance(BaseHalfCanvasMirrorService));
	instantiationService.stub(IBaseHalfCanvasViewportStateService, { forgetSubtree: () => { } } as Partial<IBaseHalfCanvasViewportStateService> as IBaseHalfCanvasViewportStateService);
	instantiationService.stub(IBaseHalfNodeExecutionService, {
		acquireStructuralOperation: async () => {
			if (options.structuralRefusal) {
				throw new Error(options.structuralRefusal);
			}
			return { dispose: () => { } };
		}
	} as Partial<IBaseHalfNodeExecutionService> as IBaseHalfNodeExecutionService);
	instantiationService.stub(IBaseHalfPluginStructuralDeleteCleanupService, { stageDelete: async () => [] } as Partial<IBaseHalfPluginStructuralDeleteCleanupService> as IBaseHalfPluginStructuralDeleteCleanupService);
	const refactor = instantiationService.createInstance(BaseHalfReferenceRefactorService);
	if (options.partialIndex) {
		refactor.whenIndexReady = async () => 'partial';
	}
	instantiationService.stub(IBaseHalfReferenceRefactorService, refactor);
	await index.whenReady(folder);
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
		configuration,
		dialogs,
		refactor,
		undoRedo: instantiationService.get(IUndoRedoService),
		explorerUndoSource,
		async move(from, to, isUndoing) {
			await workingCopyFileService.move([{ file: { source: joinPath(folder, ...from.split('/')), target: joinPath(folder, ...to.split('/')) } }], CancellationToken.None, isUndoing ? { isUndoing } : undefined);
		},
		async agentMove(from, to, token = CancellationToken.None) {
			const argument = { workspaceFolder: folder, source: joinPath(folder, ...from.split('/')), target: joinPath(folder, ...to.split('/')), from, to };
			const result: unknown = instantiationService.invokeFunction(accessor => CommandsRegistry.getCommand(BASEHALF_WORKSPACE_AGENT_MOVE_COMMAND_ID)!.handler(accessor, argument, token));
			return result as Promise<IBaseHalfAgentMoveResult>;
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

function nodeDocument(id: number, upstream: string[], bindings: { sourcePath: string; slot: string; order: number }[]): string {
	return serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(id),
		kind: 'video',
		title: 'Clip',
		role: 'Generated result',
		upstream,
		recipe: { recipeId: 'ai-video.text-to-video', parameters: {}, inputBindings: bindings }
	}));
}

function upstreamOf(text: string | undefined): { upstream: unknown; bindings: unknown } {
	const document = parseBaseHalfNodeDocument(text ?? '');
	return { upstream: document.upstream, bindings: document.recipe?.inputBindings.map(binding => binding.sourcePath) };
}

suite('BaseHalfRenameRefactor (workbench moves)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a move prompts once; Update rewrites every store it may write, including excluded paths, lists the skipped ones, and is one canvas undo step', async () => {
		const fixture: Record<string, string> = {
			'docs/a.md': '# A\n',
			'docs/b.md': '---\nupstream:\n  - docs/a.md\n---\n# B\n',
			'notes.md': '---\ntitle: Notes\nupstream:\n  - docs/a.md\n  - docs\n  - other.md\n---\n# Notes\n',
			'other.md': '# Other\n',
			'hidden/h.md': '---\nupstream: [docs/a.md]\n---\n',
			'pic.png': 'png',
			'.bh/mirror/pic.png/upstream.yaml': 'upstream:\n  - docs\n',
			'draft.bhnode': nodeDocument(1, ['docs/a.md', 'other.md'], [{ sourcePath: 'docs/a.md', slot: 'brief', order: 0 }]),
			'running.bhnode': nodeDocument(2, ['docs/a.md'], [])
		};
		const harness = await createHarness(disposables, fixture);
		await new BaseHalfNodeRunLeaseStore(harness.fileService, 30_000).acquire(folder, baseHalfNodeTestId(2), 'running.bhnode', 'owner', 'run', undefined);
		const before = await harness.tree();

		await harness.move('docs', 'archive');
		const prompt = await harness.prompt('docs moved to archive.');
		const moved = await harness.tree();
		await prompt.choose('Update');
		const report = await harness.prompt('Updated');
		const updated = await harness.tree();

		assert.deepStrictEqual({
			prompt: prompt.message,
			choices: prompt.choices.map(choice => choice.label),
			promptsShown: harness.notifications.prompts.length,
			// Nothing changed another node's upstream list before Update.
			untouchedByMove: ['notes.md', 'hidden/h.md', '.bh/mirror/pic.png/upstream.yaml', 'draft.bhnode'].every(path => moved[path] === before[path]),
			report: report.message,
			reportChoices: report.choices.map(choice => choice.label),
			files: {
				'archive/b.md': updated['archive/b.md'],
				'notes.md': updated['notes.md'],
				'hidden/h.md': updated['hidden/h.md'],
				'.bh/mirror/pic.png/upstream.yaml': updated['.bh/mirror/pic.png/upstream.yaml'],
				draft: upstreamOf(updated['draft.bhnode']),
				running: upstreamOf(updated['running.bhnode'])
			}
		}, {
			prompt: 'docs moved to archive. 6 items list it as upstream. Update them? 1 of them can\'t be updated: running.bhnode (This node is running). If you skip, they keep the old path and will show a broken upstream entry.',
			choices: ['Update', 'Always Update', 'Skip'],
			promptsShown: 2,
			untouchedByMove: true,
			report: 'Updated 5 items. 1 item was skipped: running.bhnode (This node is running).',
			reportChoices: ['Undo'],
			files: {
				'archive/b.md': '---\nupstream:\n  - archive/a.md\n---\n# B\n',
				'notes.md': '---\ntitle: Notes\nupstream:\n  - archive/a.md\n  - archive\n  - other.md\n---\n# Notes\n',
				'hidden/h.md': '---\nupstream:\n  - archive/a.md\n---\n',
				'.bh/mirror/pic.png/upstream.yaml': 'upstream:\n  - archive\n',
				// The Draft's binding follows its entry in the same write.
				draft: { upstream: ['archive/a.md', 'other.md'], bindings: ['archive/a.md'] },
				running: { upstream: ['docs/a.md'], bindings: [] }
			}
		});

		// One canvas undo step restores every store; redo rewrites them again.
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		const undone = await harness.tree();
		await harness.undoRedo.redo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		const redone = await harness.tree();
		const restored = ['notes.md', '.bh/mirror/pic.png/upstream.yaml', 'draft.bhnode'];
		assert.deepStrictEqual({
			// Undo restores the upstream list; the flow list comes back as a block list.
			undone: [undone['archive/b.md'], undone['hidden/h.md'], ...restored.map(path => undone[path] === before[path])],
			redone: Object.fromEntries([...restored, 'hidden/h.md', 'archive/b.md'].map(path => [path, redone[path] === updated[path] ? true : redone[path]]))
		}, {
			undone: ['---\nupstream:\n  - docs/a.md\n---\n# B\n', '---\nupstream:\n  - docs/a.md\n---\n', true, true, true],
			redone: { 'notes.md': true, '.bh/mirror/pic.png/upstream.yaml': true, 'draft.bhnode': true, 'hidden/h.md': true, 'archive/b.md': true }
		});
	});

	test('Skip, or closing the prompt, leaves the entries dangling; a move outside the workbench offers nothing', async () => {
		const note = '---\nupstream:\n  - a.md\n  - b.md\n---\n# N\n';
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'b.md': '# B\n', 'n.md': note });

		await harness.move('a.md', 'a2.md');
		await (await harness.prompt('a.md moved to a2.md.')).choose('Skip');
		await harness.move('b.md', 'b2.md');
		(await harness.prompt('b.md moved to b2.md.')).close();
		await harness.fileService.move(joinPath(folder, 'a2.md'), joinPath(folder, 'a3.md'));
		await timeout(50);

		assert.deepStrictEqual({
			note: await harness.read('n.md'),
			prompts: harness.notifications.prompts.map(prompt => prompt.message.split('.')[0])
		}, {
			note,
			prompts: ['a', 'b']
		});
	});

	test('always updates without asking and offers Undo; never does nothing; a marked folder always prompts', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const always = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note }, 'always');
		await always.move('a.md', 'b.md');
		const report = await always.prompt('Updated 1 item.');
		const updated = await always.read('n.md');
		await report.choose('Undo');
		await until(async () => await always.read('n.md') === note, 'Undo did not restore the entry');

		const never = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note }, 'never');
		await never.move('a.md', 'b.md');
		await timeout(50);

		const marked = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note, '.basehalf-no-workspace-setup': '' }, 'always');
		await marked.move('a.md', 'b.md');
		const prompt = await marked.prompt('a.md moved to b.md.');
		await prompt.choose('Always Update');
		await marked.prompt('Updated 1 item.');

		assert.deepStrictEqual({
			always: [always.notifications.prompts.map(candidate => candidate.message), updated],
			never: [never.notifications.prompts.length, await never.read('n.md')],
			marked: [prompt.message, marked.configuration.updates, await marked.read('n.md'), (await marked.tree())['.bh/mirror/n.md/adhd.yaml'] ?? null]
		}, {
			always: [['Updated 1 item.'], '---\nupstream:\n  - b.md\n---\n# N\n'],
			never: [0, note],
			marked: [
				'a.md moved to b.md. 1 item lists it as upstream. Update it? If you skip, they keep the old path and will show a broken upstream entry.',
				[[BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING, 'always']],
				'---\nupstream:\n  - b.md\n---\n# N\n',
				null
			]
		});
	});

	test('an agent move carries the metadata, updates without a prompt or notification, returns what it did, and undoes as an Explorer move', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const files = {
			'a.md': '# A\n',
			'n.md': note,
			'p.pdf': 'pdf',
			'.bh/mirror/a.md/badge.yaml': 'path: "a.md"\nkind: file\ndescription: "Trunk"\n',
			'.bh/mirror/a.md/appearance.yaml': 'color: blue\n',
			'.bh/mirror/p.pdf/upstream.yaml': 'upstream:\n  - a.md\n'
		};
		const harness = await createHarness(disposables, files);
		const moved = await harness.agentMove('a.md', 'docs/b.md');
		const tree = await harness.tree();
		const promptsAfterMove = harness.notifications.prompts.map(candidate => candidate.message);
		await harness.undoRedo.undo(harness.explorerUndoSource);
		const undoPrompt = await harness.prompt('b.md moved to a.md.');

		assert.deepStrictEqual({
			moved,
			promptsAfterMove,
			files: [tree['a.md'] ?? null, tree['docs/b.md'], tree['n.md'], tree['.bh/mirror/p.pdf/upstream.yaml'], tree['.bh/mirror/a.md/badge.yaml'] ?? null, tree['.bh/mirror/docs/b.md/badge.yaml'], tree['.bh/mirror/a.md/appearance.yaml'] ?? null, tree['.bh/mirror/docs/b.md/appearance.yaml']],
			undo: [await harness.read('a.md'), undoPrompt.message.startsWith('b.md moved to a.md. 2 items list it as upstream.')]
		}, {
			moved: { from: 'a.md', to: 'docs/b.md', upstream: { updated: ['n.md', 'p.pdf'], skipped: [] } },
			promptsAfterMove: [],
			files: [null, '# A\n', '---\nupstream:\n  - docs/b.md\n---\n# N\n', 'upstream:\n  - docs/b.md\n', null, 'path: "docs/b.md"\nkind: file\ndescription: "Trunk"\n', null, 'color: blue\n'],
			undo: ['# A\n', true]
		});
	});

	test('an agent move under never leaves the entries and says so; one that nothing names returns an empty result; a refused move rejects', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const never = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note }, 'never');
		const left = await never.agentMove('a.md', 'b.md');
		const neverState = [left, never.notifications.prompts.length, await never.read('n.md')];

		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'c.md': '# C\n' });
		const result = await harness.agentMove('a.md', 'b.md');
		await assert.rejects(harness.agentMove('b.md', 'c.md'));
		assert.deepStrictEqual({
			never: neverState,
			nothing: [result, harness.notifications.prompts.length, await harness.read('b.md'), await harness.read('c.md')]
		}, {
			never: [{ from: 'a.md', to: 'b.md', upstream: { updated: [], skipped: [], notUpdated: `${BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING} is never` } }, 0, note],
			nothing: [{ from: 'a.md', to: 'b.md', upstream: { updated: [], skipped: [] } }, 0, '# A\n', '# C\n']
		});
	});

	test('an agent move reports entries that an earlier unsettled move owns, and that move still updates them', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note });
		await harness.move('a.md', 'b.md');
		const prompt = await harness.prompt('a.md moved to b.md.');
		// A new a.md: n.md's entry still names the old one, which the unanswered move owns.
		await harness.fileService.writeFile(joinPath(folder, 'a.md'), VSBuffer.fromString('# New A\n'));
		const moved = await harness.agentMove('a.md', 'c.md');
		assert.deepStrictEqual([moved.upstream.updated, moved.upstream.skipped.map(item => item.split(' ')[0]), prompt.closed], [[], ['n.md'], false]);
		await prompt.choose('Update');
		await until(async () => await harness.read('n.md') === '---\nupstream:\n  - b.md\n---\n# N\n', 'the earlier prompt did not update its own entry');
	});

	test('an agent folder move carries every descendant\'s metadata and remaps entries that name paths inside it', async () => {
		const harness = await createHarness(disposables, {
			'docs/x.md': '# X\n',
			'docs/y.md': '---\nupstream:\n  - docs/x.md\n---\n# Y\n',
			'docs/p.pdf': 'pdf',
			'n.md': '---\nupstream:\n  - docs\n  - docs/x.md\n---\n# N\n',
			'.bh/mirror/docs/badge.yaml': 'path: "docs"\nkind: folder\ndescription: "Docs"\n',
			'.bh/mirror/docs/x.md/badge.yaml': 'path: "docs/x.md"\nkind: file\ndescription: "X"\n',
			'.bh/mirror/docs/p.pdf/upstream.yaml': 'upstream:\n  - docs/x.md\n'
		});
		const moved = await harness.agentMove('docs', 'papers');
		const tree = await harness.tree();
		assert.deepStrictEqual({
			updated: [...moved.upstream.updated].sort(),
			skipped: moved.upstream.skipped,
			files: Object.fromEntries(Object.entries(tree).filter(([path]) => path !== 'docs/p.pdf' && path !== 'papers/p.pdf'))
		}, {
			updated: ['n.md', 'papers/p.pdf', 'papers/y.md'],
			skipped: [],
			files: {
				'.bh/mirror/papers/badge.yaml': 'path: "papers"\nkind: folder\ndescription: "Docs"\n',
				'.bh/mirror/papers/p.pdf/upstream.yaml': 'upstream:\n  - papers/x.md\n',
				'.bh/mirror/papers/x.md/badge.yaml': 'path: "papers/x.md"\nkind: file\ndescription: "X"\n',
				'n.md': '---\nupstream:\n  - papers\n  - papers/x.md\n---\n# N\n',
				'papers/x.md': '# X\n',
				'papers/y.md': '---\nupstream:\n  - papers/x.md\n---\n# Y\n'
			}
		});
	});

	test('an agent move shows the report when it skipped a store, and when its caller went away', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const skipping = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note, 'running.bhnode': nodeDocument(2, ['a.md'], []) });
		await new BaseHalfNodeRunLeaseStore(skipping.fileService, 30_000).acquire(folder, baseHalfNodeTestId(2), 'running.bhnode', 'owner', 'run', undefined);
		const skipped = await skipping.agentMove('a.md', 'b.md');
		const skipReport = await skipping.prompt('Updated 1 item.');

		const leaving = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note });
		const source = new CancellationTokenSource();
		const pending = leaving.agentMove('a.md', 'b.md', source.token);
		source.cancel();
		const completed = await pending;
		await leaving.prompt('Updated 1 item.');
		source.dispose();

		assert.deepStrictEqual([skipped.upstream.updated, skipped.upstream.skipped.map(item => item.split(' ')[0]), skipReport.message.includes('running.bhnode'), completed.upstream, await leaving.read('n.md')], [
			['n.md'],
			['running.bhnode'],
			true,
			{ updated: ['n.md'], skipped: [] },
			'---\nupstream:\n  - b.md\n---\n# N\n'
		]);
	});

	test('an agent move that a workbench precondition refuses rejects with its reason and changes nothing; a cancelled one never starts', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const refused = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note }, undefined, { structuralRefusal: 'Wait for the active node Attempt before moving or deleting this item.' });
		await assert.rejects(refused.agentMove('a.md', 'b.md'), /Wait for the active node Attempt/);

		const cancelled = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note });
		const source = new CancellationTokenSource();
		source.cancel();
		await assert.rejects(cancelled.agentMove('a.md', 'b.md', source.token));
		source.dispose();
		assert.deepStrictEqual([await refused.read('a.md'), await refused.read('b.md'), await cancelled.read('a.md'), await cancelled.read('b.md')], ['# A\n', undefined, '# A\n', undefined]);
	});

	test('an agent move on a partial index says its result may be incomplete', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': '---\nupstream:\n  - a.md\n---\n# N\n' }, undefined, { partialIndex: true });
		const moved = await harness.agentMove('a.md', 'b.md');
		assert.deepStrictEqual(moved.upstream, { updated: ['n.md'], skipped: [], incomplete: 'the reference index is partial, so stores it could not read may still name the old path' });
	});

	test('an agent move result caps each list at 200 items', () => {
		const items = (count: number) => Array.from({ length: count }, (_, index) => `n${index}.md`);
		assert.deepStrictEqual([capAgentMoveList(items(200)).length, capAgentMoveList(items(201)).slice(-2)], [200, ['n198.md', '… and 2 more']]);
	});

	test('pending moves compose, and undo of a move follows the same rules', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note });

		await harness.move('a.md', 'b.md');
		const prompt = await harness.prompt('a.md moved to b.md.');
		await harness.move('b.md', 'c.md');
		await until(() => prompt.message.startsWith('a.md moved to c.md.'), `the pending prompt did not compose: ${prompt.message}`);
		await timeout(20);
		const promptsAfterSecondMove = harness.notifications.prompts.length;
		await prompt.choose('Update');
		await harness.prompt('Updated 1 item.');
		const composed = await harness.read('n.md');

		// Undo of the move is a move too: it offers the update back.
		await harness.move('c.md', 'a.md', true);
		await (await harness.prompt('c.md moved to a.md.')).choose('Update');
		await until(async () => await harness.read('n.md') === note, 'the undo move did not update the entry back');

		assert.deepStrictEqual({ promptsAfterSecondMove, composed }, {
			promptsAfterSecondMove: 1,
			composed: '---\nupstream:\n  - c.md\n---\n# N\n'
		});
	});

	test('a rename, then a move of its folder: each prompt updates only its own entries, in either order', async () => {
		const note = '---\nupstream:\n  - docs/a.md\n  - docs/c.md\n---\n# N\n';
		const harness = await createHarness(disposables, { 'docs/a.md': '# A\n', 'docs/c.md': '# C\n', 'n.md': note });

		await harness.move('docs/a.md', 'docs/b.md');
		const first = await harness.prompt('a.md moved to docs/b.md.');
		await harness.move('docs', 'archive');
		const second = await harness.prompt('docs moved to archive.');
		await until(() => first.message.startsWith('a.md moved to archive/b.md.'), `the first prompt did not compose: ${first.message}`);
		// The newest prompt is answered first.
		await second.choose('Update');
		await harness.prompt('Updated 1 item.');
		const afterSecond = await harness.read('n.md');
		await first.choose('Update');
		await until(() => harness.notifications.prompts.filter(prompt => prompt.message.startsWith('Updated')).length === 2, 'the first prompt did not report');

		assert.deepStrictEqual({
			prompts: [first.message, second.message],
			afterSecond,
			final: await harness.read('n.md'),
			reports: harness.notifications.prompts.filter(prompt => prompt.message.startsWith('Updated')).map(prompt => prompt.message)
		}, {
			prompts: [
				'a.md moved to archive/b.md. 1 item lists it as upstream. Update it? If you skip, they keep the old path and will show a broken upstream entry.',
				'docs moved to archive. 1 item lists it as upstream. Update it? If you skip, they keep the old path and will show a broken upstream entry.'
			],
			// The folder's prompt leaves the entry of the earlier rename alone.
			afterSecond: '---\nupstream:\n  - docs/a.md\n  - archive/c.md\n---\n# N\n',
			final: '---\nupstream:\n  - archive/b.md\n  - archive/c.md\n---\n# N\n',
			reports: ['Updated 1 item.', 'Updated 1 item.']
		});
	});

	test('a folder move, then a move of an item inside it: Update follows the item to where it is now', async () => {
		const harness = await createHarness(disposables, { 'docs/x.md': '# X\n', 'docs/y.md': '# Y\n', 'n.md': '---\nupstream:\n  - docs/x.md\n  - docs/y.md\n---\n# N\n' });

		await harness.move('docs', 'notes');
		const prompt = await harness.prompt('docs moved to notes.');
		await harness.move('notes/x.md', 'archive/x.md');
		await timeout(20);
		const promptsBeforeUpdate = harness.notifications.prompts.length;
		await prompt.choose('Update');
		await harness.prompt('Updated 1 item.');

		assert.deepStrictEqual({ promptsBeforeUpdate, message: prompt.message, note: await harness.read('n.md') }, {
			promptsBeforeUpdate: 1,
			message: 'docs moved to notes. 1 item lists it as upstream. Update it? If you skip, they keep the old path and will show a broken upstream entry.',
			note: '---\nupstream:\n  - archive/x.md\n  - notes/y.md\n---\n# N\n'
		});
	});

	test('a move that lands after Update planned and before it wrote is composed, and the update re-plans', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const run = async (setting: string | undefined, next: string) => {
			const harness = await createHarness(disposables, { 'a.md': '# A\n', 'n.md': note }, setting);
			// Hold the refactor's second read of n.md: its preflight check, after
			// it read the store and found that the old path names no node.
			let release!: () => void;
			const held = new Promise<void>(resolve => release = resolve);
			let reached!: () => void;
			const reading = new Promise<void>(resolve => reached = resolve);
			let armed = false;
			let reads = 0;
			harness.provider.readGate = resource => {
				if (armed && resource.path === '/work/n.md' && ++reads === 2) {
					armed = false;
					reached();
					return held;
				}
				return undefined;
			};
			if (setting === 'always') {
				armed = true;
				await harness.move('a.md', 'b.md');
			} else {
				await harness.move('a.md', 'b.md');
				const prompt = await harness.prompt('a.md moved to b.md.');
				armed = true;
				void prompt.choose('Update');
			}
			await reading;
			// Undo of the rename (b.md → a.md), or a further move (b.md → c.md).
			await harness.move('b.md', next, next === 'a.md');
			release();
			if (next === 'a.md') {
				await timeout(100);
			} else {
				await harness.prompt('Updated');
			}
			return { note: await harness.read('n.md'), prompts: harness.notifications.prompts.map(prompt => prompt.message.split(' ').slice(0, 4).join(' ')) };
		};

		assert.deepStrictEqual({
			movedOn: await run(undefined, 'c.md'),
			undone: await run(undefined, 'a.md'),
			alwaysMovedOn: await run('always', 'c.md')
		}, {
			movedOn: { note: '---\nupstream:\n  - c.md\n---\n# N\n', prompts: ['a.md moved to b.md.', 'Updated 1 item.'] },
			// The rename was undone: the entry names the item again, and nothing is written.
			undone: { note, prompts: ['a.md moved to b.md.'] },
			alwaysMovedOn: { note: '---\nupstream:\n  - c.md\n---\n# N\n', prompts: ['Updated 1 item.'] }
		});
	});

	test('a store refused only when it is written is skipped, and the other stores are updated', async () => {
		const note = '---\nupstream:\n  - a.md\n---\n# N\n';
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'n1.md': note, 'n2.md': note });
		// An open projection of n1.md whose pending edit can't be flushed: the
		// preflight check doesn't flush, so only the write finds it.
		disposables.add(harness.flush.registerDocumentFlusher(joinPath(folder, 'n1.md').toString(), async () => false));

		await harness.move('a.md', 'b.md');
		const prompt = await harness.prompt('a.md moved to b.md.');
		await prompt.choose('Update');
		const report = await harness.prompt('Updated');

		assert.deepStrictEqual({
			prompt: prompt.message,
			report: report.message,
			files: [await harness.read('n1.md'), await harness.read('n2.md')]
		}, {
			prompt: 'a.md moved to b.md. 2 items list it as upstream. Update them? If you skip, they keep the old path and will show a broken upstream entry.',
			report: 'Updated 1 item. 1 item was skipped: n1.md (Finish or resolve the unsaved edit in n1.md first).',
			files: [note, '---\nupstream:\n  - b.md\n---\n# N\n']
		});
	});

	test('a rename that gives a node its own store offers to move its upstream list into the file', async () => {
		const harness = await createHarness(disposables, {
			'x.md': '# X\n',
			'notes.txt': 'text\n',
			'.bh/mirror/notes.txt/upstream.yaml': 'upstream:\n  - x.md\n'
		});
		await harness.move('notes.txt', 'notes.md');
		const prompt = await harness.prompt('now keeps its upstream list in the file');
		await prompt.choose('Update');
		await harness.prompt('notes.md now keeps its upstream list in the file.');
		const moved = await harness.tree();
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		const undone = await harness.tree();

		assert.deepStrictEqual({
			prompt: prompt.message,
			moved: [moved['notes.md'], moved['.bh/mirror/notes.md/upstream.yaml'] ?? null],
			undone: [undone['notes.md'], undone['.bh/mirror/notes.md/upstream.yaml'] ?? null]
		}, {
			prompt: 'notes.md now keeps its upstream list in the file. Move its 1 entry?',
			moved: ['---\nupstream:\n  - x.md\n---\ntext\n', null],
			undone: ['text\n', 'upstream:\n  - x.md\n']
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
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, isISubmenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup, UndoRedoSource } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { UndoRedoService } from '../../../../../platform/undoRedo/common/undoRedoService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import {
	BASEHALF_CANVAS_CARD_CONTEXT_MENU,
	BASEHALF_CANVAS_NEW_RESULT_NODE_MENU,
	BASEHALF_CANVAS_PANE_CONTEXT_MENU,
	baseHalfTemplateFolderBaseName,
	discardLegacyBaseHalfPendingTemplateSetups,
	parseBaseHalfPendingTemplateSetups
} from '../../browser/basehalfCanvasContextMenu.js';
import { BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID, BASEHALF_CANVAS_UNDO_REDO_SOURCE, IBaseHalfCanvasEditingService } from '../../common/basehalfCanvasEditing.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfWorkspaceResource } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID } from '../../common/basehalfCanvasTemplate.js';
import { BaseHalfCanvasTemplateRegistryService, IBaseHalfCanvasTemplateRegistryService } from '../../common/basehalfCanvasTemplateRegistry.js';
import { IBaseHalfReferenceEditService, IBaseHalfReferenceStoreEdit, IBaseHalfUpstreamStoreSnapshot } from '../../../references/common/basehalfReferenceEdit.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { BaseHalfGenerationCardStore } from '../../../video/browser/basehalfGenerationCardStore.js';
import { BaseHalfGenerationKind } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfVideoGenerationChoice } from '../../../video/common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService, IBaseHalfVideoProviderSettingsService } from '../../../video/common/basehalfVideoGeneration.js';

suite('BaseHalf canvas context menu', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('registers card commands without Explorer selection commands', () => {
		assert.deepStrictEqual(menuCommands(BASEHALF_CANVAS_CARD_CONTEXT_MENU), [
			['5_cutcopypaste', 'basehalf.canvas.copy'],
			['6_copypath', 'basehalf.canvas.copyPath'],
			['6_copypath', 'basehalf.canvas.copyRelativePath'],
			['5_cutcopypaste', 'basehalf.canvas.cut'],
			['7_modification', 'basehalf.canvas.moveResourceToTrash'],
			['navigation', 'basehalf.canvas.openResource'],
			['7_modification', 'basehalf.canvas.renameResource'],
			['2_files', 'basehalf.canvas.revealInFiles']
		]);
	});

	test('registers pane creation commands', () => {
		assert.deepStrictEqual(menuCommands(BASEHALF_CANVAS_PANE_CONTEXT_MENU), [
			['5_transfer', 'basehalf.canvas.importFiles'],
			['1_new', 'basehalf.canvas.newFile'],
			['1_new', 'basehalf.canvas.newFolder'],
			['1_new', 'basehalf.canvas.newNote'],
			['5_transfer', 'basehalf.canvas.paste']
		]);
		assert.deepStrictEqual(MenuRegistry.getMenuItems(BASEHALF_CANVAS_PANE_CONTEXT_MENU)
			.filter(isISubmenuItem)
			.map(item => [item.group, item.submenu.id]), [
			['1_new', BASEHALF_CANVAS_NEW_RESULT_NODE_MENU.id]
		]);
		assert.deepStrictEqual(menuCommands(BASEHALF_CANVAS_NEW_RESULT_NODE_MENU), [
			['1_content', 'basehalf.canvas.newAudioNode'],
			['1_content', 'basehalf.canvas.newFileNode'],
			['1_content', 'basehalf.canvas.newImageNode'],
			['1_content', 'basehalf.canvas.newPdfNode'],
			['1_content', 'basehalf.canvas.newPresentationNode'],
			['1_content', 'basehalf.canvas.newVideoNode']
		]);
	});

	test('keeps canvas card creation out of the command palette and dispatches typed result nodes', async () => {
		const resultCommands = [
			['basehalf.canvas.newImageNode', 'image'],
			['basehalf.canvas.newVideoNode', 'video'],
			['basehalf.canvas.newAudioNode', 'audio'],
			['basehalf.canvas.newPdfNode', 'pdf'],
			['basehalf.canvas.newPresentationNode', 'presentation'],
			['basehalf.canvas.newFileNode', 'file']
		] as const;
		const commandPaletteIds = new Set(MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.map(item => item.command.id));
		for (const commandId of [
			BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID,
			'basehalf.canvas.newFile',
			'basehalf.canvas.newFolder',
			...resultCommands.map(([commandId]) => commandId)
		]) {
			assert.strictEqual(commandPaletteIds.has(commandId), false);
		}

		const requests: unknown[][] = [];
		const accessor = {
			get: <T>(service: unknown): T => {
				if (service === IBaseHalfCanvasEditingService) {
					return {
						requestCreate: async (...args: unknown[]) => { requests.push(args); }
					} as T;
				}
				throw new Error('Unexpected service');
			}
		} as ServicesAccessor;
		for (const [commandId] of resultCommands) {
			const command = CommandsRegistry.getCommand(commandId);
			assert.ok(command);
			await command.handler(accessor);
		}
		assert.deepStrictEqual(requests, resultCommands.map(([, kind]) => [undefined, 'resultNode', kind]));
	});

	test('normalizes template folder labels to portable project segments', () => {
		assert.strictEqual(baseHalfTemplateFolderBaseName('.bh'), 'Canvas');
		assert.strictEqual(baseHalfTemplateFolderBaseName('CON'), 'Canvas');
		assert.strictEqual(baseHalfTemplateFolderBaseName('NUL.txt'), 'Canvas');
		assert.strictEqual(baseHalfTemplateFolderBaseName('Storyboard. '), 'Storyboard');
		assert.strictEqual(baseHalfTemplateFolderBaseName('Cafe\u0301'), 'Café');
	});

	test('creates one reversible template transaction with stable files, a draft, canvas rows, and upstream lists', async () => {
		const harness = await createTemplateHarness(disposables);
		await harness.create();

		assert.strictEqual(harness.undoRedo.pushed.length, 1);
		assert.deepStrictEqual(harness.undoRedo.getElements(harness.projectResource).past.length, 1);
		const created = await readCreatedTemplateState(harness);
		// The draft is card information without a file; its connection is written by the card store, first (D63).
		assert.deepStrictEqual({ brief: created.brief, draft: created.draft, frameFile: await harness.fileService.exists(joinPath(harness.projectResource, 'frame.png')), referenceEdits: harness.referenceEdits }, {
			brief: '# Brief\n\nKeep the subject centered.\n',
			draft: 'prompt: ""\nprovider: "acme"\nmodel: "acme-still"\nmode: "frames"\nparams:\n  resolution: "2k"\n',
			frameFile: false,
			referenceEdits: [{ node: 'Starter/frame.png', operation: { kind: 'append', entries: ['Starter/brief.md'] } }]
		});
		assert.deepStrictEqual(harness.lastUsedKinds, ['image']);
		assert.strictEqual(await harness.fileService.exists(joinPath(harness.workspaceFolder, '.bh', 'mirror', 'Starter', 'brief.md', 'badge.yaml')), false);
		assert.deepStrictEqual(created.canvas?.cards, [
			{ path: 'Starter/brief.md', kind: 'file', x: 40, y: 80, width: 240, height: 140 },
			{ path: 'Starter/frame.png', kind: 'file', x: 380, y: 80, width: 260, height: 180 }
		]);
		assert.deepStrictEqual(created.canvas?.edges, [{
			from: 'Starter/brief.md',
			from_anchor: 'east',
			to: 'Starter/frame.png',
			to_anchor: 'west'
		}]);
		assert.deepStrictEqual(harness.selections, [{ folder: harness.workspaceFolder, resources: [harness.projectResource] }]);

		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.strictEqual(await harness.fileService.exists(harness.projectResource), false);
		assert.strictEqual(await harness.canvasMirror.readCanvas(harness.projectFolder), null);
		// Like a delete to the trash, undo keeps the draft's card information.
		assert.strictEqual(await readDraft(harness), created.draft);
		assert.deepStrictEqual(harness.undoRedo.getElements(harness.projectResource).future.length, 1);

		await harness.undoRedo.redo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.deepStrictEqual(await readCreatedTemplateState(harness), created);
		assert.strictEqual(harness.undoRedo.pushed.length, 1);
		assert.deepStrictEqual(harness.undoRedo.getElements(harness.projectResource).past.length, 1);
		assert.deepStrictEqual(harness.undoRedo.getElements(harness.projectResource).future.length, 0);
	});

	test('cancels template creation before it mutates project files or history', async () => {
		const harness = await createTemplateHarness(disposables);
		await assert.rejects(() => harness.createWithCancellation(CancellationToken.Cancelled), /Canceled/);

		assert.strictEqual(await harness.fileService.exists(harness.projectResource), false);
		assert.strictEqual(await readDraft(harness), undefined);
		assert.strictEqual(harness.undoRedo.pushed.length, 0);
		assert.deepStrictEqual(parseBaseHalfPendingTemplateSetups(
			harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE)
		), []);
	});

	test('refuses template undo before writing when any owned file or metadata row changed', async () => {
		for (const change of ['file', 'extra-file', 'card', 'edge'] as const) {
			const harness = await createTemplateHarness(disposables);
			await harness.create();
			await changeCreatedTemplateState(harness, change);
			const before = await snapshotWorkspace(harness.fileService, harness.workspaceFolder);

			await assert.rejects(async () => harness.undoRedo.pushed[0].undo(), Error, change);

			assert.deepStrictEqual(await snapshotWorkspace(harness.fileService, harness.workspaceFolder), before, change);
			assert.strictEqual(await harness.fileService.exists(harness.projectResource), true, change);
		}
	});

	test('undoes the creation after an agent changed the draft, and keeps what the agent wrote', async () => {
		const harness = await createTemplateHarness(disposables);
		await harness.create();
		await changeCreatedTemplateState(harness, 'draft');
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.deepStrictEqual([await harness.fileService.exists(harness.projectResource), await readDraft(harness)], [false, 'prompt: "A red kite over the dunes."\n']);
	});

	test('refuses incomplete setup recovery before writing after files or metadata were changed', async () => {
		for (const change of ['file', 'card', 'edge', 'card-and-edge'] as const) {
			const harness = await createTemplateHarness(disposables);
			await harness.create();
			await storeRecoveryRecord(harness);
			if (change === 'card-and-edge') {
				await changeCreatedTemplateState(harness, 'card');
				await changeCreatedTemplateState(harness, 'edge');
			} else {
				await changeCreatedTemplateState(harness, change);
			}
			const beforeFiles = await snapshotWorkspace(harness.fileService, harness.workspaceFolder);
			const beforeStorage = harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE);

			await harness.resume();

			assert.deepStrictEqual(await snapshotWorkspace(harness.fileService, harness.workspaceFolder), beforeFiles, change);
			assert.strictEqual(harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE), beforeStorage, change);
			assert.strictEqual(harness.undoRedo.pushed.length, 1, change);
		}
	});

	test('finishes an unchanged setup with one undo element, making the draft that is missing and keeping one that is there', async () => {
		for (const draft of ['missing', 'changed'] as const) {
			const harness = await createTemplateHarness(disposables);
			await harness.create();
			const created = await readCreatedTemplateState(harness);
			assert.ok(created.canvas);
			await harness.canvasMirror.transitionCanvasState(harness.projectFolder, {
				cards: created.canvas.cards.map(card => ({ path: card.path, expected: card, next: null })),
				edges: created.canvas.edges.map(edge => ({ from: edge.from, to: edge.to, expected: edge, next: null }))
			});
			if (draft === 'missing') {
				// The window closed before the template made its draft.
				await harness.fileService.del(joinPath(harness.workspaceFolder, '.bh', 'mirror', 'Starter', 'frame.png'), { recursive: true });
			} else {
				await changeCreatedTemplateState(harness, 'draft');
			}
			clearCapturedUndo(harness);
			await storeRecoveryRecord(harness);

			await harness.resume();

			assert.deepStrictEqual(await readCreatedTemplateState(harness), draft === 'missing' ? created : { ...created, draft: 'prompt: "A red kite over the dunes."\n' }, draft);
			assert.strictEqual(harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE), undefined, draft);
			assert.strictEqual(harness.undoRedo.pushed.length, 1, draft);
		}
	});

	test('refuses to finish a setup whose draft\'s path another item took, and writes nothing of the draft', async () => {
		const harness = await createTemplateHarness(disposables);
		await harness.create();
		await harness.fileService.del(joinPath(harness.workspaceFolder, '.bh', 'mirror', 'Starter', 'frame.png'), { recursive: true });
		await harness.fileService.writeFile(joinPath(harness.projectResource, 'frame.png'), VSBuffer.fromString('not a draft'));
		clearCapturedUndo(harness);
		await storeRecoveryRecord(harness);
		const beforeStorage = harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE);

		await harness.resume();

		assert.deepStrictEqual({
			draft: await readDraft(harness),
			pending: harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE) === beforeStorage,
			undo: harness.undoRedo.pushed.length
		}, { draft: undefined, pending: true, undo: 0 });
	});

	test('resumes an interrupted metadata commit only after explicit confirmation', async () => {
		const harness = await createTemplateHarness(disposables, { selectContinueIfOffered: true });
		await harness.create();
		const created = await readCreatedTemplateState(harness);
		const frameCard = created.canvas?.cards.find(card => card.path === 'Starter/frame.png');
		assert.ok(frameCard);
		await harness.canvasMirror.transitionCanvasState(harness.projectFolder, {
			cards: [{ path: frameCard.path, expected: frameCard, next: null }]
		});
		clearCapturedUndo(harness);
		await storeRecoveryRecord(harness);

		await harness.resume();

		assert.deepStrictEqual(await readCreatedTemplateState(harness), created);
		assert.strictEqual(harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE), undefined);
		assert.strictEqual(harness.undoRedo.pushed.length, 1);
		assert.strictEqual(harness.promptLabels.some(labels => labels.some(label => label.includes('Continue Setup'))), true);
	});

	test('keeps recovery tracking when canvas metadata is partial and does not offer a destructive stop action', async () => {
		const harness = await createTemplateHarness(disposables, { selectStopIfOffered: true });
		await harness.create();
		await storeRecoveryRecord(harness);
		await changeCreatedTemplateState(harness, 'card');
		const beforeStorage = harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE);

		await harness.resume();

		assert.strictEqual(harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE), beforeStorage);
		assert.strictEqual(harness.promptLabels.length, 1);
		assert.strictEqual(harness.promptLabels[0].some(label => label.includes('Stop Setup')), false);
	});

	test('materializes Markdown targets in their first bytes, drafts through the card store, and sidecar targets through the reference edit service', async () => {
		const templateSource = JSON.stringify({
			version: 1,
			files: [
				{ path: 'brief.md', contents: '---\ntitle: Brief\n---\n# Brief\n' },
				{ path: 'script.md', contents: '# Script\n' },
				{ path: 'shot.json', contents: '{}\n' }
			],
			drafts: [{ path: 'frame.mp4', prompt: 'Keep the subject centered.' }],
			cards: [],
			references: [
				{ from: 'script.md', to: 'brief.md', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'brief.md', to: 'script.md', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'brief.md', to: 'shot.json', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'script.md', to: 'shot.json', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'shot.json', to: 'frame.mp4', fromAnchor: 'east', toAnchor: 'west' }
			]
		});
		const harness = await createTemplateHarness(disposables, { templateSource, lastUsed: undefined });
		await harness.create();

		const read = async (path: string) => (await harness.fileService.readFile(joinPath(harness.projectResource, path))).value.toString();
		assert.deepStrictEqual({
			brief: await read('brief.md'),
			script: await read('script.md'),
			shot: await read('shot.json'),
			// A video draft with the template's prompt, and no model when none was used on this computer.
			frame: await readDraft(harness, 'frame.mp4'),
			kinds: harness.lastUsedKinds,
			referenceEdits: harness.referenceEdits,
			pending: harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE)
		}, {
			brief: '---\ntitle: Brief\nupstream:\n  - Starter/script.md\n---\n# Brief\n',
			script: '---\nupstream:\n  - Starter/brief.md\n---\n# Script\n',
			shot: '{}\n',
			frame: 'prompt: "Keep the subject centered."\n',
			kinds: ['video'],
			referenceEdits: [{
				node: 'Starter/frame.mp4',
				operation: { kind: 'append', entries: ['Starter/shot.json'] }
			}, {
				node: 'Starter/shot.json',
				operation: {
					kind: 'transition',
					from: { items: [] },
					to: { items: [{ text: 'Starter/brief.md', scalar: true }, { text: 'Starter/script.md', scalar: true }] }
				}
			}],
			pending: undefined
		});
	});

	test('refuses a template with sidecar targets or drafts in a marked folder before creating anything', async () => {
		const sidecarTemplate = JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }, { path: 'shot.json', contents: '{}\n' }],
			drafts: [],
			cards: [],
			references: [{ from: 'brief.md', to: 'shot.json', fromAnchor: 'east', toAnchor: 'west' }]
		});
		const draftTemplate = JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }],
			drafts: [{ path: 'clip.mp4' }],
			cards: [],
			references: []
		});
		for (const templateSource of [sidecarTemplate, draftTemplate]) {
			const harness = await createTemplateHarness(disposables, { templateSource, marked: true });
			await assert.rejects(() => harness.create(), /a folder it is set to leave alone/);
			assert.deepStrictEqual({
				project: await harness.fileService.exists(harness.projectResource),
				mirror: await harness.fileService.exists(joinPath(harness.workspaceFolder, '.bh')),
				referenceEdits: harness.referenceEdits,
				pending: harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE)
			}, { project: false, mirror: false, referenceEdits: [], pending: undefined });
		}
	});

	test('discards version 1 pending setups with a warning that names each setup', async () => {
		const harness = await createTemplateHarness(disposables);
		harness.storageService.store(LEGACY_PENDING_TEMPLATE_SETUPS_STORAGE_KEY, JSON.stringify([{
			id: 'legacy-setup',
			templateId: TEMPLATE_ID,
			templateLabel: 'Starter',
			templateDigest: 'a'.repeat(64),
			files: [{ path: 'brief.md', digest: 'b'.repeat(64) }],
			workspaceFolder: harness.workspaceFolder.toString(),
			projectRelativePath: 'Starter',
			createdAt: '2026-07-18T10:00:00.000Z'
		}]), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const warnings: string[] = [];
		const notificationService = { warn: (message: string) => { warnings.push(message); } } as unknown as INotificationService;

		const discarded = discardLegacyBaseHalfPendingTemplateSetups(harness.storageService, notificationService);

		assert.deepStrictEqual({
			discarded: discarded.map(setup => setup.id),
			legacy: harness.storageService.get(LEGACY_PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE),
			warnings: warnings.map(warning => warning.includes('\'Starter\' in \'Starter\'')),
			again: discardLegacyBaseHalfPendingTemplateSetups(harness.storageService, notificationService).length
		}, { discarded: ['legacy-setup'], legacy: undefined, warnings: [true], again: 0 });
	});

	test('keeps only bounded, portable template setup recovery records', () => {
		const valid = {
			id: 'setup-1',
			templateId: 'studio.workflow.template',
			templateLabel: 'Starter',
			templateDigest: 'a'.repeat(64),
			files: [{ path: 'README.md', digest: 'b'.repeat(64) }],
			workspaceFolder: 'file:///workspace',
			projectRelativePath: 'Starter',
			createdAt: '2026-07-18T10:00:00.000Z'
		};
		assert.deepStrictEqual(parseBaseHalfPendingTemplateSetups(JSON.stringify([
			valid,
			{ ...valid, id: 'setup-2', projectRelativePath: '../outside' },
			{ ...valid },
			{ ...valid, id: 'setup-3', createdAt: 'not-a-date' },
			{ ...valid, id: 'setup-4', templateDigest: 'not-a-digest' },
			{ ...valid, id: 'setup-5', files: [{ path: '../outside', digest: 'b'.repeat(64) }] },
			{ ...valid, id: 'setup-6', files: [{ path: 'README.md', digest: 'not-a-digest' }] },
			{ ...valid, id: 'setup-7', files: [] }
		])), [valid]);
		assert.deepStrictEqual(parseBaseHalfPendingTemplateSetups('{'), []);
		assert.deepStrictEqual(parseBaseHalfPendingTemplateSetups(JSON.stringify({ setup: valid })), []);
	});
});

const PENDING_TEMPLATE_SETUPS_STORAGE_KEY = 'basehalf.canvas.pendingTemplateSetups.v2';
const LEGACY_PENDING_TEMPLATE_SETUPS_STORAGE_KEY = 'basehalf.canvas.pendingTemplateSetups.v1';
const RESUME_TEMPLATE_SETUP_COMMAND_ID = 'basehalf.canvas.resumeTemplateSetup';
const TEMPLATE_ID = 'studio.test.starter';

interface ITemplateHarness {
	readonly fileService: FileService;
	readonly storageService: TestStorageService;
	readonly undoRedo: CountingUndoRedoService;
	readonly canvasMirror: BaseHalfCanvasMirrorService;
	readonly workspaceFolder: URI;
	readonly projectResource: URI;
	readonly projectFolder: IBaseHalfCanvasFolderState;
	readonly templateSource: string;
	/** Every store edit the template asked the reference edit service for. */
	readonly referenceEdits: readonly { readonly node: string; readonly operation: IBaseHalfReferenceStoreEdit['operation'] }[];
	readonly promptLabels: readonly (readonly string[])[];
	readonly selections: readonly { readonly folder: URI; readonly resources: readonly URI[] }[];
	/** The kinds whose last values the drafts of the template asked for. */
	readonly lastUsedKinds: readonly BaseHalfGenerationKind[];
	create(): Promise<void>;
	createWithCancellation(token: CancellationToken): Promise<void>;
	resume(): Promise<void>;
}

class CountingUndoRedoService extends UndoRedoService {
	readonly pushed: IUndoRedoElement[] = [];

	override pushElement(element: IUndoRedoElement, group?: UndoRedoGroup, source?: UndoRedoSource): void {
		this.pushed.push(element);
		super.pushElement(element, group, source);
	}
}

/**
 * Records the reference edits of template instantiation. A `transition` from
 * an empty list succeeds once; the snapshot then holds the target list.
 */
class RecordingReferenceEditService {
	readonly edits: { readonly node: string; readonly operation: IBaseHalfReferenceStoreEdit['operation'] }[] = [];
	private readonly snapshots = new Map<string, IBaseHalfUpstreamStoreSnapshot>();

	async apply(edits: readonly IBaseHalfReferenceStoreEdit[]): Promise<{ readonly stores: readonly never[]; readonly changed: boolean }> {
		for (const edit of edits) {
			this.edits.push({ node: edit.node.relativePath, operation: edit.operation });
			if (edit.operation.kind === 'transition') {
				this.snapshots.set(edit.node.relativePath, edit.operation.to);
			}
		}
		return { stores: [], changed: edits.length > 0 };
	}

	async readSnapshot(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamStoreSnapshot> {
		return this.snapshots.get(node.relativePath) ?? { items: [] };
	}
}

async function createTemplateHarness(
	disposables: Pick<DisposableStore, 'add'>,
	options: {
		readonly selectStopIfOffered?: boolean;
		readonly selectContinueIfOffered?: boolean;
		readonly templateSource?: string;
		readonly marked?: boolean;
		/** The last values of a generation on this computer; a still image model by default. */
		readonly lastUsed?: IBaseHalfVideoGenerationChoice;
	} = {}
): Promise<ITemplateHarness> {
	const scheme = 'basehalf-template-test';
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(scheme, disposables.add(new InMemoryFileSystemProvider())));
	const workspaceFolder = URI.from({ scheme, path: '/workspace' });
	const extensionLocation = URI.from({ scheme, path: '/extension' });
	await fileService.createFolder(workspaceFolder);
	await fileService.createFolder(extensionLocation);
	if (options.marked) {
		await fileService.createFile(joinPath(workspaceFolder, '.basehalf-no-workspace-setup'), VSBuffer.fromString(''));
	}

	const templateSource = options.templateSource ?? JSON.stringify({
		version: 1,
		files: [{ path: 'brief.md', contents: '# Brief\n\nKeep the subject centered.\n' }],
		drafts: [{ path: 'frame.png' }],
		cards: [
			{ path: 'brief.md', x: 40, y: 80, width: 240, height: 140 },
			{ path: 'frame.png', x: 380, y: 80, width: 260, height: 180 }
		],
		references: [{ from: 'brief.md', to: 'frame.png', fromAnchor: 'east', toAnchor: 'west' }]
	});
	await fileService.createFile(joinPath(extensionLocation, 'starter.json'), VSBuffer.fromString(templateSource));

	const templates = disposables.add(new BaseHalfCanvasTemplateRegistryService());
	disposables.add(templates.registerTemplate('studio.test', extensionLocation, {
		id: TEMPLATE_ID,
		label: 'Starter',
		resource: 'starter.json'
	}));

	const mutationCoordinator = new BaseHalfWorkspaceMutationCoordinator();
	const canvasMirror = disposables.add(new BaseHalfCanvasMirrorService(fileService, mutationCoordinator));
	const referenceEditService = new RecordingReferenceEditService();
	const storageService = disposables.add(new TestStorageService());
	const dialogService = new TestDialogService(undefined, { result: undefined });
	const promptLabels: string[][] = [];
	if (options.selectStopIfOffered || options.selectContinueIfOffered) {
		type TestPromptButton = { readonly label: string; readonly run: (context: { readonly checkboxChecked: boolean }) => unknown };
		Object.defineProperty(dialogService, 'prompt', {
			value: async (prompt: { readonly buttons?: readonly TestPromptButton[] }) => {
				const buttons = [...(prompt.buttons ?? [])];
				promptLabels.push(buttons.map(button => button.label));
				const continueSetup = options.selectContinueIfOffered
					? buttons.find(button => button.label.includes('Continue Setup'))
					: undefined;
				if (continueSetup) {
					return { result: await continueSetup.run({ checkboxChecked: false }) };
				}
				const stop = buttons.find(button => button.label.includes('Stop Setup'));
				return { result: stop ? await stop.run({ checkboxChecked: false }) : undefined };
			}
		});
	}
	const undoRedo = new CountingUndoRedoService(dialogService, new TestNotificationService());
	const projectResource = joinPath(workspaceFolder, 'Starter');
	const projectFolder: IBaseHalfCanvasFolderState = {
		resource: projectResource,
		workspaceFolder,
		relativePath: 'Starter',
		source: 'api'
	};
	const navigation = {
		_serviceBrand: undefined,
		onDidChangeState: Event.None,
		onDidChangeSurfaceActive: Event.None,
		state: {
			canvasFolder: { resource: workspaceFolder, workspaceFolder, relativePath: '', source: 'api' },
			cardDetail: undefined
		},
		isSurfaceActive: true,
		canGoBack: false,
		canGoForward: false,
		setSurfaceActive: () => undefined,
		openResource: async () => ({ handled: false, reason: 'unsupportedResource' as const })
	} as unknown as IBaseHalfCanvasNavigationService;
	const selections: { folder: URI; resources: readonly URI[] }[] = [];
	const editing = {
		beginPostCreateIntent: () => ({ generation: 1 }),
		invalidatePostCreateIntents: () => undefined,
		isPostCreateIntentCurrent: () => true,
		requestSelection: async (folder: URI, resources: readonly URI[]) => {
			selections.push({ folder, resources: [...resources] });
		}
	} as unknown as IBaseHalfCanvasEditingService;
	const configurationService = new TestConfigurationService({ explorer: { confirmUndo: 'default' } });
	const quickInputService = {
		pick: async (items: readonly unknown[]) => items[0]
	} as unknown as IQuickInputService;
	const workspaceContextService = {
		getWorkspace: () => ({
			id: 'workspace',
			folders: [{ uri: workspaceFolder, name: 'workspace', index: 0 }]
		}),
		getWorkspaceFolder: (resource: URI) => resource.scheme === workspaceFolder.scheme && (resource.path === workspaceFolder.path || resource.path.startsWith(`${workspaceFolder.path}/`))
			? { uri: workspaceFolder, name: 'workspace', index: 0, toResource: (path: string) => joinPath(workspaceFolder, path) }
			: null
	} as unknown as IWorkspaceContextService;
	const catalogService = { state: { kind: 'loading' } } as unknown as IBaseHalfVideoCatalogService;
	const lastUsed = Object.hasOwn(options, 'lastUsed') ? options.lastUsed : { provider: 'acme', model: 'acme-still', mode: 'frames' as const, params: { resolution: '2k' } };
	const lastUsedKinds: BaseHalfGenerationKind[] = [];
	const providerSettings = {
		getLastUsed: (kind: BaseHalfGenerationKind) => {
			lastUsedKinds.push(kind);
			return lastUsed;
		}
	} as unknown as IBaseHalfVideoProviderSettingsService;
	const notificationService = new TestNotificationService();
	// The real card store: a draft is its generation.yaml, made after its upstream list.
	const cardStore = disposables.add(new BaseHalfGenerationCardStore(
		fileService,
		workspaceContextService,
		disposables.add(new UriIdentityService(fileService)),
		referenceEditService as unknown as IBaseHalfReferenceEditService,
		canvasMirror,
		catalogService,
		notificationService,
		new NullLogService()
	));
	const services = new Map<unknown, unknown>([
		[IBaseHalfCanvasTemplateRegistryService, templates],
		[IFileService, fileService],
		[IBaseHalfCanvasNavigationService, navigation],
		[IBaseHalfCanvasEditingService, editing],
		[IBaseHalfCanvasMirrorService, canvasMirror],
		[IBaseHalfReferenceEditService, referenceEditService],
		[IBaseHalfGenerationCardStore, cardStore],
		[IBaseHalfVideoCatalogService, catalogService],
		[IBaseHalfVideoProviderSettingsService, providerSettings],
		[INotificationService, notificationService],
		[IConfigurationService, configurationService],
		[IStorageService, storageService],
		[IDialogService, dialogService],
		[IBaseHalfWorkspaceMutationCoordinator, mutationCoordinator],
		[IUndoRedoService, undoRedo],
		[IQuickInputService, quickInputService],
		[IWorkspaceContextService, workspaceContextService],
		[IWorkingCopyService, { dirtyWorkingCopies: [] }]
	]);
	const accessor = {
		get: <T>(service: unknown): T => {
			if (!services.has(service)) {
				throw new Error(`Unexpected service '${String(service)}'.`);
			}
			return services.get(service) as T;
		}
	} as ServicesAccessor;
	const createCommand = CommandsRegistry.getCommand(BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID);
	const resumeCommand = CommandsRegistry.getCommand(RESUME_TEMPLATE_SETUP_COMMAND_ID);
	assert.ok(createCommand);
	assert.ok(resumeCommand);

	return {
		fileService,
		storageService,
		undoRedo,
		canvasMirror,
		workspaceFolder,
		projectResource,
		projectFolder,
		templateSource,
		referenceEdits: referenceEditService.edits,
		promptLabels,
		selections,
		lastUsedKinds,
		create: async () => createCommand.handler(accessor, TEMPLATE_ID),
		createWithCancellation: async cancellationToken => createCommand.handler(accessor, {
			templateId: TEMPLATE_ID,
			targetFolder: workspaceFolder,
			cancellationToken
		}),
		resume: async () => resumeCommand.handler(accessor)
	};
}

async function readCreatedTemplateState(harness: ITemplateHarness) {
	const brief = (await harness.fileService.readFile(joinPath(harness.projectResource, 'brief.md'))).value.toString();
	return {
		brief,
		draft: await readDraft(harness),
		canvas: await harness.canvasMirror.readCanvas(harness.projectFolder)
	};
}

/** The `generation.yaml` of a draft of the project, or `undefined` when it has none. */
async function readDraft(harness: ITemplateHarness, path = 'frame.png'): Promise<string | undefined> {
	const resource = joinPath(harness.workspaceFolder, '.bh', 'mirror', 'Starter', ...path.split('/'), 'generation.yaml');
	return await harness.fileService.exists(resource) ? (await harness.fileService.readFile(resource)).value.toString() : undefined;
}

async function changeCreatedTemplateState(
	harness: ITemplateHarness,
	change: 'file' | 'extra-file' | 'card' | 'edge' | 'draft'
): Promise<void> {
	switch (change) {
		case 'file':
			await harness.fileService.writeFile(joinPath(harness.projectResource, 'brief.md'), VSBuffer.fromString('# Edited\n'));
			return;
		case 'extra-file':
			await harness.fileService.createFile(joinPath(harness.projectResource, 'user-added.md'), VSBuffer.fromString('# Keep me\n'));
			return;
		case 'card': {
			const canvas = await harness.canvasMirror.readCanvas(harness.projectFolder);
			const card = canvas?.cards.find(candidate => candidate.path === 'Starter/frame.png');
			assert.ok(card);
			await harness.canvasMirror.updateCardGeometry(harness.projectFolder, { ...card, x: card.x + 17 });
			return;
		}
		case 'edge':
			await harness.canvasMirror.removeCanvasEdge(harness.projectFolder, {
				from: 'Starter/brief.md',
				to: 'Starter/frame.png'
			});
			return;
		case 'draft':
			// An agent rewrites the draft's generation.yaml after creation.
			await harness.fileService.writeFile(joinPath(harness.workspaceFolder, '.bh', 'mirror', 'Starter', 'frame.png', 'generation.yaml'), VSBuffer.fromString('prompt: "A red kite over the dunes."\n'));
	}
}

async function storeRecoveryRecord(harness: ITemplateHarness): Promise<void> {
	const files = await Promise.all(['brief.md'].map(async path => ({
		path,
		digest: await sha256((await harness.fileService.readFile(joinPath(harness.projectResource, path))).value.buffer)
	})));
	harness.storageService.store(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, JSON.stringify([{
		id: 'recovery-test',
		templateId: TEMPLATE_ID,
		templateLabel: 'Starter',
		templateDigest: await sha256(new TextEncoder().encode(harness.templateSource)),
		files,
		workspaceFolder: harness.workspaceFolder.toString(),
		projectRelativePath: 'Starter',
		createdAt: '2026-07-18T10:00:00.000Z'
	}]), StorageScope.WORKSPACE, StorageTarget.MACHINE);
}

function clearCapturedUndo(harness: ITemplateHarness): void {
	for (const element of harness.undoRedo.pushed) {
		for (const resource of element.type === UndoRedoElementType.Workspace ? element.resources : [element.resource]) {
			harness.undoRedo.removeElements(resource);
		}
	}
	harness.undoRedo.pushed.length = 0;
}

async function snapshotWorkspace(fileService: IFileService, root: URI): Promise<readonly unknown[]> {
	const entries: unknown[] = [];
	const visit = async (resource: URI): Promise<void> => {
		const stat = await fileService.resolve(resource);
		const path = resource.path.slice(root.path.length) || '/';
		if (stat.isDirectory) {
			entries.push({ path, kind: 'folder' });
			for (const child of [...(stat.children ?? [])].sort((left, right) => left.resource.path.localeCompare(right.resource.path))) {
				await visit(child.resource);
			}
			return;
		}
		entries.push({ path, kind: 'file', contents: (await fileService.readFile(resource)).value.toString() });
	};
	await visit(root);
	return entries;
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function menuCommands(menuId: MenuId): [string | undefined, string][] {
	return MenuRegistry.getMenuItems(menuId)
		.filter(isIMenuItem)
		.map(item => [item.group, item.command.id] as [string | undefined, string])
		.sort((left, right) => left[1].localeCompare(right[1]));
}

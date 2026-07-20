/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../platform/dialogs/test/common/testDialogService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup, UndoRedoSource } from '../../../../platform/undoRedo/common/undoRedo.js';
import { UndoRedoService } from '../../../../platform/undoRedo/common/undoRedoService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { TestStorageService } from '../../../test/common/workbenchTestServices.js';
import { IBaseHalfNodeExecutionService } from '../../browser/basehalfNodeExecutionService.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';
import {
	BASEHALF_CANVAS_CARD_CONTEXT_MENU,
	BASEHALF_CANVAS_PANE_CONTEXT_MENU,
	baseHalfTemplateFolderBaseName,
	parseBaseHalfPendingTemplateSetups
} from '../../browser/basehalfCanvasContextMenu.js';
import { IBaseHalfBadgeGraphService, BaseHalfBadgeGraphService } from '../../common/basehalfBadgeGraph.js';
import { BaseHalfBadgeMirrorService, IBaseHalfBadgeNode } from '../../common/basehalfBadgeMirror.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../common/basehalfCanvasEditing.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasRecipeRegistryService, IBaseHalfCanvasRecipeRegistryService } from '../../common/basehalfCanvasRecipes.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID } from '../../common/basehalfCanvasTemplate.js';
import { BASEHALF_CANVAS_RUN_NODE_COMMAND_ID, createBaseHalfNodeDocument, parseBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

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
			['1_new', 'basehalf.canvas.newResultNode'],
			['5_transfer', 'basehalf.canvas.paste']
		]);
	});

	test('registers a hidden workspace-only run command that delegates to the node execution service', async () => {
		const command = CommandsRegistry.getCommand(BASEHALF_CANVAS_RUN_NODE_COMMAND_ID);
		assert.ok(command);
		assert.strictEqual(MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.some(item => item.command.id === BASEHALF_CANVAS_RUN_NODE_COMMAND_ID), false);
		const workspaceFolder = URI.file('/workspace');
		const resource = URI.file('/workspace/frame.bhnode');
		const result = createBaseHalfNodeDocument({ id: baseHalfNodeTestId(1), kind: 'image', title: 'Frame', role: 'result' });
		let received: unknown;
		const accessor = {
			get: <T>(service: unknown): T => {
				if (service === IWorkspaceContextService) {
					return { getWorkspaceFolder: (candidate: URI) => candidate.path.startsWith('/workspace/') ? { uri: workspaceFolder, name: 'workspace', index: 0 } : null } as T;
				}
				if (service === IBaseHalfNodeExecutionService) {
					return { run: async (node: unknown) => { received = node; return result; } } as T;
				}
				throw new Error('Unexpected service');
			}
		} as ServicesAccessor;

		assert.strictEqual(await command.handler(accessor, resource), result);
		assert.deepStrictEqual(received, { resource, workspaceFolder, relativePath: 'frame.bhnode' });
		assert.doesNotThrow(() => JSON.stringify(result));
		await assert.rejects(async () => command.handler(accessor, URI.file('/outside/frame.bhnode')), /inside the current workspace/);
		assert.throws(() => command.handler(accessor, 'frame.bhnode'), /workspace node URI/);
	});

	test('normalizes template folder labels to portable project segments', () => {
		assert.strictEqual(baseHalfTemplateFolderBaseName('.bh'), 'Canvas');
		assert.strictEqual(baseHalfTemplateFolderBaseName('CON'), 'Canvas');
		assert.strictEqual(baseHalfTemplateFolderBaseName('NUL.txt'), 'Canvas');
		assert.strictEqual(baseHalfTemplateFolderBaseName('Storyboard. '), 'Storyboard');
		assert.strictEqual(baseHalfTemplateFolderBaseName('Cafe\u0301'), 'Café');
	});

	test('creates one reversible template transaction with stable files, node identity, canvas, and references', async () => {
		const harness = await createTemplateHarness(disposables);
		await harness.create();

		assert.strictEqual(harness.undoRedo.pushed.length, 1);
		assert.deepStrictEqual(harness.undoRedo.getElements(harness.projectResource).past.length, 1);
		const created = await readCreatedTemplateState(harness);
		assert.ok(created.nodeId);
		assert.deepStrictEqual(created.canvas?.cards, [
			{ path: 'Starter/brief.md', kind: 'file', x: 40, y: 80, width: 240, height: 140 },
			{ path: 'Starter/frame.bhnode', kind: 'file', x: 380, y: 80, width: 260, height: 180 }
		]);
		assert.deepStrictEqual(created.canvas?.edges, [{
			from: 'Starter/brief.md',
			from_anchor: 'east',
			to: 'Starter/frame.bhnode',
			to_anchor: 'west'
		}]);
		assert.deepStrictEqual(created.sourceBadge?.references, ['Starter/frame.bhnode']);
		assert.deepStrictEqual(created.targetBadge?.referenced_by, ['Starter/brief.md']);

		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.strictEqual(await harness.fileService.exists(harness.projectResource), false);
		assert.strictEqual(await harness.canvasMirror.readCanvas(harness.projectFolder), null);
		assert.strictEqual(await harness.badgeGraph.readBadge(harness.sourceBadgeNode), null);
		assert.strictEqual(await harness.badgeGraph.readBadge(harness.targetBadgeNode), null);
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
		assert.strictEqual(harness.undoRedo.pushed.length, 0);
		assert.deepStrictEqual(parseBaseHalfPendingTemplateSetups(
			harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE)
		), []);
	});

	test('refuses template undo before writing when any owned file or metadata row changed', async () => {
		for (const change of ['file', 'extra-file', 'card', 'edge', 'reference'] as const) {
			const harness = await createTemplateHarness(disposables);
			await harness.create();
			await changeCreatedTemplateState(harness, change);
			const before = await snapshotWorkspace(harness.fileService, harness.workspaceFolder);

			await assert.rejects(async () => harness.undoRedo.pushed[0].undo(), Error, change);

			assert.deepStrictEqual(await snapshotWorkspace(harness.fileService, harness.workspaceFolder), before, change);
			assert.strictEqual(await harness.fileService.exists(harness.projectResource), true, change);
		}
	});

	test('refuses incomplete setup recovery before writing after files or metadata were changed', async () => {
		for (const change of ['file', 'card', 'edge', 'reference', 'card-and-edge'] as const) {
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

	test('finishes an unchanged setup with one undo element and the original stable node identity', async () => {
		const harness = await createTemplateHarness(disposables);
		await harness.create();
		const created = await readCreatedTemplateState(harness);
		assert.ok(created.canvas);
		await harness.canvasMirror.transitionCanvasState(harness.projectFolder, {
			cards: created.canvas.cards.map(card => ({ path: card.path, expected: card, next: null })),
			edges: created.canvas.edges.map(edge => ({ from: edge.from, to: edge.to, expected: edge, next: null }))
		});
		assert.strictEqual(await harness.badgeGraph.removeReference(harness.sourceBadgeNode, harness.targetBadgeNode), true);
		clearCapturedUndo(harness);
		await storeRecoveryRecord(harness);

		await harness.resume();

		assert.deepStrictEqual(await readCreatedTemplateState(harness), created);
		assert.strictEqual(harness.storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE), undefined);
		assert.strictEqual(harness.undoRedo.pushed.length, 1);
	});

	test('resumes an interrupted metadata commit only after explicit confirmation', async () => {
		const harness = await createTemplateHarness(disposables, { selectContinueIfOffered: true });
		await harness.create();
		const created = await readCreatedTemplateState(harness);
		const frameCard = created.canvas?.cards.find(card => card.path === 'Starter/frame.bhnode');
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

const PENDING_TEMPLATE_SETUPS_STORAGE_KEY = 'basehalf.canvas.pendingTemplateSetups.v1';
const RESUME_TEMPLATE_SETUP_COMMAND_ID = 'basehalf.canvas.resumeTemplateSetup';
const TEMPLATE_ID = 'studio.test.starter';

interface ITemplateHarness {
	readonly fileService: FileService;
	readonly storageService: TestStorageService;
	readonly undoRedo: CountingUndoRedoService;
	readonly canvasMirror: BaseHalfCanvasMirrorService;
	readonly badgeGraph: BaseHalfBadgeGraphService;
	readonly workspaceFolder: URI;
	readonly projectResource: URI;
	readonly projectFolder: IBaseHalfCanvasFolderState;
	readonly sourceBadgeNode: IBaseHalfBadgeNode;
	readonly targetBadgeNode: IBaseHalfBadgeNode;
	readonly templateSource: string;
	readonly promptLabels: readonly (readonly string[])[];
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

async function createTemplateHarness(
	disposables: Pick<DisposableStore, 'add'>,
	options: { readonly selectStopIfOffered?: boolean; readonly selectContinueIfOffered?: boolean } = {}
): Promise<ITemplateHarness> {
	const scheme = 'basehalf-template-test';
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(scheme, disposables.add(new InMemoryFileSystemProvider())));
	const workspaceFolder = URI.from({ scheme, path: '/workspace' });
	const extensionLocation = URI.from({ scheme, path: '/extension' });
	await fileService.createFolder(workspaceFolder);
	await fileService.createFolder(extensionLocation);

	const templateSource = JSON.stringify({
		version: 1,
		files: [{ path: 'brief.md', contents: '# Brief\n\nKeep the subject centered.\n' }],
		nodes: [{
			path: 'frame.bhnode',
			kind: 'image',
			title: 'Frame',
			role: 'Storyboard frame',
			recipe: {
				recipeId: 'studio.test.frame',
				parameters: {},
				inputBindings: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }]
			}
		}],
		cards: [
			{ path: 'brief.md', x: 40, y: 80, width: 240, height: 140 },
			{ path: 'frame.bhnode', x: 380, y: 80, width: 260, height: 180 }
		],
		references: [{ from: 'brief.md', to: 'frame.bhnode', fromAnchor: 'east', toAnchor: 'west' }]
	});
	await fileService.createFile(joinPath(extensionLocation, 'starter.json'), VSBuffer.fromString(templateSource));

	const recipes = disposables.add(new BaseHalfCanvasRecipeRegistryService());
	disposables.add(recipes.registerRecipe('studio.test', {
		id: 'studio.test.frame',
		label: 'Frame',
		inputs: [{ id: 'prompt', label: 'Prompt', accepts: ['text'], minItems: 1, maxItems: 1 }],
		outputs: [{ id: 'frame', kind: 'image', extensions: ['.svg'], minItems: 1, maxItems: 1, primary: true }]
	}));
	disposables.add(recipes.registerTemplate('studio.test', extensionLocation, {
		id: TEMPLATE_ID,
		label: 'Starter',
		resource: 'starter.json'
	}));

	const mutationCoordinator = new BaseHalfWorkspaceMutationCoordinator();
	const canvasMirror = new BaseHalfCanvasMirrorService(fileService, mutationCoordinator);
	const badgeGraph = new BaseHalfBadgeGraphService(new BaseHalfBadgeMirrorService(fileService), fileService, mutationCoordinator);
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
	const configurationService = new TestConfigurationService({ explorer: { confirmUndo: 'default' } });
	const quickInputService = {
		pick: async (items: readonly unknown[]) => items[0]
	} as unknown as IQuickInputService;
	const workspaceContextService = {
		getWorkspace: () => ({
			id: 'workspace',
			folders: [{ uri: workspaceFolder, name: 'workspace', index: 0 }]
		})
	} as unknown as IWorkspaceContextService;
	const services = new Map<unknown, unknown>([
		[IBaseHalfCanvasRecipeRegistryService, recipes],
		[IFileService, fileService],
		[IBaseHalfCanvasNavigationService, navigation],
		[IBaseHalfCanvasMirrorService, canvasMirror],
		[IBaseHalfBadgeGraphService, badgeGraph],
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
		badgeGraph,
		workspaceFolder,
		projectResource,
		projectFolder,
		sourceBadgeNode: templateBadgeNode(workspaceFolder, projectResource, 'brief.md'),
		targetBadgeNode: templateBadgeNode(workspaceFolder, projectResource, 'frame.bhnode'),
		templateSource,
		promptLabels,
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
	const node = (await harness.fileService.readFile(joinPath(harness.projectResource, 'frame.bhnode'))).value.toString();
	return {
		brief,
		node,
		nodeId: parseBaseHalfNodeDocument(node).id,
		canvas: await harness.canvasMirror.readCanvas(harness.projectFolder),
		sourceBadge: await harness.badgeGraph.readBadge(harness.sourceBadgeNode),
		targetBadge: await harness.badgeGraph.readBadge(harness.targetBadgeNode)
	};
}

async function changeCreatedTemplateState(
	harness: ITemplateHarness,
	change: 'file' | 'extra-file' | 'card' | 'edge' | 'reference'
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
			const card = canvas?.cards.find(candidate => candidate.path === 'Starter/frame.bhnode');
			assert.ok(card);
			await harness.canvasMirror.updateCardGeometry(harness.projectFolder, { ...card, x: card.x + 17 });
			return;
		}
		case 'edge':
			await harness.canvasMirror.removeCanvasEdge(harness.projectFolder, {
				from: 'Starter/brief.md',
				to: 'Starter/frame.bhnode'
			});
			return;
		case 'reference':
			assert.strictEqual(await harness.badgeGraph.removeReference(harness.sourceBadgeNode, harness.targetBadgeNode), true);
	}
}

async function storeRecoveryRecord(harness: ITemplateHarness): Promise<void> {
	const files = await Promise.all(['brief.md', 'frame.bhnode'].map(async path => ({
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

function templateBadgeNode(workspaceFolder: URI, projectResource: URI, path: string): IBaseHalfBadgeNode {
	return {
		resource: joinPath(projectResource, path),
		workspaceFolder,
		relativePath: `Starter/${path}`,
		kind: 'file'
	};
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

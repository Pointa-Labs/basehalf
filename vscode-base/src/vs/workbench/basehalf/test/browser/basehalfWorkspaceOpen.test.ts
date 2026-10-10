/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { MockContextKeyService } from '../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, IPromptChoice, IPromptOptions, Severity } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { InMemoryStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import {
	BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY,
	BASEHALF_CLEANUP_MIRROR_NOTICE_STORAGE_KEY,
	BaseHalfLegacyCleanupContribution,
	BaseHalfLegacyCleanupNotifier,
	IBaseHalfLegacyCleanupNotifier
} from '../../browser/basehalfLegacyCleanup.contribution.js';
import { BaseHalfReferenceIndexContribution } from '../../browser/basehalfReferences.contribution.js';
import { BaseHalfReferenceMigrationContribution, BaseHalfReferenceMigrationController } from '../../browser/basehalfReferenceMigration.contribution.js';
import { BaseHalfBadgeMirrorService } from '../../common/basehalfBadgeMirror.js';
import { IBaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigation.js';
import {
	BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY,
	BaseHalfCanvasViewportPersister,
	BaseHalfCanvasViewportStateService,
	baseHalfOpenCanvasViewport,
	IBaseHalfCanvasViewport,
	IBaseHalfCanvasViewportStateService
} from '../../common/basehalfCanvasViewportState.js';
import { BaseHalfLegacyCleanupService } from '../../common/basehalfLegacyCleanup.js';
import { BaseHalfLegacyMigrationGate } from '../../common/basehalfLegacyMigrationGate.js';
import { IBaseHalfReferenceEditService } from '../../common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService } from '../../common/basehalfReferenceIndex.js';
import { BaseHalfReferenceMigrationService } from '../../common/basehalfReferenceMigration.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';
import { BaseHalfInMemoryFileSearchService } from './basehalfReferenceTestFixtures.js';

class RecordingNotificationService extends TestNotificationService {
	readonly messages: string[] = [];

	override notify(notification: INotification): INotificationHandle {
		this.messages.push(String(notification.message));
		return super.notify(notification);
	}

	override prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		this.messages.push(message);
		return super.prompt(severity, message, choices, options);
	}
}

/** Every file below `root` with its text; directories end with `/`. */
async function readTree(fileService: IFileService, root: URI): Promise<Record<string, string>> {
	const tree: Record<string, string> = {};
	const visit = async (resource: URI, relative: string): Promise<void> => {
		const stat = await fileService.resolve(resource);
		for (const child of stat.children ?? []) {
			const path = relative ? `${relative}/${child.name}` : child.name;
			if (child.isDirectory) {
				tree[`${path}/`] = '';
				await visit(child.resource, path);
			} else {
				tree[path] = (await fileService.readFile(child.resource)).value.toString();
			}
		}
	};
	await visit(root, '');
	return tree;
}

suite('BaseHalfWorkspaceOpen', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const workspace = URI.file('/work');
	const notes = URI.joinPath(workspace, 'notes');

	/**
	 * Workspace-state acceptance 1: the workspace-open contributions leave a
	 * fresh folder untouched. The reference index build, the earlier-connection
	 * detection, and legacy cleanup run through their real workbench
	 * contributions and services, ordered by the real migration gate; each
	 * canvas opens its viewport through the same function the canvas workbench
	 * uses, with a stand-in scene.
	 */
	test('a fresh folder gets no .bh/ and no change to CLAUDE.md, AGENTS.md, or .gitignore', async () => {
		const provider = disposables.add(new InMemoryFileSystemProvider());
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, provider));
		const fresh: Record<string, string> = {
			'CLAUDE.md': '# My project\n\nMy own rules.\n',
			'.gitignore': 'node_modules/\n',
			'README.md': '# Readme\n',
			'notes/idea.md': '---\nupstream:\n  - README.md\n---\n# Idea\n'
		};
		for (const [path, content] of Object.entries(fresh)) {
			await fileService.writeFile(URI.joinPath(workspace, ...path.split('/')), VSBuffer.fromString(content));
		}
		const operations: string[] = [];
		disposables.add(fileService.onDidRunOperation(event => operations.push(`${event.operation} ${event.resource.path}`)));

		const storage = disposables.add(new InMemoryStorageService());
		const uriIdentityService = disposables.add(new UriIdentityService(fileService));
		const viewportState = disposables.add(new BaseHalfCanvasViewportStateService(storage, uriIdentityService));
		const cleanupService = new BaseHalfLegacyCleanupService(
			fileService,
			new NullLogService(),
			new BaseHalfWorkspaceMutationCoordinator(),
			viewportState,
			{ isDirty: () => false } as Partial<IWorkingCopyService> as IWorkingCopyService,
			{ getValue: () => undefined } as Partial<IConfigurationService> as IConfigurationService
		);
		const folder: IWorkspaceFolder = { uri: workspace, name: 'work', index: 0, toResource: path => URI.joinPath(workspace, path) };
		const contextService = {
			getWorkspace: () => ({ id: 'fresh', folders: [folder] }),
			getWorkspaceFolder: () => folder,
			onDidChangeWorkspaceFolders: Event.None
		} as Partial<IWorkspaceContextService> as IWorkspaceContextService;
		const notifications = new RecordingNotificationService();
		const gate = new BaseHalfLegacyMigrationGate();
		const canvasNavigation = {} as Partial<IBaseHalfCanvasNavigationService> as IBaseHalfCanvasNavigationService;
		const editorService = {} as Partial<IEditorService> as IEditorService;

		// 1. Workspace open: the reference index starts building every folder.
		const index = disposables.add(new BaseHalfReferenceIndexService(
			fileService,
			new BaseHalfInMemoryFileSearchService(fileService) as Partial<ISearchService> as ISearchService,
			contextService,
			uriIdentityService,
			new NullLogService()
		));
		disposables.add(new BaseHalfReferenceIndexContribution(index));

		// 2. Earlier-connection detection waits for the index; a folder without
		// legacy badge keys settles without a prompt or a write.
		const badgeMirror = disposables.add(new BaseHalfBadgeMirrorService(fileService));
		const migration = new BaseHalfReferenceMigrationService(
			fileService,
			contextService,
			uriIdentityService,
			badgeMirror,
			index,
			{} as Partial<IBaseHalfReferenceEditService> as IBaseHalfReferenceEditService,
			new BaseHalfWorkspaceMutationCoordinator(),
			new NullLogService()
		);
		const contextKeys = disposables.add(new MockContextKeyService());
		const migrationController = disposables.add(new BaseHalfReferenceMigrationController(
			contextService,
			migration,
			gate,
			badgeMirror,
			notifications,
			{} as Partial<IProgressService> as IProgressService,
			{} as Partial<IQuickInputService> as IQuickInputService,
			fileService,
			uriIdentityService,
			contextKeys,
			canvasNavigation,
			editorService,
			new NullLogService()
		));
		new BaseHalfReferenceMigrationContribution(migrationController);

		const notifier = disposables.add(new BaseHalfLegacyCleanupNotifier(
			contextService,
			cleanupService,
			gate,
			notifications,
			storage,
			uriIdentityService,
			fileService,
			{} as Partial<ICommandService> as ICommandService,
			canvasNavigation,
			editorService,
			new NullLogService()
		));

		// 3. The legacy cleanup contribution cleans each folder, then, once the
		// migration gate settles, looks for old agent instructions to offer
		// removing.
		const offered = new DeferredPromise<void>();
		const cleanupNotifier: IBaseHalfLegacyCleanupNotifier = {
			_serviceBrand: undefined,
			cleanFolder: resource => notifier.cleanFolder(resource),
			offerAgentGuideRemoval: () => notifier.offerAgentGuideRemoval().finally(() => offered.complete()),
			removeOldAgentInstructions: () => notifier.removeOldAgentInstructions()
		};
		disposables.add(new BaseHalfLegacyCleanupContribution(contextService, cleanupNotifier));
		await offered.p;

		// 4. Canvas open: the root canvas, then the notes canvas, each fitting
		// its content (source `auto`); then the user pans the notes canvas and
		// the canvas closes before the debounce ran.
		const persister = new BaseHalfCanvasViewportPersister(viewportState, storage);
		const shown: string[] = [];
		const openCanvas = (state: IBaseHalfCanvasViewportStateService, resource: URI, fitted: IBaseHalfCanvasViewport) => baseHalfOpenCanvasViewport(state, resource, workspace, {
			isCurrent: () => true,
			restore: async viewport => { shown.push(`restore ${resource.path} ${viewport.source} ${viewport.x},${viewport.y}@${viewport.zoom}`); },
			fit: async () => { shown.push(`fit ${resource.path}`); },
			persistFit: () => persister.schedule(0, { folder: resource, viewport: fitted, isCurrent: () => true })
		});
		const outcomes = [await openCanvas(viewportState, workspace, { x: 0, y: 0, zoom: 0.8, source: 'auto' })];
		await timeout(0);
		outcomes.push(await openCanvas(viewportState, notes, { x: 10, y: 20, zoom: 1, source: 'auto' }));
		await timeout(0);
		persister.schedule(200, { folder: notes, viewport: { x: 50, y: 60, zoom: 1.25, source: 'user' }, isCurrent: () => true });
		persister.dispose();

		// 5. Reopen (another window on the same workspace storage).
		const reopenedState = disposables.add(new BaseHalfCanvasViewportStateService(storage, uriIdentityService));
		reopenedState.settleLegacyImport(workspace);
		outcomes.push(await openCanvas(reopenedState, notes, { x: 0, y: 0, zoom: 1, source: 'auto' }));

		const readme = { resource: URI.joinPath(workspace, 'README.md'), workspaceFolder: workspace, relativePath: 'README.md' };
		assert.deepStrictEqual({
			index: index.getState(workspace),
			readmeDownstream: index.getDownstream(readme).map(entry => `${entry.node.relativePath} ${entry.storeKind}`),
			earlierConnections: contextKeys.getContextKeyValue('basehalf.references.hasEarlierConnections'),
			outcomes,
			shown,
			operations,
			notifications: notifications.messages,
			tree: await readTree(fileService, workspace),
			viewports: JSON.parse(storage.get(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, StorageScope.WORKSPACE) ?? '{}'),
			cleanupState: [
				storage.get(BASEHALF_CLEANUP_MIRROR_NOTICE_STORAGE_KEY, StorageScope.WORKSPACE),
				storage.get(BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY, StorageScope.WORKSPACE)
			]
		}, {
			index: 'ready',
			readmeDownstream: ['notes/idea.md markdown'],
			earlierConnections: false,
			outcomes: ['fitted', 'fitted', 'restored'],
			shown: ['fit /work', 'fit /work/notes', 'restore /work/notes user 50,60@1.25'],
			operations: [],
			notifications: [],
			tree: {
				'.gitignore': 'node_modules/\n',
				'CLAUDE.md': '# My project\n\nMy own rules.\n',
				'README.md': '# Readme\n',
				'notes/': '',
				'notes/idea.md': '---\nupstream:\n  - README.md\n---\n# Idea\n'
			},
			viewports: {
				[workspace.toString()]: { x: 0, y: 0, zoom: 0.8, source: 'auto' },
				[notes.toString()]: { x: 50, y: 60, zoom: 1.25, source: 'user' }
			},
			cleanupState: [undefined, undefined]
		});
	});
});

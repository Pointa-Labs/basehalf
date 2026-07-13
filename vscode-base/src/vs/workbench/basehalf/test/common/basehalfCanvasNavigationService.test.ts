/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileType, IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IWorkspace, IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { TestWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigationService.js';
import { BaseHalfCardProjectionRegistryService } from '../../common/basehalfCardDetail.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, BaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';

suite('BaseHalfCanvasNavigationService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');

	test('starts on the visible workspace root canvas', () => {
		const service = createService(new Map());

		assert.strictEqual(service.state.canvasFolder?.resource.fsPath, '/workspace');
		assert.strictEqual(service.state.canvasFolder?.workspaceFolder.fsPath, '/workspace');
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.canvasFolder?.source, 'api');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(service.canGoBack, false);
		assert.strictEqual(service.canGoForward, false);
	});

	test('opens workspace folders as canvas state and clears card detail', async () => {
		const service = createService(new Map([
			['/workspace/docs', aFileStat(URI.file('/workspace/docs'), FileType.Directory)]
		]));

		await service.openCardDetail(URI.file('/workspace/docs/readme.md'), { source: 'api' });
		const result = await service.openResource(URI.file('/workspace/docs'), { source: 'explorer' });

		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'canvasFolder');
		assert.strictEqual(service.state.canvasFolder?.relativePath, 'docs');
		assert.strictEqual(service.state.canvasFolder?.source, 'explorer');
		assert.strictEqual(service.state.cardDetail, undefined);
	});

	test('opens workspace files as card detail and preserves selection metadata', async () => {
		const service = createService(new Map([
			['/workspace/docs/readme.md', aFileStat(URI.file('/workspace/docs/readme.md'), FileType.File)]
		]));

		const result = await service.openResource(URI.file('/workspace/docs/readme.md'), {
			source: 'search',
			selection: { startLineNumber: 4, startColumn: 2, endLineNumber: 4, endColumn: 9 },
			pinned: true
		});

		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'cardDetail');
		assert.strictEqual(service.state.canvasFolder?.relativePath, 'docs');
		assert.strictEqual(service.state.canvasFolder?.resource.fsPath, '/workspace/docs');
		assert.strictEqual(service.state.canvasFolder?.source, 'search');
		assert.strictEqual(service.state.cardDetail?.relativePath, 'docs/readme.md');
		assert.strictEqual(service.state.cardDetail?.source, 'search');
		assert.deepStrictEqual(service.state.cardDetail?.selection, { startLineNumber: 4, startColumn: 2, endLineNumber: 4, endColumn: 9 });
		assert.strictEqual(service.state.cardDetail?.pinned, true);
		assert.strictEqual(service.state.cardDetail?.projection, 'rich');
	});

	test('opens root workspace files over the workspace root canvas', async () => {
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)]
		]));

		const result = await service.openResource(URI.file('/workspace/readme.md'), { source: 'explorer' });

		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'cardDetail');
		assert.strictEqual(service.state.canvasFolder?.resource.fsPath, '/workspace');
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail?.relativePath, 'readme.md');
		assert.strictEqual(service.state.cardDetail?.projection, 'rich');
	});

	test('opening another file moves the canvas to that file parent folder', async () => {
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)],
			['/workspace/docs/guide.md', aFileStat(URI.file('/workspace/docs/guide.md'), FileType.File)]
		]));

		await service.openResource(URI.file('/workspace/readme.md'), { source: 'explorer' });
		const result = await service.openResource(URI.file('/workspace/docs/guide.md'), { source: 'quickAccess' });

		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'cardDetail');
		assert.strictEqual(service.state.canvasFolder?.resource.fsPath, '/workspace/docs');
		assert.strictEqual(service.state.canvasFolder?.relativePath, 'docs');
		assert.strictEqual(service.state.canvasFolder?.source, 'quickAccess');
		assert.strictEqual(service.state.cardDetail?.relativePath, 'docs/guide.md');
	});

	test('uses the most specific workspace folder for nested multi-root workspaces', async () => {
		const service = createService(
			new Map([
				['/workspace/packages/app/readme.md', aFileStat(URI.file('/workspace/packages/app/readme.md'), FileType.File)]
			]),
			[URI.file('/workspace'), URI.file('/workspace/packages/app')]
		);

		const result = await service.openResource(URI.file('/workspace/packages/app/readme.md'), { source: 'explorer' });

		assert.strictEqual(result.handled, true);
		assert.strictEqual(service.state.canvasFolder?.workspaceFolder.fsPath, '/workspace/packages/app');
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail?.workspaceFolder.fsPath, '/workspace/packages/app');
		assert.strictEqual(service.state.cardDetail?.relativePath, 'readme.md');
	});

	test('preserves an explicitly requested source projection on card detail', async () => {
		const service = createService(new Map([
			['/workspace/docs/readme.md', aFileStat(URI.file('/workspace/docs/readme.md'), FileType.File)]
		]));

		const result = await service.openResource(URI.file('/workspace/docs/readme.md'), {
			source: 'explorer',
			projection: 'source'
		});

		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'cardDetail');
		assert.strictEqual(service.state.cardDetail?.projection, 'source');
	});

	test('uses source as the default projection for non-Markdown files', async () => {
		const service = createService(new Map([
			['/workspace/docs/app.ts', aFileStat(URI.file('/workspace/docs/app.ts'), FileType.File)]
		]));

		const result = await service.openResource(URI.file('/workspace/docs/app.ts'), { source: 'explorer' });

		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'cardDetail');
		assert.strictEqual(service.state.cardDetail?.projection, 'source');
	});

	test('normalizes unsupported Markdown-only projection requests for non-Markdown files to source', async () => {
		const service = createService(new Map([
			['/workspace/docs/app.ts', aFileStat(URI.file('/workspace/docs/app.ts'), FileType.File)]
		]));

		const result = await service.openResource(URI.file('/workspace/docs/app.ts'), {
			source: 'api',
			projection: 'preview'
		});

		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'cardDetail');
		assert.strictEqual(service.state.cardDetail?.projection, 'source');

		const richResult = await service.openResource(URI.file('/workspace/docs/app.ts'), {
			source: 'api',
			projection: 'rich'
		});

		assert.strictEqual(richResult.handled, true);
		assert.strictEqual(richResult.handled && richResult.target, 'cardDetail');
		assert.strictEqual(service.state.cardDetail?.projection, 'source');
	});

	test('reports outside workspace resources for fallback instead of mutating state', async () => {
		const service = createService(new Map([
			['/outside/readme.md', aFileStat(URI.file('/outside/readme.md'), FileType.File)]
		]));

		const result = await service.openResource(URI.file('/outside/readme.md'), { source: 'quickAccess' });

		assert.deepStrictEqual(result, { handled: false, reason: 'outsideWorkspace' });
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail, undefined);
	});

	test('reports missing or unreadable resources for fallback instead of mutating state', async () => {
		const service = createService(new Map());

		const result = await service.openResource(URI.file('/workspace/missing.md'), { source: 'explorer' });

		assert.deepStrictEqual(result, { handled: false, reason: 'missingOrUnreadable' });
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail, undefined);
	});

	test('emits state changes for open and close', async () => {
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)]
		]));
		const events: unknown[] = [];
		const disposable = service.onDidChangeState(state => events.push(state));

		await service.openResource(URI.file('/workspace/readme.md'), { source: 'api' });
		assert.strictEqual(await service.closeCardDetail(), true);

		disposable.dispose();
		assert.strictEqual(events.length, 2);
		assert.strictEqual(service.state.cardDetail, undefined);
	});

	test('publishes whether the BaseHalf surface owns global navigation', () => {
		const service = createService(new Map());
		const events: boolean[] = [];
		const disposable = service.onDidChangeSurfaceActive(active => events.push(active));

		assert.strictEqual(service.isSurfaceActive, false);
		service.setSurfaceActive(true);
		service.setSurfaceActive(true);
		service.setSurfaceActive(false);

		disposable.dispose();
		assert.deepStrictEqual(events, [true, false]);
		assert.strictEqual(service.isSurfaceActive, false);
	});

	test('tracks canvas navigation history for native back and forward controls', async () => {
		const service = createService(new Map([
			['/workspace/docs/guide.md', aFileStat(URI.file('/workspace/docs/guide.md'), FileType.File)]
		]));

		assert.strictEqual(service.canGoBack, false);
		assert.strictEqual(service.canGoForward, false);

		await service.openFolderCanvas(URI.file('/workspace/docs'), { source: 'explorer' });
		assert.strictEqual(service.canGoBack, true);

		await service.openCardDetail(URI.file('/workspace/docs/guide.md'), { source: 'explorer' });
		assert.strictEqual(service.state.cardDetail?.relativePath, 'docs/guide.md');
		assert.strictEqual(service.canGoBack, true);
		assert.strictEqual(service.canGoForward, false);

		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, 'docs');
		assert.strictEqual(typeof service.state.cardDetail, 'undefined');
		assert.strictEqual(service.canGoBack, true);
		assert.strictEqual(service.canGoForward, true);

		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(typeof service.state.cardDetail, 'undefined');
		assert.strictEqual(service.canGoBack, false);
		assert.strictEqual(service.canGoForward, true);

		assert.strictEqual(await service.goForward(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, 'docs');
		assert.strictEqual(typeof service.state.cardDetail, 'undefined');
		assert.strictEqual(service.canGoBack, true);
		assert.strictEqual(service.canGoForward, true);

		assert.strictEqual(await service.goForward(), true);
		const reopenedCard = service.state.cardDetail;
		assert.ok(reopenedCard);
		assert.strictEqual(reopenedCard.relativePath, 'docs/guide.md');
		assert.strictEqual(service.canGoBack, true);
		assert.strictEqual(service.canGoForward, false);
	});

	test('tracks the initial workspace canvas before the first card opens', async () => {
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)]
		]));

		assert.strictEqual(service.canGoBack, false);

		await service.openCardDetail(URI.file('/workspace/readme.md'), { source: 'api' });

		assert.strictEqual(service.state.cardDetail?.relativePath, 'readme.md');
		assert.strictEqual(service.canGoBack, true);

		assert.strictEqual(await service.goBack(), true);
		const canvasFolder: IBaseHalfCanvasFolderState | undefined = service.state.canvasFolder;
		assert.ok(canvasFolder);
		assert.strictEqual(canvasFolder.resource.fsPath, '/workspace');
		assert.strictEqual(canvasFolder.relativePath, '');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(service.canGoBack, false);
		assert.strictEqual(service.canGoForward, true);
	});

	test('structural card moves replace the current history entry', async () => {
		const service = createService(new Map());

		await service.openCardDetail(URI.file('/workspace/old.md'), { source: 'api' });
		await service.openCardDetail(URI.file('/workspace/new.md'), { source: 'api', history: 'replace' });

		assert.strictEqual(service.state.cardDetail?.relativePath, 'new.md');
		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(service.canGoBack, false);
		assert.strictEqual(await service.goForward(), true);
		const reopened = service.state.cardDetail as IBaseHalfCardDetailState | undefined;
		assert.strictEqual(reopened?.relativePath, 'new.md');
	});

	test('structural card deletion replaces the current entry without duplicating its canvas', async () => {
		const service = createService(new Map());

		await service.openCardDetail(URI.file('/workspace/deleted.md'), { source: 'api' });
		assert.strictEqual(service.canGoBack, true);
		let canGoBackWhenDeletionPublished: boolean | undefined;
		const listener = service.onDidChangeState(state => {
			if (!state.cardDetail) {
				canGoBackWhenDeletionPublished = service.canGoBack;
			}
		});
		assert.strictEqual(await service.closeCardDetail({ history: 'replace' }), true);
		listener.dispose();

		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(canGoBackWhenDeletionPublished, false);
		assert.strictEqual(service.canGoBack, false);
		assert.strictEqual(service.canGoForward, false);
	});

	test('does not add duplicate history entries for the same visible card target', async () => {
		const service = createService(new Map([
			['/workspace/docs/guide.md', aFileStat(URI.file('/workspace/docs/guide.md'), FileType.File)]
		]));

		await service.openFolderCanvas(URI.file('/workspace/docs'), { source: 'explorer' });
		await service.openCardDetail(URI.file('/workspace/docs/guide.md'), { source: 'explorer', pinned: false });
		await service.openCardDetail(URI.file('/workspace/docs/guide.md'), { source: 'fileCommand', pinned: true });

		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, 'docs');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(service.canGoBack, true);

		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(service.canGoBack, false);
	});

	test('projection switches replace the current location instead of polluting navigation history', async () => {
		const service = createService(new Map([
			['/workspace/docs/guide.md', aFileStat(URI.file('/workspace/docs/guide.md'), FileType.File)]
		]));

		await service.openFolderCanvas(URI.file('/workspace/docs'), { source: 'explorer' });
		await service.openCardDetail(URI.file('/workspace/docs/guide.md'), { source: 'explorer', projection: 'rich' });
		await service.openCardDetail(URI.file('/workspace/docs/guide.md'), { source: 'api', projection: 'preview', history: 'replace' });

		assert.strictEqual(service.state.cardDetail?.projection, 'preview');
		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, 'docs');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(await service.goForward(), true);
		const reopened = service.state.cardDetail as IBaseHalfCardDetailState | undefined;
		assert.strictEqual(reopened?.projection, 'preview');
	});

	test('view and selection changes within one card do not become visited locations', async () => {
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)]
		]));

		await service.openCardDetail(URI.file('/workspace/readme.md'), { source: 'api', projection: 'rich' });
		await service.openCardDetail(URI.file('/workspace/readme.md'), {
			source: 'fileCommand',
			projection: 'source',
			selection: {
				startLineNumber: 8,
				startColumn: 1,
				endLineNumber: 9,
				endColumn: 1
			}
		});

		assert.strictEqual(service.state.cardDetail?.projection, 'source');
		assert.strictEqual(service.state.cardDetail?.selection?.startLineNumber, 8);
		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.canvasFolder?.relativePath, '');
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(service.canGoBack, false);
	});

	test('keeps navigation history in place when dirty editor flush blocks back', async () => {
		const flushService = new BaseHalfEditorFlushService();
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)]
		]), [workspaceFolder], flushService);

		await service.openFolderCanvas(URI.file('/workspace'), { source: 'api' });
		await service.openCardDetail(URI.file('/workspace/readme.md'), { source: 'api' });
		const before = service.state;
		const blocker = flushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, async () => false);

		assert.strictEqual(await service.goBack(), false);
		assert.strictEqual(service.state, before);
		assert.strictEqual(service.canGoBack, true);
		assert.strictEqual(service.canGoForward, false);

		blocker.dispose();
		assert.strictEqual(await service.goBack(), true);
		assert.strictEqual(service.state.cardDetail, undefined);
		assert.strictEqual(service.canGoForward, true);
	});

	test('blocks file switches, folder opens, and closes when the current card detail cannot flush', async () => {
		const flushService = new BaseHalfEditorFlushService();
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)],
			['/workspace/docs', aFileStat(URI.file('/workspace/docs'), FileType.Directory)],
			['/workspace/docs/guide.md', aFileStat(URI.file('/workspace/docs/guide.md'), FileType.File)]
		]), [workspaceFolder], flushService);

		await service.openResource(URI.file('/workspace/readme.md'), { source: 'api' });
		const before = service.state;
		const blocker = flushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, async () => false);

		assert.deepStrictEqual(await service.openResource(URI.file('/workspace/docs/guide.md'), { source: 'api' }), { handled: false, reason: 'blockedByDirtyEditor' });
		assert.strictEqual(service.state, before);
		assert.deepStrictEqual(await service.openResource(URI.file('/workspace/docs'), { source: 'api' }), { handled: false, reason: 'blockedByDirtyEditor' });
		assert.strictEqual(service.state, before);
		assert.strictEqual(await service.closeCardDetail(), false);
		assert.strictEqual(service.state, before);

		blocker.dispose();
		const result = await service.openResource(URI.file('/workspace/docs/guide.md'), { source: 'api' });
		assert.strictEqual(result.handled, true);
		assert.strictEqual(result.handled && result.target, 'cardDetail');
		assert.strictEqual(service.state.cardDetail?.relativePath, 'docs/guide.md');
	});

	function createService(
		files: Map<string, IFileStat>,
		workspaceFolders: URI[] = [workspaceFolder],
		editorFlushService = new BaseHalfEditorFlushService()
	): BaseHalfCanvasNavigationService {
		const fileService = {
			onDidFilesChange: Event.None,
			onDidRunOperation: Event.None,
			onDidChangeFileSystemProviderRegistrations: Event.None,
			onDidChangeFileSystemProviderCapabilities: Event.None,
			hasProvider: () => true,
			hasCapability: () => true,
			resolve: async resource => {
				const stat = files.get(resource.fsPath);
				if (!stat) {
					throw new Error(`Missing test resource: ${resource.fsPath}`);
				}
				return stat;
			}
		} as Partial<IFileService> as IFileService;

		const uriIdentityService = disposables.add(new UriIdentityService(fileService));

		return disposables.add(new BaseHalfCanvasNavigationService(
			fileService,
			uriIdentityService,
			{
				getWorkbenchState: () => WorkbenchState.FOLDER,
				getWorkspace: () => ({
					...TestWorkspace,
					folders: workspaceFolders.map((uri, index) => ({ uri, name: uri.path.split('/').pop() ?? 'workspace', index }))
				}) as IWorkspace
			} as Partial<IWorkspaceContextService> as IWorkspaceContextService,
			editorFlushService,
			disposables.add(new BaseHalfCardProjectionRegistryService()),
			new TestNotificationService()
		));
	}

	function aFileStat(resource: URI, type: FileType): IFileStat {
		return {
			resource,
			name: resource.path.split('/').pop() ?? '',
			isFile: type === FileType.File,
			isDirectory: type === FileType.Directory,
			isSymbolicLink: false,
			mtime: 0,
			ctime: 0,
			size: 0,
			children: undefined
		};
	}
});

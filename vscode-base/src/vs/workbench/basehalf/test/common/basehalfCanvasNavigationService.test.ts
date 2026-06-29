/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileType, IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IWorkspace, IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { TestWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { BaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigationService.js';

suite('BaseHalfCanvasNavigationService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');

	test('opens workspace folders as canvas state and clears card detail', async () => {
		const service = createService(new Map([
			['/workspace/docs', aFileStat(URI.file('/workspace/docs'), FileType.Directory)]
		]));

		service.openCardDetail(URI.file('/workspace/docs/readme.md'), { source: 'api' });
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
		assert.strictEqual(service.state.cardDetail?.projection, 'source');
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
		assert.strictEqual(service.state.cardDetail?.projection, 'source');
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

	test('reports outside workspace resources for fallback instead of mutating state', async () => {
		const service = createService(new Map([
			['/outside/readme.md', aFileStat(URI.file('/outside/readme.md'), FileType.File)]
		]));

		const result = await service.openResource(URI.file('/outside/readme.md'), { source: 'quickAccess' });

		assert.deepStrictEqual(result, { handled: false, reason: 'outsideWorkspace' });
		assert.strictEqual(service.state.canvasFolder, undefined);
		assert.strictEqual(service.state.cardDetail, undefined);
	});

	test('reports missing or unreadable resources for fallback instead of mutating state', async () => {
		const service = createService(new Map());

		const result = await service.openResource(URI.file('/workspace/missing.md'), { source: 'explorer' });

		assert.deepStrictEqual(result, { handled: false, reason: 'missingOrUnreadable' });
		assert.strictEqual(service.state.canvasFolder, undefined);
		assert.strictEqual(service.state.cardDetail, undefined);
	});

	test('emits state changes for open and close', async () => {
		const service = createService(new Map([
			['/workspace/readme.md', aFileStat(URI.file('/workspace/readme.md'), FileType.File)]
		]));
		const events: unknown[] = [];
		const disposable = service.onDidChangeState(state => events.push(state));

		await service.openResource(URI.file('/workspace/readme.md'), { source: 'api' });
		service.closeCardDetail();

		disposable.dispose();
		assert.strictEqual(events.length, 2);
		assert.strictEqual(service.state.cardDetail, undefined);
	});

	function createService(files: Map<string, IFileStat>, workspaceFolders: URI[] = [workspaceFolder]): BaseHalfCanvasNavigationService {
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
			} as Partial<IWorkspaceContextService> as IWorkspaceContextService
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

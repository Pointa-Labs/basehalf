/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { IBaseHalfMirrorLinkService } from '../../../../platform/basehalf/common/basehalfMirrorLink.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { BaseHalfFocusMirrorService, serializeFileFocus, serializeFolderFocus } from '../../common/basehalfFocusMirrorService.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';

suite('BaseHalfFocusMirrorService', () => {
	const workspaceFolder = URI.file('/work');

	test('maps node resources to focus.yaml resources and current_focus symlink targets', () => {
		const { service } = createService();

		assert.strictEqual(service.focusResource(folder('')).fsPath, '/work/.bh/mirror/focus.yaml');
		assert.strictEqual(service.currentFocusTarget(''), 'mirror/focus.yaml');

		assert.strictEqual(service.focusResource(file('docs/readme.md')).fsPath, '/work/.bh/mirror/docs/readme.md/focus.yaml');
		assert.strictEqual(service.currentFocusTarget('docs/readme.md'), 'mirror/docs/readme.md/focus.yaml');
		assert.strictEqual(service.currentFocusResource(workspaceFolder).fsPath, '/work/.bh/current_focus.yaml');
	});

	test('serializes file focus using source coordinates', () => {
		assert.strictEqual(serializeFileFocus('docs/readme.md', {
			projection: 'source',
			visible_lines: { start: 4 },
			cursor: { line: 4, column: 2, line_precision: 'exact' }
		}), [
			'path: "docs/readme.md"',
			'kind: file',
			'projection: source',
			'visible_lines:',
			'  start: 4',
			'cursor:',
			'  line: 4',
			'  column: 2',
			'  line_precision: exact',
			''
		].join('\n'));
	});

	test('serializes preview focus without source coordinates', () => {
		assert.strictEqual(serializeFileFocus('docs/readme.md', {
			projection: 'preview'
		}), [
			'path: "docs/readme.md"',
			'kind: file',
			'projection: preview',
			''
		].join('\n'));
	});

	test('serializes folder focus with viewport center and zoom', () => {
		assert.strictEqual(serializeFolderFocus('', {
			viewport_center: { x: 320.12344, y: 240.98765 },
			zoom: 1
		}), [
			'path: ""',
			'kind: folder',
			'viewport_center:',
			'  x: 320.1234',
			'  y: 240.9877',
			'zoom: 1',
			''
		].join('\n'));
	});

	test('writes file focus.yaml and points current_focus.yaml at it', async () => {
		const { service, fileService, mirrorLinkService } = createService();

		await service.writeFileFocus(file('docs/readme.md'), {
			projection: 'source',
			visible_lines: { start: 8 },
			cursor: { line: 9, column: 3, line_precision: 'exact' }
		});

		assert.deepStrictEqual(fileService.createdFolders.map(resource => resource.fsPath), ['/work/.bh/mirror/docs/readme.md']);
		assert.strictEqual(fileService.writes.length, 1);
		assert.strictEqual(fileService.writes[0].resource.fsPath, '/work/.bh/mirror/docs/readme.md/focus.yaml');
		assert.strictEqual(fileService.writes[0].content, [
			'path: "docs/readme.md"',
			'kind: file',
			'projection: source',
			'visible_lines:',
			'  start: 8',
			'cursor:',
			'  line: 9',
			'  column: 3',
			'  line_precision: exact',
			''
		].join('\n'));
		assert.deepStrictEqual(mirrorLinkService.links, [{
			currentFocusFsPath: '/work/.bh/current_focus.yaml',
			target: 'mirror/docs/readme.md/focus.yaml'
		}]);
	});

	test('writes folder focus and refreshes current_focus.yaml even when content is unchanged', async () => {
		const { service, fileService, mirrorLinkService } = createService();

		await service.writeFolderFocus(folder('docs'), {
			viewport_center: { x: 100, y: 200 },
			zoom: 1
		});
		await service.writeFolderFocus(folder('docs'), {
			viewport_center: { x: 100, y: 200 },
			zoom: 1
		});

		assert.strictEqual(fileService.writes.length, 1);
		assert.strictEqual(fileService.writes[0].resource.fsPath, '/work/.bh/mirror/docs/focus.yaml');
		assert.strictEqual(mirrorLinkService.links.length, 2);
		assert.strictEqual(mirrorLinkService.links[1].target, 'mirror/docs/focus.yaml');
	});

	function file(relativePath: string): IBaseHalfCardDetailState {
		const resource = URI.joinPath(workspaceFolder, ...relativePath.split('/'));
		return {
			resource,
			workspaceFolder,
			relativePath,
			source: 'api',
			projection: 'source'
		};
	}

	function folder(relativePath: string): IBaseHalfCanvasFolderState {
		return {
			resource: relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			source: 'api'
		};
	}

	function createService(): {
		service: BaseHalfFocusMirrorService;
		fileService: TestFileService;
		mirrorLinkService: TestMirrorLinkService;
	} {
		const fileService = new TestFileService();
		const mirrorLinkService = new TestMirrorLinkService();
		const service = new BaseHalfFocusMirrorService(
			fileService as Partial<IFileService> as IFileService,
			{ extUri } as Partial<IUriIdentityService> as IUriIdentityService,
			mirrorLinkService,
			{ error: () => undefined } as Partial<ILogService> as ILogService
		);

		return { service, fileService, mirrorLinkService };
	}
});

class TestFileService {
	readonly createdFolders: URI[] = [];
	readonly writes: { resource: URI; content: string }[] = [];

	async createFolder(resource: URI): Promise<IFileStat> {
		this.createdFolders.push(resource);
		return stat(resource);
	}

	async writeFile(resource: URI, buffer: VSBuffer): Promise<IFileStat> {
		this.writes.push({ resource, content: buffer.toString() });
		return stat(resource);
	}
}

class TestMirrorLinkService implements IBaseHalfMirrorLinkService {
	declare readonly _serviceBrand: undefined;
	readonly links: { currentFocusFsPath: string; target: string }[] = [];

	async setCurrentFocusSymlink(currentFocusFsPath: string, target: string): Promise<void> {
		this.links.push({ currentFocusFsPath, target });
	}
}

function stat(resource: URI): IFileStat {
	return {
		resource,
		name: resource.path.split('/').pop() ?? '',
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		mtime: 0,
		ctime: 0,
		size: 0,
		children: undefined
	};
}

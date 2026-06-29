/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import {
	FileOperationError,
	FileOperationResult,
	IFileService
} from '../../../../platform/files/common/files.js';
import { BaseHalfCanvasMirrorCorrupt, BaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState } from '../../common/basehalfCanvasNavigation.js';

suite('BaseHalfCanvasMirrorService', () => {
	const workspaceFolder = URI.file('/work');

	test('maps root and nested folders to their canvas.yaml resources', () => {
		const service = createService(new Map());

		assert.strictEqual(service.canvasResource(folder('')).fsPath, '/work/.bh/mirror/canvas.yaml');
		assert.strictEqual(
			service.canvasResource(folder('docs/chapter')).fsPath,
			'/work/.bh/mirror/docs/chapter/canvas.yaml'
		);
	});

	test('returns null when canvas.yaml is absent', async () => {
		const service = createService(new Map());

		assert.strictEqual(await service.readCanvas(folder('docs')), null);
	});

	test('reads and normalizes canvas.yaml cards, edges, and size', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/canvas.yaml', [
				'path: docs',
				'size:',
				'  width: 1200',
				'  height: 800',
				'cards:',
				'  - path: docs/a.md',
				'    kind: file',
				'    x: 10',
				'    y: 20',
				'    width: 260',
				'    height: 140',
				'edges:',
				'  - from: docs/a.md',
				'    from_anchor: east',
				'    to: docs/b.md',
				'    to_anchor: west',
				'    label: continues',
				''
			].join('\n')]
		]));

		const canvas = await service.readCanvas(folder('docs'));

		assert.deepStrictEqual(canvas, {
			path: 'docs',
			size: { width: 1200, height: 800 },
			cards: [{ path: 'docs/a.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 }],
			edges: [{
				from: 'docs/a.md',
				from_anchor: 'east',
				to: 'docs/b.md',
				to_anchor: 'west',
				label: 'continues'
			}]
		});
	});

	test('throws a typed corrupt error for invalid YAML', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', 'path: : broken']
		]));

		await assert.rejects(
			() => service.readCanvas(folder('')),
			error => error instanceof BaseHalfCanvasMirrorCorrupt && error.reason === 'YAML parse failed'
		);
	});

	test('throws a typed corrupt error when the stored path does not match the folder', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/canvas.yaml', 'path: other\ncards: []\nedges: []\n']
		]));

		await assert.rejects(
			() => service.readCanvas(folder('docs')),
			error => error instanceof BaseHalfCanvasMirrorCorrupt && error.reason === 'path must be "docs"'
		);
	});

	function folder(relativePath: string): IBaseHalfCanvasFolderState {
		return {
			resource: relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			source: 'api'
		};
	}

	function createService(files: Map<string, string>): BaseHalfCanvasMirrorService {
		const fileService = {
			readFile: async resource => {
				const raw = files.get(resource.fsPath);
				if (raw === undefined) {
					throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
				}

				return { value: VSBuffer.fromString(raw) };
			}
		} as Partial<IFileService> as IFileService;

		return new BaseHalfCanvasMirrorService(fileService);
	}
});

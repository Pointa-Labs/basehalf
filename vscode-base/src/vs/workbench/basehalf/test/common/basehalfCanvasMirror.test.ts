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
	FileType,
	IFileService,
	IFileStat
} from '../../../../platform/files/common/files.js';
import { BaseHalfCanvasMirrorCorrupt, BaseHalfCanvasMirrorService, serializeCanvasFile, upsertCanvasCard } from '../../common/basehalfCanvasMirror.js';
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

	test('accepts VS Code YAML parser syntax for quoted values and inline empty arrays', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/canvas.yaml', [
				'path: "docs"',
				'size: { width: 640, height: 360 }',
				'cards:',
				`  - path: 'docs/a:b.md'`,
				'    kind: file',
				'    x: 1',
				'    y: 2',
				'    width: 3',
				'    height: 4',
				'edges: []',
				''
			].join('\n')]
		]));

		const canvas = await service.readCanvas(folder('docs'));

		assert.deepStrictEqual(canvas, {
			path: 'docs',
			size: { width: 640, height: 360 },
			cards: [{ path: 'docs/a:b.md', kind: 'file', x: 1, y: 2, width: 3, height: 4 }],
			edges: []
		});
	});

	test('throws a typed corrupt error for invalid YAML', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', 'path: [unterminated']
		]));

		await assert.rejects(
			() => service.readCanvas(folder('')),
			error => error instanceof BaseHalfCanvasMirrorCorrupt
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

	test('serializes canvas.yaml with stable fields, cards, and edges', () => {
		assert.strictEqual(serializeCanvasFile({
			path: 'docs',
			size: { width: 1200.12345, height: 800 },
			cards: [{ path: 'docs/a.md', kind: 'file', x: -10.12345, y: -20, width: 260, height: 140 }],
			edges: [{ from: 'docs/a.md', from_anchor: 'east', to: 'docs/b.md', to_anchor: 'west', label: 'continues' }]
		}), [
			'path: "docs"',
			'size:',
			'  width: 1200.1235',
			'  height: 800',
			'cards:',
			'  - path: "docs/a.md"',
			'    kind: file',
			'    x: -10.1235',
			'    y: -20',
			'    width: 260',
			'    height: 140',
			'edges:',
			'  - from: "docs/a.md"',
			'    from_anchor: east',
			'    to: "docs/b.md"',
			'    to_anchor: west',
			'    label: "continues"',
			''
		].join('\n'));
		assert.strictEqual(serializeCanvasFile({ path: '', cards: [], edges: [] }), [
			'path: ""',
			'cards: []',
			'edges: []',
			''
		].join('\n'));
	});

	test('upserts card geometry while preserving canvas size and edges', () => {
		const canvas = {
			path: '',
			size: { width: 1000, height: 800 },
			cards: [{ path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 3, height: 4 }],
			edges: [{ from: 'a.md', from_anchor: 'east' as const, to: 'b.md', to_anchor: 'west' as const }]
		};

		assert.deepStrictEqual(upsertCanvasCard(canvas, { path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }), {
			path: '',
			size: { width: 1000, height: 800 },
			cards: [{ path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }],
			edges: [{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' }]
		});
		assert.deepStrictEqual(upsertCanvasCard(canvas, { path: 'b.md', kind: 'file', x: 30, y: 40, width: 220, height: 112 }).cards, [
			{ path: 'a.md', kind: 'file', x: 1, y: 2, width: 3, height: 4 },
			{ path: 'b.md', kind: 'file', x: 30, y: 40, width: 220, height: 112 }
		]);
	});

	test('creates canvas.yaml when writing card geometry for a folder without a mirror file', async () => {
		const fileService = new TestFileService(new Map());
		const service = new BaseHalfCanvasMirrorService(fileService as unknown as IFileService);

		const canvas = await service.updateCardGeometry(folder('docs'), {
			path: 'docs/a.md',
			kind: 'file',
			x: 10,
			y: 20,
			width: 220,
			height: 112
		});

		assert.deepStrictEqual(canvas, {
			path: 'docs',
			cards: [{ path: 'docs/a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }],
			edges: []
		});
		assert.deepStrictEqual(fileService.createdFolders.map(resource => resource.fsPath), ['/work/.bh/mirror/docs']);
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/docs/canvas.yaml'), [
			'path: "docs"',
			'cards:',
			'  - path: "docs/a.md"',
			'    kind: file',
			'    x: 10',
			'    y: 20',
			'    width: 220',
			'    height: 112',
			'edges: []',
			''
		].join('\n'));
	});

	test('updates card geometry from the latest canvas.yaml and preserves edges', async () => {
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'size:',
				'  width: 1200',
				'  height: 800',
				'cards:',
				'  - path: a.md',
				'    kind: file',
				'    x: 1',
				'    y: 2',
				'    width: 220',
				'    height: 112',
				'edges:',
				'  - from: a.md',
				'    from_anchor: east',
				'    to: b.md',
				'    to_anchor: west',
				'    label: next',
				''
			].join('\n')]
		]));
		const service = new BaseHalfCanvasMirrorService(fileService as unknown as IFileService);

		await service.updateCardGeometry(folder(''), {
			path: 'a.md',
			kind: 'file',
			x: 40,
			y: 50,
			width: 240,
			height: 120
		});

		assert.strictEqual(fileService.files.get('/work/.bh/mirror/canvas.yaml'), [
			'path: ""',
			'size:',
			'  width: 1200',
			'  height: 800',
			'cards:',
			'  - path: "a.md"',
			'    kind: file',
			'    x: 40',
			'    y: 50',
			'    width: 240',
			'    height: 120',
			'edges:',
			'  - from: "a.md"',
			'    from_anchor: east',
			'    to: "b.md"',
			'    to_anchor: west',
			'    label: "next"',
			''
		].join('\n'));
	});

	test('does not overwrite corrupt canvas.yaml while writing card geometry', async () => {
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/canvas.yaml', 'path: [unterminated']
		]));
		const service = new BaseHalfCanvasMirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }),
			error => error instanceof BaseHalfCanvasMirrorCorrupt
		);
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/canvas.yaml'), 'path: [unterminated');
	});

	test('serializes concurrent card geometry writes through one latest-read path', async () => {
		const fileService = new TestFileService(new Map());
		const service = new BaseHalfCanvasMirrorService(fileService as unknown as IFileService);

		await Promise.all([
			service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }),
			service.updateCardGeometry(folder(''), { path: 'b.md', kind: 'file', x: 300, y: 20, width: 220, height: 112 })
		]);

		assert.deepStrictEqual((await service.readCanvas(folder('')))?.cards.map(card => card.path).sort(), ['a.md', 'b.md']);
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
		return new BaseHalfCanvasMirrorService(new TestFileService(files) as unknown as IFileService);
	}
});

class TestFileService {
	readonly files: Map<string, string>;
	readonly createdFolders: URI[] = [];

	constructor(files: Map<string, string>) {
		this.files = files;
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer }> {
		const raw = this.files.get(resource.fsPath);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		return { value: VSBuffer.fromString(raw) };
	}

	async createFolder(resource: URI): Promise<IFileStat> {
		this.createdFolders.push(resource);
		return stat(resource, FileType.Directory);
	}

	async writeFile(resource: URI, buffer: VSBuffer): Promise<IFileStat> {
		this.files.set(resource.fsPath, buffer.toString());
		return stat(resource, FileType.File);
	}
}

function stat(resource: URI, type: FileType): IFileStat {
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

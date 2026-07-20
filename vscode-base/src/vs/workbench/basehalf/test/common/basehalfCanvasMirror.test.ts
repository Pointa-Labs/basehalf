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
import { BaseHalfCanvasMirrorCorrupt, BaseHalfCanvasMirrorService, BaseHalfCanvasStateConflict, serializeCanvasFile, upsertCanvasCard } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfMirrorSymbolicLinkError } from '../../common/basehalfMirrorTree.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

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
				to_anchor: 'west'
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

	test('canonicalizes duplicate cards and edges with deterministic last-wins semantics', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const fileService = new TestFileService(new Map([[canvasPath, [
			'path: ""',
			'cards:',
			'  - path: "a.md"',
			'    kind: file',
			'    x: 1',
			'    y: 2',
			'    width: 220',
			'    height: 112',
			'  - path: "a.md"',
			'    kind: file',
			'    x: 9',
			'    y: 10',
			'    width: 240',
			'    height: 120',
			'edges:',
			'  - from: "a.md"',
			'    from_anchor: east',
			'    to: "b.md"',
			'    to_anchor: west',
			'  - from: "a.md"',
			'    from_anchor: south',
			'    to: "b.md"',
			'    to_anchor: north',
			''
		].join('\n')]]));
		const service = mirrorService(fileService as unknown as IFileService);

		assert.deepStrictEqual(await service.readCanvas(folder('')), {
			path: '',
			cards: [{ path: 'a.md', kind: 'file', x: 9, y: 10, width: 240, height: 120 }],
			edges: [{ from: 'a.md', from_anchor: 'south', to: 'b.md', to_anchor: 'north' }]
		});
		await service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 40, y: 50, width: 240, height: 120 });
		assert.strictEqual((fileService.files.get(canvasPath)?.match(/- path: "a\.md"/g) ?? []).length, 1);
		assert.strictEqual((fileService.files.get(canvasPath)?.match(/- from: "a\.md"/g) ?? []).length, 1);
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
			edges: [{ from: 'docs/a.md', from_anchor: 'east', to: 'docs/b.md', to_anchor: 'west' }]
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
		const service = mirrorService(fileService as unknown as IFileService);

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
				''
			].join('\n')]
		]));
		const service = mirrorService(fileService as unknown as IFileService);

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
			''
		].join('\n'));
	});

	test('atomically updates multiple card geometries while preserving size, edges, and other cards', async () => {
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'size:',
				'  width: 1200',
				'  height: 800',
				'cards:',
				'  - path: "a.md"',
				'    kind: file',
				'    x: 1',
				'    y: 2',
				'    width: 220',
				'    height: 112',
				'  - path: "untouched.md"',
				'    kind: file',
				'    x: 300',
				'    y: 20',
				'    width: 220',
				'    height: 112',
				'edges:',
				'  - from: "a.md"',
				'    from_anchor: east',
				'    to: "untouched.md"',
				'    to_anchor: west',
				''
			].join('\n')]
		]));
		const service = mirrorService(fileService as unknown as IFileService);

		const updated = await service.updateCardGeometries(folder(''), [
			{ path: 'a.md', kind: 'file', x: 40, y: 50, width: 240, height: 120 },
			{ path: 'new.md', kind: 'file', x: 600, y: 70, width: 260, height: 140 }
		]);

		assert.strictEqual(fileService.writeCount, 1);
		assert.deepStrictEqual(updated, {
			path: '',
			size: { width: 1200, height: 800 },
			cards: [
				{ path: 'a.md', kind: 'file', x: 40, y: 50, width: 240, height: 120 },
				{ path: 'untouched.md', kind: 'file', x: 300, y: 20, width: 220, height: 112 },
				{ path: 'new.md', kind: 'file', x: 600, y: 70, width: 260, height: 140 }
			],
			edges: [{ from: 'a.md', from_anchor: 'east', to: 'untouched.md', to_anchor: 'west' }]
		});
		assert.deepStrictEqual(await service.readCanvas(folder('')), updated);
	});

	test('transitions card geometry exactly and preserves unrelated latest rows', async () => {
		const before = { path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 220, height: 112 };
		const after = { ...before, x: 40, y: 50 };
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', serializeCanvasFile({
				path: '',
				cards: [before, { path: 'other.md', kind: 'file', x: 300, y: 20, width: 220, height: 112 }],
				edges: []
			})]
		]));

		await service.transitionCanvasState(folder(''), {
			cards: [{ path: 'a.md', expected: before, next: after }]
		});

		assert.deepStrictEqual((await service.readCanvas(folder('')))?.cards, [
			{ path: 'other.md', kind: 'file', x: 300, y: 20, width: 220, height: 112 },
			after
		]);
	});

	test('card state transition fails closed when the touched row changed', async () => {
		const current = { path: 'a.md', kind: 'file' as const, x: 9, y: 2, width: 220, height: 112 };
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', serializeCanvasFile({ path: '', cards: [current], edges: [] })]
		]));

		await assert.rejects(() => service.transitionCanvasState(folder(''), {
			cards: [{
				path: 'a.md',
				expected: { ...current, x: 1 },
				next: { ...current, x: 40 }
			}]
		}), error => error instanceof BaseHalfCanvasStateConflict);

		assert.deepStrictEqual((await service.readCanvas(folder('')))?.cards, [current]);
	});

	test('treats an empty card geometry batch as a read-only no-op', async () => {
		const existingRaw = 'path: ""\ncards: []\nedges: []\n';
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/canvas.yaml', existingRaw]
		]));
		const service = mirrorService(fileService as unknown as IFileService);

		assert.strictEqual(await service.updateCardGeometries(folder(''), []), null);
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/canvas.yaml'), existingRaw);
		assert.strictEqual(fileService.writeCount, 0);

		const absentFileService = new TestFileService(new Map());
		const absentService = mirrorService(absentFileService as unknown as IFileService);
		assert.strictEqual(await absentService.updateCardGeometries(folder('docs'), []), null);
		assert.strictEqual(absentFileService.writeCount, 0);
		assert.deepStrictEqual(absentFileService.createdFolders, []);
	});

	test('does not overwrite corrupt canvas.yaml while writing card geometry', async () => {
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/canvas.yaml', 'path: [unterminated']
		]));
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }),
			error => error instanceof BaseHalfCanvasMirrorCorrupt
		);
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/canvas.yaml'), 'path: [unterminated');
	});

	test('serializes concurrent card geometry writes through one latest-read path', async () => {
		const fileService = new TestFileService(new Map());
		const service = mirrorService(fileService as unknown as IFileService);

		await Promise.all([
			service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }),
			service.updateCardGeometry(folder(''), { path: 'b.md', kind: 'file', x: 300, y: 20, width: 220, height: 112 })
		]);

		assert.deepStrictEqual((await service.readCanvas(folder('')))?.cards.map(card => card.path).sort(), ['a.md', 'b.md']);
	});

	test('replays a geometry update on an external canvas edit instead of overwriting it', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const fileService = new TestFileService(new Map([[canvasPath, [
			'path: ""',
			'cards:',
			'  - path: "a.md"',
			'    kind: file',
			'    x: 1',
			'    y: 2',
			'    width: 220',
			'    height: 112',
			'edges: []',
			''
		].join('\n')]]));
		fileService.editExternallyOnNextWrite(canvasPath, raw => raw.replace('edges: []', [
			'edges:',
			'  - from: "a.md"',
			'    from_anchor: east',
			'    to: "b.md"',
			'    to_anchor: west'
		].join('\n')));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 40, y: 50, width: 240, height: 120 });

		const updated = await service.readCanvas(folder(''));
		assert.deepStrictEqual(updated?.cards[0], { path: 'a.md', kind: 'file', x: 40, y: 50, width: 240, height: 120 });
		assert.deepStrictEqual(updated?.edges, [{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' }]);
		assert.strictEqual(fileService.writeCount, 2);
		assert.strictEqual(fileService.lastWriteWasAtomic, true);
	});

	test('replays an equal-length external canvas rewrite detected by exact bytes', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const initial = [
			'path: ""',
			'cards:',
			'  - path: "a.md"',
			'    kind: file',
			'    x: 1',
			'    y: 2',
			'    width: 220',
			'    height: 112',
			'edges:',
			'  - from: "a.md"',
			'    from_anchor: east',
			'    to: "b.md"',
			'    to_anchor: west',
			''
		].join('\n');
		const external = initial.replace('from_anchor: east', 'from_anchor: west');
		assert.strictEqual(VSBuffer.fromString(initial).byteLength, VSBuffer.fromString(external).byteLength);
		const fileService = new TestFileService(new Map([[canvasPath, initial]]));
		fileService.editExternallyOnNextWrite(canvasPath, () => external);
		const service = mirrorService(fileService as unknown as IFileService);

		await service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 40, y: 50, width: 220, height: 112 });

		const updated = await service.readCanvas(folder(''));
		assert.deepStrictEqual(updated?.edges[0], { from: 'a.md', from_anchor: 'west', to: 'b.md', to_anchor: 'west' });
		assert.deepStrictEqual(updated?.cards[0], { path: 'a.md', kind: 'file', x: 40, y: 50, width: 220, height: 112 });
		assert.strictEqual(fileService.writeCount, 2);
	});

	test('replays an absent create race and merges the external canvas', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const fileService = new TestFileService(new Map());
		fileService.createExternallyOnNextCreate(canvasPath, [
			'path: ""',
			'cards:',
			'  - path: "external.md"',
			'    kind: file',
			'    x: 300',
			'    y: 20',
			'    width: 220',
			'    height: 112',
			'edges:',
			'  - from: "external.md"',
			'    from_anchor: east',
			'    to: "target.md"',
			'    to_anchor: west',
			''
		].join('\n'));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.updateCardGeometry(folder(''), {
			path: 'local.md',
			kind: 'file',
			x: 10,
			y: 20,
			width: 220,
			height: 112
		});

		const canvas = await service.readCanvas(folder(''));
		assert.deepStrictEqual(canvas?.cards.map(card => card.path), ['external.md', 'local.md']);
		assert.deepStrictEqual(canvas?.edges[0], { from: 'external.md', from_anchor: 'east', to: 'target.md', to_anchor: 'west' });
		assert.strictEqual(fileService.createCount, 1);
		assert.strictEqual(fileService.writeCount, 1);
	});

	test('reconnect replays endpoint intent while preserving a latest unrelated geometry edit', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const initial = [
			'path: ""',
			'cards:',
			'  - path: "unrelated.md"',
			'    kind: file',
			'    x: 1',
			'    y: 2',
			'    width: 220',
			'    height: 112',
			'edges:',
			'  - from: "a.md"',
			'    from_anchor: east',
			'    to: "b.md"',
			'    to_anchor: west',
			''
		].join('\n');
		const fileService = new TestFileService(new Map([[canvasPath, initial]]));
		fileService.editExternallyOnNextWrite(canvasPath, raw => raw.replace('    x: 1', '    x: 9'));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.reconnectCanvasEdge(folder(''), { from: 'a.md', to: 'b.md' }, {
			from: 'a.md',
			from_anchor: 'south',
			to: 'c.md',
			to_anchor: 'north'
		});

		const updated = await service.readCanvas(folder(''));
		assert.strictEqual(updated?.cards[0].x, 9);
		assert.deepStrictEqual(updated?.edges, [{
			from: 'a.md',
			from_anchor: 'south',
			to: 'c.md',
			to_anchor: 'north'
		}]);
	});

	test('upserts an edge with complete endpoints and anchors', async () => {
		const service = createService(new Map());

		await service.upsertCanvasEdge(folder(''), {
			from: 'a.md',
			from_anchor: 'south',
			to: 'b.md',
			to_anchor: 'north'
		});

		assert.deepStrictEqual((await service.readCanvas(folder('')))?.edges, [{
			from: 'a.md',
			from_anchor: 'south',
			to: 'b.md',
			to_anchor: 'north'
		}]);
	});

	test('transitions reconnect endpoints together and rejects a destination collision', async () => {
		const previous = { from: 'a.md', from_anchor: 'east' as const, to: 'b.md', to_anchor: 'west' as const };
		const collision = { from: 'a.md', from_anchor: 'south' as const, to: 'c.md', to_anchor: 'north' as const };
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', serializeCanvasFile({ path: '', cards: [], edges: [previous, collision] })]
		]));

		await assert.rejects(() => service.transitionCanvasState(folder(''), {
			edges: [
				{ from: previous.from, to: previous.to, expected: previous, next: null },
				{ from: collision.from, to: collision.to, expected: null, next: { ...collision, from_anchor: 'east' } }
			]
		}), error => error instanceof BaseHalfCanvasStateConflict);

		assert.deepStrictEqual((await service.readCanvas(folder('')))?.edges, [previous, collision]);
	});

	test('removing the last edge retains canonical empty canvas.yaml', async () => {
		const files = new Map([
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'cards: []',
				'edges:',
				'  - from: "a.md"',
				'    from_anchor: east',
				'    to: "b.md"',
				'    to_anchor: west',
				''
			].join('\n')]
		]);
		const service = createService(files);

		await service.removeCanvasEdge(folder(''), { from: 'a.md', to: 'b.md' });

		assert.strictEqual(files.get('/work/.bh/mirror/canvas.yaml'), 'path: ""\ncards: []\nedges: []\n');
		assert.strictEqual(await service.readCanvas(folder('')), null);
	});

	test('does not delete an external write that lands after an empty commit', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const fileService = new TestFileService(new Map([[canvasPath, [
			'path: ""',
			'cards: []',
			'edges:',
			'  - from: "a.md"',
			'    from_anchor: east',
			'    to: "b.md"',
			'    to_anchor: west',
			''
		].join('\n')]]));
		const external = [
			'path: ""',
			'cards:',
			'  - path: "external.md"',
			'    kind: file',
			'    x: 10',
			'    y: 20',
			'    width: 220',
			'    height: 112',
			'edges: []',
			''
		].join('\n');
		fileService.writeExternallyAfterNextWrite(canvasPath, external);
		const service = mirrorService(fileService as unknown as IFileService);

		await service.removeCanvasEdge(folder(''), { from: 'a.md', to: 'b.md' });

		assert.strictEqual(fileService.files.get(canvasPath), external);
		assert.strictEqual(fileService.deleteCount, 0);
		assert.strictEqual((await service.readCanvas(folder('')))?.cards[0].path, 'external.md');
	});

	test('relocateNode renames the parent card and edge endpoints in place on a same-parent rename', async () => {
		const files = new Map([
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'cards:',
				'  - path: "old.md"',
				'    kind: file',
				'    x: 10',
				'    y: 20',
				'    width: 260',
				'    height: 140',
				'edges:',
				'  - from: "old.md"',
				'    from_anchor: east',
				'    to: "b.md"',
				'    to_anchor: west',
				''
			].join('\n')]
		]);
		const service = createService(files);

		await service.relocateNode(workspaceFolder, 'old.md', 'new.md');

		const canvas = await service.readCanvas(folder(''));
		assert.deepStrictEqual(canvas?.cards[0], { path: 'new.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 });
		assert.deepStrictEqual(canvas?.edges[0], { from: 'new.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' });
	});

	test('same-parent overwrite retires destination styling, deduplicates the target, and preserves incoming geometry', async () => {
		const files = new Map([
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'cards:',
				'  - path: "old.md"',
				'    kind: file',
				'    x: 10',
				'    y: 20',
				'    width: 260',
				'    height: 140',
				'  - path: "new.md"',
				'    kind: file',
				'    x: 900',
				'    y: 901',
				'    width: 300',
				'    height: 180',
				'edges:',
				'  - from: "old.md"',
				'    from_anchor: south',
				'    to: "keep.md"',
				'    to_anchor: north',
				'  - from: "new.md"',
				'    from_anchor: east',
				'    to: "keep.md"',
				'    to_anchor: west',
				'  - from: "keep.md"',
				'    from_anchor: east',
				'    to: "new.md"',
				'    to_anchor: west',
				''
			].join('\n')]
		]);
		const service = createService(files);

		await service.relocateNode(workspaceFolder, 'old.md', 'new.md', { retireDestination: true });

		const canvas = await service.readCanvas(folder(''));
		assert.deepStrictEqual(canvas?.cards, [{ path: 'new.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 }]);
		assert.deepStrictEqual(canvas?.edges, [{
			from: 'new.md',
			from_anchor: 'south',
			to: 'keep.md',
			to_anchor: 'north'
		}]);
	});

	test('ordinary move retires canvas-only orphan destination state even when the disk target was absent', async () => {
		const targetOnlyPath = '/work/.bh/mirror/notes/legacy/canvas.yaml';
		const files = new Map([
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'cards:',
				'  - path: "docs"',
				'    kind: folder',
				'    x: 10',
				'    y: 20',
				'    width: 260',
				'    height: 140',
				'  - path: "notes"',
				'    kind: folder',
				'    x: 900',
				'    y: 901',
				'    width: 300',
				'    height: 180',
				'edges:',
				'  - from: "docs"',
				'    from_anchor: south',
				'    to: "keep.md"',
				'    to_anchor: north',
				'  - from: "notes"',
				'    from_anchor: east',
				'    to: "keep.md"',
				'    to_anchor: west',
				''
			].join('\n')],
			['/work/.bh/mirror/docs/canvas.yaml', 'path: "docs"\ncards:\n  - path: "docs/legacy"\n    kind: folder\n    x: 1\n    y: 2\n    width: 260\n    height: 140\nedges: []\n'],
			[targetOnlyPath, 'path: "notes/legacy"\ncards:\n  - path: "notes/legacy/stale.md"\n    kind: file\n    x: 99\n    y: 100\n    width: 260\n    height: 140\nedges: []\n']
		]);
		const service = createService(files);

		// No physical target kind/options are supplied: canvas-only metadata is
		// sufficient to establish a destination identity that must be retired.
		await service.relocateNode(workspaceFolder, 'docs', 'notes');

		const parent = await service.readCanvas(folder(''));
		assert.deepStrictEqual(parent?.cards, [{ path: 'notes', kind: 'folder', x: 10, y: 20, width: 260, height: 140 }]);
		assert.deepStrictEqual(parent?.edges, [{
			from: 'notes',
			from_anchor: 'south',
			to: 'keep.md',
			to_anchor: 'north'
		}]);
		assert.strictEqual((await service.readCanvas(folder('notes')))?.cards[0].path, 'notes/legacy');
		assert.strictEqual(await service.readCanvas(folder('notes/legacy')), null);
		assert.strictEqual(files.get(targetOnlyPath), 'path: "notes/legacy"\ncards: []\nedges: []\n');
	});

	test('relocateNode carries card geometry into the new parent on a cross-folder move and drops in-parent edges', async () => {
		const files = new Map([
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'cards:',
				'  - path: "a.md"',
				'    kind: file',
				'    x: 10',
				'    y: 20',
				'    width: 260',
				'    height: 140',
				'edges:',
				'  - from: "a.md"',
				'    from_anchor: east',
				'    to: "b.md"',
				'    to_anchor: west',
				''
			].join('\n')]
		]);
		const service = createService(files);

		await service.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');

		assert.strictEqual(files.get('/work/.bh/mirror/canvas.yaml'), 'path: ""\ncards: []\nedges: []\n');
		const target = await service.readCanvas(folder('docs'));
		assert.deepStrictEqual(target?.cards[0], { path: 'docs/a.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 });
	});

	test('relocateNode re-roots a folder subtree, swapping paths inside each canvas', async () => {
		const files = new Map([
			['/work/.bh/mirror/docs/canvas.yaml', [
				'path: "docs"',
				'cards:',
				'  - path: "docs/a.md"',
				'    kind: file',
				'    x: 1',
				'    y: 2',
				'    width: 260',
				'    height: 140',
				'edges:',
				'  - from: "docs/a.md"',
				'    from_anchor: east',
				'    to: "docs/b.md"',
				'    to_anchor: west',
				''
			].join('\n')]
		]);
		const service = createService(files);

		await service.relocateNode(workspaceFolder, 'docs', 'notes');

		assert.strictEqual(files.get('/work/.bh/mirror/docs/canvas.yaml'), 'path: "docs"\ncards: []\nedges: []\n');
		assert.strictEqual(await service.readCanvas(folder('docs')), null);
		const moved = await service.readCanvas(folder('notes'));
		assert.strictEqual(moved?.cards[0].path, 'notes/a.md');
		assert.deepStrictEqual(moved?.edges[0], { from: 'notes/a.md', from_anchor: 'east', to: 'notes/b.md', to_anchor: 'west' });
	});

	test('folder overwrite hard failure restores every earlier subtree and destination canvas snapshot', async () => {
		const rootPath = '/work/.bh/mirror/canvas.yaml';
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const sourceChildPath = '/work/.bh/mirror/docs/chapter/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const targetChildPath = '/work/.bh/mirror/notes/chapter/canvas.yaml';
		const targetOnlyPath = '/work/.bh/mirror/notes/retired-only/canvas.yaml';
		const initial = new Map([
			[rootPath, 'path: ""\ncards:\n  - path: "docs"\n    kind: folder\n    x: 1\n    y: 2\n    width: 260\n    height: 140\n  - path: "notes"\n    kind: folder\n    x: 9\n    y: 10\n    width: 300\n    height: 180\nedges: []\n'],
			[sourcePath, 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n'],
			[sourceChildPath, 'path: "docs/chapter"\ncards:\n  - path: "docs/chapter/a.md"\n    kind: file\n    x: 3\n    y: 4\n    width: 260\n    height: 140\nedges: []\n'],
			[targetPath, 'path: "notes"\ncards: []\nedges:\n  - from: "notes/x.md"\n    from_anchor: east\n    to: "notes/y.md"\n    to_anchor: west\n'],
			[targetChildPath, 'path: "notes/chapter"\ncards:\n  - path: "notes/chapter/old.md"\n    kind: file\n    x: 99\n    y: 100\n    width: 260\n    height: 140\nedges: []\n'],
			[targetOnlyPath, 'path: "notes/retired-only"\ncards:\n  - path: "notes/retired-only/old.md"\n    kind: file\n    x: 101\n    y: 102\n    width: 260\n    height: 140\nedges: []\n']
		]);
		const fileService = new TestFileService(new Map(initial));
		fileService.failNextWrite(rootPath, new Error('injected parent hard failure'));
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateNode(workspaceFolder, 'docs', 'notes', { retireDestination: true }),
			/injected parent hard failure/
		);

		for (const [path, contents] of initial) {
			assert.strictEqual(fileService.files.get(path), contents, `${path} must be restored exactly`);
		}
	});

	test('relocateNode compensates and replays a source canvas changed after the target commit', async () => {
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const initial = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const external = initial.replace('from_anchor: east', 'from_anchor: west');
		const fileService = new TestFileService(new Map([[sourcePath, initial]]));
		fileService.writeExternallyAfterNextCreate(targetPath, () => fileService.replaceExternally(sourcePath, external));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.relocateNode(workspaceFolder, 'docs', 'notes');

		assert.strictEqual(fileService.files.get(sourcePath), 'path: "docs"\ncards: []\nedges: []\n');
		assert.strictEqual(await service.readCanvas(folder('docs')), null);
		assert.deepStrictEqual((await service.readCanvas(folder('notes')))?.edges[0], {
			from: 'notes/a.md',
			from_anchor: 'west',
			to: 'notes/b.md',
			to_anchor: 'west'
		});
	});

	test('relocateNode validates a skipped already-desired target snapshot before retiring its source', async () => {
		const rootPath = '/work/.bh/mirror/canvas.yaml';
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const root = 'path: ""\ncards:\n  - path: "docs"\n    kind: folder\n    x: 1\n    y: 2\n    width: 260\n    height: 140\nedges: []\n';
		const source = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const alreadyDesired = source
			.replace('path: "docs"', 'path: "notes"')
			.replaceAll('docs/', 'notes/');
		const external = alreadyDesired.replace('from_anchor: east', 'from_anchor: west');
		const fileService = new TestFileService(new Map([
			[rootPath, root],
			[sourcePath, source],
			[targetPath, alreadyDesired]
		]));
		fileService.writeExternallyAfterNextRead(targetPath, external);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(() => service.relocateNode(workspaceFolder, 'docs', 'notes'));

		assert.strictEqual(fileService.files.get(sourcePath), source);
		assert.strictEqual(fileService.files.get(rootPath), root);
		assert.strictEqual(fileService.files.get(targetPath), external);
	});

	test('relocateNode refuses an already-desired target reached through a mirror ancestor symlink', async () => {
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const source = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const alreadyDesired = source
			.replace('path: "docs"', 'path: "notes"')
			.replaceAll('docs/', 'notes/');
		const fileService = new TestFileService(new Map([
			[sourcePath, source],
			[targetPath, alreadyDesired]
		]));
		fileService.symbolicLinks.add('/work/.bh/mirror/notes');
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateNode(workspaceFolder, 'docs', 'notes'),
			error => error instanceof BaseHalfMirrorSymbolicLinkError
				&& error.symbolicLink.fsPath === '/work/.bh/mirror/notes'
		);

		assert.strictEqual(fileService.files.get(sourcePath), source);
		assert.strictEqual(fileService.files.get(targetPath), alreadyDesired);
		assert.strictEqual(fileService.writeCount, 0);
	});

	test('relocateNode fails closed when target compensation meets an external rewrite', async () => {
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const initial = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const sourceLatest = initial.replace('from_anchor: east', 'from_anchor: west');
		const targetInitial = 'path: "notes"\ncards: []\nedges: []\n';
		const targetLatest = 'path: "notes"\ncards: []\nedges:\n  - from: "notes/x.md"\n    from_anchor: east\n    to: "notes/y.md"\n    to_anchor: west\n';
		const fileService = new TestFileService(new Map([
			[sourcePath, initial],
			[targetPath, targetInitial]
		]));
		fileService.writeExternallyAfterNextWrite(targetPath, targetLatest);
		fileService.editExternallyOnNextWrite(sourcePath, () => sourceLatest);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateNode(workspaceFolder, 'docs', 'notes'),
			error => error instanceof AggregateError && /conditional compensation/.test(error.message)
		);

		assert.strictEqual(fileService.files.get(sourcePath), sourceLatest);
		assert.strictEqual(fileService.files.get(targetPath), targetLatest);
	});

	test('relocateNode restores its source and fails closed when target changes after commit', async () => {
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const source = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const targetLatest = 'path: "notes"\ncards: []\nedges:\n  - from: "notes/x.md"\n    from_anchor: east\n    to: "notes/y.md"\n    to_anchor: west\n';
		const fileService = new TestFileService(new Map([
			[sourcePath, source],
			[targetPath, 'path: "notes"\ncards: []\nedges: []\n']
		]));
		fileService.writeExternallyAfterNextWrite(targetPath, targetLatest);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(() => service.relocateNode(workspaceFolder, 'docs', 'notes'));

		assert.strictEqual(fileService.files.get(sourcePath), source);
		assert.strictEqual(fileService.files.get(targetPath), targetLatest);
	});

	test('subtree post-commit drift preserves external latest and compensates every other completed write', async () => {
		const rootPath = '/work/.bh/mirror/canvas.yaml';
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const sourceChildPath = '/work/.bh/mirror/docs/chapter/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const targetChildPath = '/work/.bh/mirror/notes/chapter/canvas.yaml';
		const initial = new Map([
			[rootPath, 'path: ""\ncards:\n  - path: "docs"\n    kind: folder\n    x: 1\n    y: 2\n    width: 260\n    height: 140\n  - path: "notes"\n    kind: folder\n    x: 9\n    y: 10\n    width: 300\n    height: 180\nedges: []\n'],
			[sourcePath, 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n'],
			[sourceChildPath, 'path: "docs/chapter"\ncards:\n  - path: "docs/chapter/a.md"\n    kind: file\n    x: 3\n    y: 4\n    width: 260\n    height: 140\nedges: []\n'],
			[targetPath, 'path: "notes"\ncards: []\nedges:\n  - from: "notes/x.md"\n    from_anchor: east\n    to: "notes/y.md"\n    to_anchor: west\n'],
			[targetChildPath, 'path: "notes/chapter"\ncards:\n  - path: "notes/chapter/old.md"\n    kind: file\n    x: 99\n    y: 100\n    width: 260\n    height: 140\nedges: []\n']
		]);
		const externalTarget = initial.get(targetPath)!.replace('from_anchor: east', 'from_anchor: west');
		const fileService = new TestFileService(new Map(initial));
		fileService.writeExternallyAfterNextWrite(targetPath, externalTarget);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateNode(workspaceFolder, 'docs', 'notes', { retireDestination: true }),
			error => error instanceof AggregateError && /verification.*compensation/.test(error.message)
		);

		assert.strictEqual(fileService.files.get(targetPath), externalTarget);
		for (const [path, contents] of initial) {
			if (path !== targetPath) {
				assert.strictEqual(fileService.files.get(path), contents, `${path} must be conditionally restored`);
			}
		}
	});

	test('relocateNode restores its target and fails closed when source is recreated after retirement', async () => {
		const sourcePath = '/work/.bh/mirror/docs/canvas.yaml';
		const targetPath = '/work/.bh/mirror/notes/canvas.yaml';
		const source = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const sourceLatest = source.replace('from_anchor: east', 'from_anchor: west');
		const target = 'path: "notes"\ncards: []\nedges: []\n';
		const fileService = new TestFileService(new Map([
			[sourcePath, source],
			[targetPath, target]
		]));
		fileService.writeExternallyAfterNextWrite(sourcePath, sourceLatest);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(() => service.relocateNode(workspaceFolder, 'docs', 'notes'));

		assert.strictEqual(fileService.files.get(sourcePath), sourceLatest);
		assert.strictEqual(fileService.files.get(targetPath), target);
	});

	test('cross-parent card relocation compensates and carries the latest geometry', async () => {
		const sourcePath = '/work/.bh/mirror/canvas.yaml';
		const targetPath = '/work/.bh/mirror/docs/canvas.yaml';
		const initial = 'path: ""\ncards:\n  - path: "a.md"\n    kind: file\n    x: 10\n    y: 20\n    width: 260\n    height: 140\nedges: []\n';
		const external = initial.replace('x: 10', 'x: 99');
		const fileService = new TestFileService(new Map([[sourcePath, initial]]));
		fileService.writeExternallyAfterNextCreate(targetPath, () => fileService.replaceExternally(sourcePath, external));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');

		assert.strictEqual(await service.readCanvas(folder('')), null);
		assert.strictEqual((await service.readCanvas(folder('docs')))?.cards[0].x, 99);
	});

	test('same-resource identity relocation rewrites a folder canvas in place', async () => {
		// The structural cascade has already renamed the physical mirror entity
		// directory; its YAML still carries the old logical identity.
		const ownPath = '/work/.bh/mirror/Docs/canvas.yaml';
		const rootPath = '/work/.bh/mirror/canvas.yaml';
		const files = new Map([
			[ownPath, 'path: "docs"\ncards:\n  - path: "docs/a.md"\n    kind: file\n    x: 1\n    y: 2\n    width: 260\n    height: 140\nedges: []\n'],
			[rootPath, 'path: ""\ncards:\n  - path: "docs"\n    kind: folder\n    x: 3\n    y: 4\n    width: 260\n    height: 140\nedges: []\n']
		]);
		const service = createService(files);

		await service.relocateNodeIdentity(workspaceFolder, 'docs', 'Docs');

		assert.match(files.get(ownPath) ?? '', /^path: "Docs"/);
		assert.match(files.get(ownPath) ?? '', /path: "Docs\/a\.md"/);
		assert.strictEqual((await service.readCanvas(folder('')))?.cards[0].path, 'Docs');
	});

	test('same-resource identity relocation rewrites a logical-empty tombstone path', async () => {
		const ownPath = '/work/.bh/mirror/Docs/canvas.yaml';
		const files = new Map([[ownPath, 'path: "docs"\ncards: []\nedges: []\n']]);
		const service = createService(files);

		await service.relocateNodeIdentity(workspaceFolder, 'docs', 'Docs');

		assert.strictEqual(files.get(ownPath), 'path: "Docs"\ncards: []\nedges: []\n');
	});

	test('same-resource identity hard failure restores every earlier rewritten subtree canvas', async () => {
		const ownPath = '/work/.bh/mirror/Docs/canvas.yaml';
		const childPath = '/work/.bh/mirror/Docs/chapter/canvas.yaml';
		const rootPath = '/work/.bh/mirror/canvas.yaml';
		const initial = new Map([
			[ownPath, 'path: "docs"\ncards:\n  - path: "docs/a.md"\n    kind: file\n    x: 1\n    y: 2\n    width: 260\n    height: 140\nedges: []\n'],
			[childPath, 'path: "docs/chapter"\ncards:\n  - path: "docs/chapter/b.md"\n    kind: file\n    x: 3\n    y: 4\n    width: 260\n    height: 140\nedges: []\n'],
			[rootPath, 'path: ""\ncards:\n  - path: "docs"\n    kind: folder\n    x: 5\n    y: 6\n    width: 260\n    height: 140\nedges: []\n']
		]);
		const fileService = new TestFileService(new Map(initial));
		fileService.failNextWrite(rootPath, new Error('injected case-only parent failure'));
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateNodeIdentity(workspaceFolder, 'docs', 'Docs'),
			/injected case-only parent failure/
		);

		for (const [path, contents] of initial) {
			assert.strictEqual(fileService.files.get(path), contents, `${path} must be restored exactly`);
		}
	});

	test('same-resource identity relocation replays an equal-length external rewrite', async () => {
		const ownPath = '/work/.bh/mirror/Docs/canvas.yaml';
		const initial = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const external = initial.replace('from_anchor: east', 'from_anchor: west');
		const fileService = new TestFileService(new Map([[ownPath, initial]]));
		fileService.editExternallyOnNextWrite(ownPath, () => external);
		const service = mirrorService(fileService as unknown as IFileService);

		await service.relocateNodeIdentity(workspaceFolder, 'docs', 'Docs');

		assert.match(fileService.files.get(ownPath) ?? '', /^path: "Docs"/);
		assert.match(fileService.files.get(ownPath) ?? '', /from_anchor: west/);
	});

	test('purgeNode drops the subtree canvases plus the parent card and touching edges', async () => {
		const files = new Map([
			['/work/.bh/mirror/docs/canvas.yaml', 'path: "docs"\ncards:\n  - path: "docs/a.md"\n    kind: file\n    x: 1\n    y: 2\n    width: 260\n    height: 140\nedges: []\n'],
			['/work/.bh/mirror/canvas.yaml', [
				'path: ""',
				'cards:',
				'  - path: "docs"',
				'    kind: folder',
				'    x: 5',
				'    y: 6',
				'    width: 260',
				'    height: 140',
				'  - path: "keep.md"',
				'    kind: file',
				'    x: 7',
				'    y: 8',
				'    width: 260',
				'    height: 140',
				'edges:',
				'  - from: "keep.md"',
				'    from_anchor: east',
				'    to: "docs"',
				'    to_anchor: west',
				''
			].join('\n')]
		]);
		const service = createService(files);

		await service.purgeNode(workspaceFolder, 'docs');

		assert.strictEqual(files.get('/work/.bh/mirror/docs/canvas.yaml'), 'path: "docs"\ncards: []\nedges: []\n');
		assert.strictEqual(await service.readCanvas(folder('docs')), null);
		const root = await service.readCanvas(folder(''));
		assert.deepStrictEqual(root?.cards.map(card => card.path), ['keep.md']);
		assert.deepStrictEqual(root?.edges, []);
	});

	test('purgeNode preserves a subtree canvas changed after its snapshot', async () => {
		const canvasPath = '/work/.bh/mirror/docs/canvas.yaml';
		const initial = 'path: "docs"\ncards: []\nedges:\n  - from: "docs/a.md"\n    from_anchor: east\n    to: "docs/b.md"\n    to_anchor: west\n';
		const external = initial.replace('from_anchor: east', 'from_anchor: west');
		const fileService = new TestFileService(new Map([[canvasPath, initial]]));
		fileService.writeExternallyAfterNextRead(canvasPath, external);
		const service = mirrorService(fileService as unknown as IFileService);

		await service.purgeNode(workspaceFolder, 'docs');

		assert.strictEqual(fileService.files.get(canvasPath), external);
		assert.strictEqual((await service.readCanvas(folder('docs')))?.edges[0].from_anchor, 'west');
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
		return mirrorService(new TestFileService(files) as unknown as IFileService);
	}

	function mirrorService(fileService: IFileService): BaseHalfCanvasMirrorService {
		return new BaseHalfCanvasMirrorService(fileService, new BaseHalfWorkspaceMutationCoordinator());
	}
});

class TestFileService {
	readonly files: Map<string, string>;
	readonly createdFolders: URI[] = [];
	private readonly revisions = new Map<string, number>();
	private readonly externalEdits = new Map<string, (raw: string) => string>();
	private readonly externalCreates = new Map<string, string>();
	private readonly externalWritesAfterCommit = new Map<string, string>();
	private readonly externalWritesAfterCreate = new Map<string, () => void>();
	private readonly externalWritesAfterRead = new Map<string, string>();
	private readonly hardWriteFailures = new Map<string, Error>();
	readonly symbolicLinks = new Set<string>();
	createCount = 0;
	writeCount = 0;
	deleteCount = 0;
	lastWriteWasAtomic = false;

	constructor(files: Map<string, string>) {
		this.files = files;
		for (const path of files.keys()) {
			this.revisions.set(path, 1);
		}
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer; mtime: number; etag: string }> {
		const raw = this.files.get(resource.fsPath);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		const revision = this.revisions.get(resource.fsPath) ?? 0;
		const external = this.externalWritesAfterRead.get(resource.fsPath);
		if (external !== undefined) {
			this.externalWritesAfterRead.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, external);
		}
		return { value: VSBuffer.fromString(raw), mtime: revision, etag: `v${revision}` };
	}

	async createFolder(resource: URI): Promise<IFileStat> {
		this.createdFolders.push(resource);
		return stat(resource, FileType.Directory);
	}

	async createFile(resource: URI, buffer: VSBuffer, options?: { overwrite?: boolean }): Promise<IFileStat> {
		this.createCount++;
		const external = this.externalCreates.get(resource.fsPath);
		if (external !== undefined) {
			this.externalCreates.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, external);
		}
		if (this.files.has(resource.fsPath) && !options?.overwrite) {
			throw new FileOperationError('already exists', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, (this.revisions.get(resource.fsPath) ?? 0) + 1);
		const afterCreate = this.externalWritesAfterCreate.get(resource.fsPath);
		if (afterCreate) {
			this.externalWritesAfterCreate.delete(resource.fsPath);
			afterCreate();
		}
		return stat(resource, FileType.File);
	}

	async writeFileWithExpectedContents(resource: URI, buffer: VSBuffer, expectedContents: VSBuffer | null, options: { atomic: unknown }): Promise<IFileStat> {
		const hardFailure = this.hardWriteFailures.get(resource.fsPath);
		if (hardFailure) {
			this.hardWriteFailures.delete(resource.fsPath);
			throw hardFailure;
		}
		if (expectedContents === null) {
			return this.createFile(resource, buffer, { overwrite: false });
		}

		this.writeCount++;
		const externalEdit = this.externalEdits.get(resource.fsPath);
		if (externalEdit) {
			this.externalEdits.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, externalEdit(this.files.get(resource.fsPath) ?? ''));
		}
		const revision = this.revisions.get(resource.fsPath);
		if (revision === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		if (this.files.get(resource.fsPath) !== expectedContents.toString()) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}

		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, revision + 1);
		this.lastWriteWasAtomic = options.atomic !== undefined && options.atomic !== false;
		const externalAfterCommit = this.externalWritesAfterCommit.get(resource.fsPath);
		if (externalAfterCommit !== undefined) {
			this.externalWritesAfterCommit.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, externalAfterCommit);
		}
		return stat(resource, FileType.File);
	}

	async writeFile(resource: URI, buffer: VSBuffer, options?: { mtime?: number; etag?: string; atomic?: unknown }): Promise<IFileStat> {
		this.writeCount++;
		const externalEdit = this.externalEdits.get(resource.fsPath);
		if (externalEdit) {
			this.externalEdits.delete(resource.fsPath);
			this.files.set(resource.fsPath, externalEdit(this.files.get(resource.fsPath) ?? ''));
			this.revisions.set(resource.fsPath, (this.revisions.get(resource.fsPath) ?? 0) + 1);
		}
		const revision = this.revisions.get(resource.fsPath);
		if (revision === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		if (options?.mtime !== undefined && (options.mtime !== revision || options.etag !== `v${revision}`)) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, revision + 1);
		this.lastWriteWasAtomic = options?.atomic !== undefined && options.atomic !== false;
		const externalAfterCommit = this.externalWritesAfterCommit.get(resource.fsPath);
		if (externalAfterCommit !== undefined) {
			this.externalWritesAfterCommit.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, externalAfterCommit);
		}
		return stat(resource, FileType.File);
	}

	editExternallyOnNextWrite(path: string, edit: (raw: string) => string): void {
		this.externalEdits.set(path, edit);
	}

	createExternallyOnNextCreate(path: string, contents: string): void {
		this.externalCreates.set(path, contents);
	}

	writeExternallyAfterNextWrite(path: string, contents: string): void {
		this.externalWritesAfterCommit.set(path, contents);
	}

	writeExternallyAfterNextCreate(path: string, write: () => void): void {
		this.externalWritesAfterCreate.set(path, write);
	}

	writeExternallyAfterNextRead(path: string, contents: string): void {
		this.externalWritesAfterRead.set(path, contents);
	}

	failNextWrite(path: string, error: Error): void {
		this.hardWriteFailures.set(path, error);
	}

	replaceExternally(path: string, contents: string): void {
		this.files.set(path, contents);
		this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
	}

	async del(resource: URI): Promise<void> {
		this.deleteCount++;
		if (!this.files.delete(resource.fsPath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		this.revisions.delete(resource.fsPath);
	}

	async stat(resource: URI): Promise<IFileStat> {
		const exactFile = this.files.has(resource.fsPath);
		const isDirectory = [...this.files.keys(), ...this.symbolicLinks].some(path => path.startsWith(`${resource.fsPath}/`));
		if (!exactFile && !isDirectory && !this.symbolicLinks.has(resource.fsPath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		return {
			...stat(resource, exactFile ? FileType.File : FileType.Directory),
			isSymbolicLink: this.symbolicLinks.has(resource.fsPath)
		};
	}

	async resolve(resource: URI): Promise<{ isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean; children: Array<{ resource: URI; name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }> }> {
		const prefix = `${resource.fsPath}/`;
		const names = new Map<string, boolean>();
		const exactFile = this.files.has(resource.fsPath);
		let found = exactFile || this.symbolicLinks.has(resource.fsPath);
		for (const path of this.files.keys()) {
			if (!path.startsWith(prefix)) {
				continue;
			}

			found = true;
			const rest = path.slice(prefix.length);
			const slash = rest.indexOf('/');
			const name = slash === -1 ? rest : rest.slice(0, slash);
			names.set(name, slash !== -1 || (names.get(name) ?? false));
		}

		if (!found) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		return {
			isFile: exactFile,
			isDirectory: !exactFile,
			isSymbolicLink: this.symbolicLinks.has(resource.fsPath),
			children: [...names.entries()].map(([name, isDirectory]) => ({
				resource: URI.file(`${prefix}${name}`),
				name,
				isFile: !isDirectory,
				isDirectory,
				isSymbolicLink: this.symbolicLinks.has(`${prefix}${name}`)
			}))
		};
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

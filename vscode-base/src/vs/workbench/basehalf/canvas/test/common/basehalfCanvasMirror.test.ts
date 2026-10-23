/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import {
	FileOperationError,
	FileOperationResult,
	FileType,
	IFileService,
	IFileStat
} from '../../../../../platform/files/common/files.js';
import { BaseHalfCanvasMirrorService, BaseHalfCanvasStateConflict, IBaseHalfCanvasPreservedEvent, serializeCanvasFile, upsertCanvasCard } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasEdge } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_MIRROR_IGNORE_CONTENT } from '../../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfMirrorRecoveryResource } from '../../../workspace/common/basehalfMirrorRecovery.js';
import { BaseHalfMirrorSymbolicLinkError } from '../../../workspace/common/basehalfMirrorTree.js';
import { BaseHalfMirrorWriteRejected } from '../../../workspace/common/basehalfMirrorYaml.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';

const IGNORE_FILE_PATH = '/work/.bh/.gitignore';

/** Names that an earlier reader mistook for numbers, booleans, or null, and names that need escaping. */
const TRICKY_NAMES = ['09', '2024', '-3', '1.5', '1e21', 'true', 'false', 'null', '~', '', ' lead', 'trail ', '"q"', 'it\'s', 'back\\slash', 'a: b', 'a #b', 'line\nbreak', 'bell\u0007', 'ls\u2028x', '中文 笔记.md'];

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

	test('reads invalid YAML as no layout and reports it unreadable', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', 'path: [unterminated']
		]));

		const read = await service.inspectCanvas(folder(''));

		assert.deepStrictEqual({ canvas: read.canvas, damage: read.damage?.kind }, { canvas: null, damage: 'unreadable' });
	});

	test('reads a canvas stored for another folder as no layout', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/canvas.yaml', 'path: other\ncards: []\nedges: []\n']
		]));

		assert.deepStrictEqual(await service.inspectCanvas(folder('docs')), {
			canvas: null,
			damage: { kind: 'unreadable', reason: 'path must be "docs"' }
		});
	});

	test('reads back every card path and edge endpoint it writes', async () => {
		const service = createService(new Map());
		const cards: IBaseHalfCanvasCard[] = TRICKY_NAMES.map((path, index) => ({ path, kind: 'folder', x: index, y: -1.5 - index, width: 248, height: 188 }));
		const edges: IBaseHalfCanvasEdge[] = cards.slice(1).map((card, index) => ({ from: cards[index].path, from_anchor: 'east', to: card.path, to_anchor: 'west' }));

		await service.updateCardGeometries(folder(''), cards);
		for (const edge of edges) {
			await service.upsertCanvasEdge(folder(''), edge);
		}

		assert.deepStrictEqual(await service.inspectCanvas(folder('')), { canvas: { path: '', cards, edges } });
	});

	test('reads back every folder path it writes', async () => {
		const service = createService(new Map());
		const names = TRICKY_NAMES.filter(name => name !== '');
		const reads = [];
		for (const name of names) {
			await service.updateCardGeometry(folder(name), { path: `${name}/a.md`, kind: 'file', x: 1, y: 2, width: 300, height: 220 });
			reads.push(await service.inspectCanvas(folder(name)));
		}

		assert.deepStrictEqual(reads, names.map(name => ({
			canvas: { path: name, cards: [{ path: `${name}/a.md`, kind: 'file', x: 1, y: 2, width: 300, height: 220 }], edges: [] }
		})));
	});

	test('reads a hand-written plain numeric path as text', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', 'path: ""\ncards:\n  - path: 09\n    kind: folder\n    x: 1\n    y: 2\n    width: 3\n    height: 4\nedges: []\n']
		]));

		assert.deepStrictEqual(await service.inspectCanvas(folder('')), {
			canvas: { path: '', cards: [{ path: '09', kind: 'folder', x: 1, y: 2, width: 3, height: 4 }], edges: [] }
		});
	});

	test('reads a layout whose folder was renamed in case only outside BaseHalf, and stores the new spelling on the next write', async () => {
		// The file system finds the file under the new spelling; it still stores the old one.
		const canvasPath = '/work/.bh/mirror/docs/canvas.yaml';
		const row = (path: string, x: number) => [`  - path: "${path}"`, '    kind: file', `    x: ${x}`, '    y: 2', '    width: 300', '    height: 220'];
		const stored = ['path: "Docs"', 'cards:', ...row('Docs/a.md', 1), ...row('Docs/b.md', 5), 'edges:', '  - from: "Docs/a.md"', '    to: "Docs/b.md"', '    from_anchor: east', '    to_anchor: west', ''].join('\n');
		const fileService = new TestFileService(new Map([[canvasPath, stored]]));
		const service = mirrorService(fileService as unknown as IFileService);
		const a: IBaseHalfCanvasCard = { path: 'docs/a.md', kind: 'file', x: 1, y: 2, width: 300, height: 220 };
		const b: IBaseHalfCanvasCard = { path: 'docs/b.md', kind: 'file', x: 5, y: 2, width: 300, height: 220 };

		const read = await service.inspectCanvas(folder('docs'));
		await service.updateCardGeometry(folder('docs'), { ...a, x: 40 });

		assert.deepStrictEqual({
			read,
			written: fileService.files.get(canvasPath)?.split('\n').filter(line => /path:|from:|to:/.test(line)),
			// Nothing was unreadable, so nothing had to be kept aside.
			recovered: [...fileService.files.keys()].filter(path => path.includes('/recovered/')),
			// Another name is still another node's file.
			other: (await mirrorService(new TestFileService(new Map([[canvasPath, stored.replace('path: "Docs"', 'path: "notes"')]])) as unknown as IFileService).inspectCanvas(folder('docs'))).damage?.kind
		}, {
			read: { canvas: { path: 'docs', cards: [a, b], edges: [{ from: 'docs/a.md', to: 'docs/b.md', from_anchor: 'east', to_anchor: 'west' }] } },
			written: ['path: "docs"', '  - path: "docs/a.md"', '  - path: "docs/b.md"', '  - from: "docs/a.md"', '    to: "docs/b.md"'],
			recovered: [],
			other: 'unreadable'
		});
	});

	test('a size too small to be written is a row it cannot read, and never blocks a later write', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const row = (path: string, width: string) => [`  - path: "${path}"`, '    kind: file', '    x: 1', '    y: 2', `    width: ${width}`, '    height: 220'];
		const fileService = new TestFileService(new Map([[canvasPath, ['path: ""', 'cards:', ...row('tiny.md', '0.00001'), ...row('ok.md', '300'), 'edges: []', ''].join('\n')]]));
		const service = mirrorService(fileService as unknown as IFileService);
		const ok: IBaseHalfCanvasCard = { path: 'ok.md', kind: 'file', x: 1, y: 2, width: 300, height: 220 };

		const read = await service.inspectCanvas(folder(''));
		await service.updateCardGeometry(folder(''), { ...ok, x: 90 });

		assert.deepStrictEqual([read.canvas?.cards, read.damage?.kind, (await service.inspectCanvas(folder(''))).canvas?.cards], [[ok], 'partial', [{ ...ok, x: 90 }]]);
	});

	test('a folder named 09 leaves its canvas readable, movable, and purgeable', async () => {
		const service = createService(new Map());
		const note: IBaseHalfCanvasCard = { path: 'note.md', kind: 'file', x: 0, y: 0, width: 300, height: 220 };
		const numbered: IBaseHalfCanvasCard = { path: '09', kind: 'folder', x: 10, y: 10, width: 248, height: 188 };
		const moved: IBaseHalfCanvasCard = { ...note, x: 500, y: 40 };

		await service.updateCardGeometry(folder(''), note);
		await service.updateCardGeometry(folder(''), numbered);
		await service.updateCardGeometry(folder(''), moved);
		const beforeDelete = await service.inspectCanvas(folder(''));
		await service.purgeNode(workspaceFolder, '09');

		assert.deepStrictEqual([beforeDelete, await service.inspectCanvas(folder(''))], [
			{ canvas: { path: '', cards: [moved, numbered], edges: [] } },
			{ canvas: { path: '', cards: [moved], edges: [] } }
		]);
	});

	test('skips rows it cannot read and keeps the stored bytes before writing over them', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const good: IBaseHalfCanvasCard = { path: 'good.md', kind: 'file', x: 5, y: 6, width: 300, height: 220 };
		const moved: IBaseHalfCanvasCard = { path: 'moved.md', kind: 'file', x: 7, y: 8, width: 300, height: 220 };
		const damaged = [
			'path: ""',
			'cards:',
			'  - path: "bad.md"',
			'    kind: group',
			'    x: 1',
			'    y: 2',
			'    width: 300',
			'    height: 220',
			'  - path: "good.md"',
			'    kind: file',
			'    x: 5',
			'    y: 6',
			'    width: 300',
			'    height: 220',
			'edges: []',
			''
		].join('\n');
		const fileService = new TestFileService(new Map([[canvasPath, damaged]]));
		const service = mirrorService(fileService as unknown as IFileService);
		const preserved: IBaseHalfCanvasPreservedEvent[] = [];
		const listener = service.onDidPreserveUnreadableCanvas(event => preserved.push(event));
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(canvasPath), VSBuffer.fromString(damaged));

		const before = await service.inspectCanvas(folder(''));
		await service.updateCardGeometry(folder(''), moved);
		listener.dispose();

		assert.deepStrictEqual({
			before,
			after: await service.inspectCanvas(folder('')),
			recoveryCopy: fileService.files.get(recoveryCopy.fsPath),
			preserved: preserved.map(event => ({ relativePath: event.relativePath, damage: event.damage.kind, recoveryCopy: event.recoveryCopy.fsPath }))
		}, {
			before: { canvas: { path: '', cards: [good], edges: [] }, damage: { kind: 'partial', reason: 'cards[0].kind must be file or folder' } },
			after: { canvas: { path: '', cards: [good, moved], edges: [] } },
			recoveryCopy: damaged,
			preserved: [{ relativePath: '', damage: 'partial', recoveryCopy: recoveryCopy.fsPath }]
		});
	});

	test('keeps both sides of a merge conflict as a recovery copy instead of reading the file as an empty canvas', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const row = (path: string, x: number) => `  - path: "${path}"\n    kind: file\n    x: ${x}\n    y: 2\n    width: 300\n    height: 220\n`;
		const conflicted = `path: ""\ncards:\n${row('kept.md', 1)}<<<<<<< HEAD\n${row('a.md', 3)}=======\n${row('a.md', 9)}>>>>>>> feature\n${row('after.md', 5)}edges: []\n`;
		const fileService = new TestFileService(new Map([[canvasPath, conflicted]]));
		const service = mirrorService(fileService as unknown as IFileService);
		const kept: IBaseHalfCanvasCard = { path: 'kept.md', kind: 'file', x: 1, y: 2, width: 300, height: 220 };
		const moved: IBaseHalfCanvasCard = { path: 'a.md', kind: 'file', x: 40, y: 50, width: 300, height: 220 };
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(canvasPath), VSBuffer.fromString(conflicted));

		const before = await service.inspectCanvas(folder(''));
		await service.updateCardGeometry(folder(''), moved);

		assert.deepStrictEqual({
			before,
			after: await service.inspectCanvas(folder('')),
			recoveryCopy: fileService.files.get(recoveryCopy.fsPath)
		}, {
			before: { canvas: { path: '', cards: [kept], edges: [] }, damage: { kind: 'partial', reason: 'line 9 and what follows could not be read' } },
			after: { canvas: { path: '', cards: [kept, moved], edges: [] } },
			recoveryCopy: conflicted
		});
	});

	test('reads a canvas saved with a byte order mark', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', '\ufeffpath: ""\ncards:\n  - path: "a.md"\n    kind: file\n    x: 1\n    y: 2\n    width: 3\n    height: 4\nedges: []\n']
		]));

		assert.deepStrictEqual(await service.inspectCanvas(folder('')), {
			canvas: { path: '', cards: [{ path: 'a.md', kind: 'file', x: 1, y: 2, width: 3, height: 4 }], edges: [] }
		});
	});

	test('writes card geometry over an unreadable canvas after keeping its bytes, and leaves it alone on a no-op', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const unreadable = 'path: [unterminated';
		const fileService = new TestFileService(new Map([[canvasPath, unreadable]]));
		const service = mirrorService(fileService as unknown as IFileService);
		const card: IBaseHalfCanvasCard = { path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 };
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(canvasPath), VSBuffer.fromString(unreadable));

		await service.removeCanvasEdge(folder(''), { from: 'a.md', to: 'b.md' });
		const afterNoOp = { canvas: fileService.files.get(canvasPath), recoveryCopy: fileService.files.get(recoveryCopy.fsPath) };
		await service.updateCardGeometry(folder(''), card);

		assert.deepStrictEqual({
			afterNoOp,
			after: await service.inspectCanvas(folder('')),
			recoveryCopy: fileService.files.get(recoveryCopy.fsPath)
		}, {
			afterNoOp: { canvas: unreadable, recoveryCopy: undefined },
			after: { canvas: { path: '', cards: [card], edges: [] } },
			recoveryCopy: unreadable
		});
	});

	test('leaves an unreadable canvas unchanged when its recovery copy cannot be saved', async () => {
		const canvasPath = '/work/.bh/mirror/canvas.yaml';
		const unreadable = 'path: [unterminated';
		const fileService = new TestFileService(new Map([[canvasPath, unreadable]]));
		const service = mirrorService(fileService as unknown as IFileService);
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(canvasPath), VSBuffer.fromString(unreadable));
		fileService.failNextWrite(recoveryCopy.fsPath, new Error('disk full'));

		await assert.rejects(
			() => service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 10, y: 20, width: 220, height: 112 }),
			/disk full/
		);
		assert.strictEqual(fileService.files.get(canvasPath), unreadable);
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

	test('never commits a canvas the reader would not accept in full', async () => {
		const fileService = new TestFileService(new Map());
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.upsertCanvasEdge(folder(''), { from: 'a.md', from_anchor: 'up' as IBaseHalfCanvasEdge['from_anchor'], to: 'b.md', to_anchor: 'west' }),
			error => error instanceof BaseHalfMirrorWriteRejected
		);
		await assert.rejects(
			() => service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 10, y: 20, width: 0.00001, height: 112 }),
			error => error instanceof RangeError && error.message.includes('card \'a.md\' width must be positive')
		);
		assert.deepStrictEqual([...fileService.files.keys()], []);
	});

	test('rejects invalid geometry before it can corrupt canvas.yaml', async () => {
		const fileService = new TestFileService(new Map());
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.updateCardGeometry(folder(''), { path: 'a.md', kind: 'file', x: 10, y: 20, width: -8, height: 112 }),
			error => error instanceof RangeError && error.message.includes('card \'a.md\' width must be positive')
		);
		assert.strictEqual(fileService.files.has('/work/.bh/mirror/canvas.yaml'), false);
		assert.strictEqual(fileService.writeCount, 0);
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

	test('saves the places of cards that appeared: it adds rows, changes none, and removes only rows BaseHalf chose', async () => {
		const chosen = (path: string, x: number): IBaseHalfCanvasCard => ({ path, kind: 'file', x, y: 20, width: 300, height: 220, auto: true });
		const files = new Map([['/work/.bh/mirror/canvas.yaml', [
			'path: ""',
			'cards:',
			'  - path: "mine.md"', '    kind: file', '    x: 10', '    y: 20', '    width: 300', '    height: 220',
			'  - path: "chosen.md"', '    kind: file', '    x: 350', '    y: 20', '    width: 300', '    height: 220', '    auto: true',
			'  - path: "gone-mine.md"', '    kind: file', '    x: 690', '    y: 20', '    width: 300', '    height: 220',
			'  - path: "gone-chosen.md"', '    kind: file', '    x: 1030', '    y: 20', '    width: 300', '    height: 220', '    auto: true',
			'edges: []',
			''
		].join('\n')]]);
		const service = createService(files);

		// Another window saved `chosen.md` first, and the user's row for `mine.md` is there: neither is changed.
		const saved = await service.saveAppearedCards(folder(''), [chosen('mine.md', 999), chosen('chosen.md', 999), chosen('new.md', 1370)], ['gone-mine.md', 'gone-chosen.md', 'chosen.md-not-gone']);
		const written = files.get('/work/.bh/mirror/canvas.yaml');
		const again = await service.saveAppearedCards(folder(''), [chosen('new.md', 1)], []);

		assert.deepStrictEqual({
			rows: saved?.cards.map(card => `${card.path}@${card.x}${card.auto ? '*' : ''}`),
			// The mark is one line of the row, and it is read back.
			markWritten: written?.includes('  - path: "new.md"\n    kind: file\n    x: 1370\n    y: 20\n    width: 300\n    height: 220\n    auto: true\n'),
			unchangedByASecondRun: files.get('/work/.bh/mirror/canvas.yaml') === written,
			secondRun: again?.cards.length
		}, {
			rows: ['mine.md@10', 'chosen.md@350*', 'gone-mine.md@690', 'new.md@1370*'],
			markWritten: true,
			unchangedByASecondRun: true,
			secondRun: 4
		});
	});

	test('saves the size of rows whose card took its picture\'s shape: their place and their mark stay, a path without a row is left out, and a card does not grow over one put beside it since', async () => {
		const files = new Map([['/work/.bh/mirror/canvas.yaml', [
			'path: ""',
			'cards:',
			'  - path: "shot.mp4"', '    kind: file', '    x: 10', '    y: 20', '    width: 300', '    height: 220', '    auto: true',
			'  - path: "still.png"', '    kind: file', '    x: 600', '    y: 20', '    width: 300', '    height: 220',
			'  - path: "late.png"', '    kind: file', '    x: 1000', '    y: 20', '    width: 300', '    height: 220',
			// Moved beside it after the drawing chose its size.
			'  - path: "arrived.md"', '    kind: file', '    x: 1300', '    y: 20', '    width: 300', '    height: 220',
			'edges: []',
			''
		].join('\n')]]);
		const service = createService(files);

		const saved = await service.saveAppearedCards(folder(''), [], [], undefined, {
			reshaped: [
				{ path: 'shot.mp4', kind: 'file', x: 10, y: 20, width: 533, height: 300, auto: true },
				{ path: 'still.png', kind: 'file', x: 600, y: 20, width: 300, height: 400 },
				{ path: 'late.png', kind: 'file', x: 1000, y: 20, width: 533, height: 300 },
				{ path: 'gone.png', kind: 'file', x: 0, y: 0, width: 300, height: 300 }
			]
		});

		assert.deepStrictEqual(saved?.cards, [
			{ path: 'shot.mp4', kind: 'file', x: 10, y: 20, width: 533, height: 300, auto: true },
			{ path: 'still.png', kind: 'file', x: 600, y: 20, width: 300, height: 400 },
			{ path: 'late.png', kind: 'file', x: 1000, y: 20, width: 300, height: 220 },
			{ path: 'arrived.md', kind: 'file', x: 1300, y: 20, width: 300, height: 220 }
		]);
	});

	test('does not save chosen places over a layout it cannot read in full', async () => {
		const damaged = 'path: ""\ncards:\n  - path: "a.md"\n    kind: file\n    x: 10\n    y: 20\n    width: 300\n    height: 220\n  - path: "broken.md"\n    kind: file\nedges: []\n';
		const files = new Map([['/work/.bh/mirror/canvas.yaml', damaged]]);
		const service = createService(files);

		const saved = await service.saveAppearedCards(folder(''), [{ path: 'new.md', kind: 'file', x: 350, y: 20, width: 300, height: 220, auto: true }], []);

		assert.deepStrictEqual({ saved, bytes: files.get('/work/.bh/mirror/canvas.yaml') === damaged, files: [...files.keys()] }, { saved: undefined, bytes: true, files: ['/work/.bh/mirror/canvas.yaml'] });
	});

	test('writes the ignore file before the first layout, leaves one that is there, and writes no layout without it', async () => {
		const card: IBaseHalfCanvasCard = { path: 'a.md', kind: 'file', x: 10, y: 20, width: 300, height: 220 };
		const first = new TestFileService(new Map());
		first.ignoreFileThere = false;
		await mirrorService(first as unknown as IFileService).updateCardGeometry(folder(''), card);
		const firstFiles = [...first.files.keys()];
		// Deleted, and written again before the next layout write.
		first.files.delete(IGNORE_FILE_PATH);
		await mirrorService(first as unknown as IFileService).updateCardGeometry(folder(''), { ...card, x: 50 });

		// One that is there is left as it is, whatever it holds.
		const edited = new TestFileService(new Map([[IGNORE_FILE_PATH, '# changed by someone\n']]));
		edited.ignoreFileThere = false;
		await mirrorService(edited as unknown as IFileService).updateCardGeometry(folder(''), card);

		// It cannot be written: then no layout is written either, so git never shows one.
		const failing = new TestFileService(new Map());
		failing.ignoreFileThere = false;
		failing.failNextWrite(IGNORE_FILE_PATH, new Error('disk full'));
		const failed = await mirrorService(failing as unknown as IFileService).updateCardGeometry(folder(''), card).then(() => 'written', error => (error as Error).message);

		assert.deepStrictEqual({
			firstFiles,
			content: first.files.get(IGNORE_FILE_PATH),
			edited: edited.files.get(IGNORE_FILE_PATH),
			failed,
			failingFiles: [...failing.files.keys()]
		}, {
			firstFiles: [IGNORE_FILE_PATH, '/work/.bh/mirror/canvas.yaml'],
			content: BASEHALF_MIRROR_IGNORE_CONTENT,
			edited: '# changed by someone\n',
			failed: 'disk full',
			failingFiles: []
		});
	});

	test('followNode moves rows into free places only, replaces nothing of the user\'s, and can be run again', async () => {
		const row = (path: string, x: number, auto = false) => [`  - path: "${path}"`, '    kind: file', `    x: ${x}`, '    y: 20', '    width: 260', '    height: 140', ...(auto ? ['    auto: true'] : [])];
		const edge = (from: string, to: string, anchor = 'east') => [`  - from: "${from}"`, `    from_anchor: ${anchor}`, `    to: "${to}"`, '    to_anchor: west'];
		const canvas = (path: string, cards: string[][], edges: string[][] = []) => [`path: "${path}"`, 'cards:', ...cards.flat(), 'edges:', ...edges.flat(), ''].join('\n');
		// A row that BaseHalf chose is marked with a star.
		const summary = async (service: BaseHalfCanvasMirrorService, relativePath: string) => {
			const file = await service.readCanvas(folder(relativePath));
			return { cards: (file?.cards ?? []).map(card => `${card.path}@${card.x}${card.auto ? '*' : ''}`), edges: (file?.edges ?? []).map(item => `${item.from}>${item.to}:${item.from_anchor}`) };
		};

		// A rename inside one folder: the row and its edges take the new name.
		const renamed = createService(new Map([['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10), row('b.md', 50)], [edge('old.md', 'b.md'), edge('b.md', 'old.md')])]]));
		await renamed.followNode(workspaceFolder, 'old.md', 'new.md');
		const once = await summary(renamed, '');
		await renamed.followNode(workspaceFolder, 'old.md', 'new.md');

		// The new name already has a row of its own: both rows stay, and so does the edge that would collide.
		const taken = createService(new Map([['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10), row('new.md', 99), row('b.md', 50)], [edge('old.md', 'b.md'), edge('new.md', 'b.md', 'north')])]]));
		await taken.followNode(workspaceFolder, 'old.md', 'new.md');

		// A run that stopped after writing the new row: the old one is all that is left to remove.
		const interrupted = createService(new Map([['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10), row('new.md', 10)])]]));
		await interrupted.followNode(workspaceFolder, 'old.md', 'new.md');

		// The item was drawn as a new card before it was known to be a moved one:
		// the row BaseHalf chose for it gives way, and the card has its old place.
		const drawnFirst = createService(new Map([['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10), row('b.md', 50), row('new.md', 400, true)])]]));
		await drawnFirst.followNode(workspaceFolder, 'old.md', 'new.md');

		// To another folder: the row goes to the end of that folder's canvas, as a row BaseHalf chose.
		const moved = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10), row('b.md', 50)], [edge('old.md', 'b.md')])],
			['/work/.bh/mirror/docs/canvas.yaml', canvas('docs', [row('docs/x.md', 700)])]
		]));
		await moved.followNode(workspaceFolder, 'old.md', 'docs/old.md');
		const movedOnce = [await summary(moved, ''), await summary(moved, 'docs')];
		await moved.followNode(workspaceFolder, 'old.md', 'docs/old.md');
		// A row of the user's is at the new path: it stands, and the row that would follow stays.
		const movedTaken = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10)])],
			['/work/.bh/mirror/docs/canvas.yaml', canvas('docs', [row('docs/old.md', 70)])]
		]));
		await movedTaken.followNode(workspaceFolder, 'old.md', 'docs/old.md');
		// A row BaseHalf chose is at the new path, from a drawing or from a run that
		// stopped after writing it: it keeps its place, and the old row goes.
		const movedDrawnFirst = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10)])],
			['/work/.bh/mirror/docs/canvas.yaml', canvas('docs', [row('docs/x.md', 700), row('docs/old.md', 1040, true)])]
		]));
		await movedDrawnFirst.followNode(workspaceFolder, 'old.md', 'docs/old.md');
		// The other folder has no layout: nothing is written there, and the card appears when it is first drawn.
		const movedIntoUnseen = createService(new Map([['/work/.bh/mirror/canvas.yaml', canvas('', [row('old.md', 10), row('b.md', 50)])]]));
		await movedIntoUnseen.followNode(workspaceFolder, 'old.md', 'docs/old.md');
		// The card the user had made large was drawn as a new, small card between two others.
		// At its size it would reach its neighbour, so it goes to the end of that canvas.
		const large = [...row('old.md', 10).slice(0, 4), '    width: 600', '    height: 400'];
		const movedLarge = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', canvas('', [large])],
			['/work/.bh/mirror/docs/canvas.yaml', canvas('docs', [row('docs/x.md', 700), row('docs/old.md', 1040, true), row('docs/y.md', 1380)])]
		]));
		await movedLarge.followNode(workspaceFolder, 'old.md', 'docs/old.md');
		const largeOnce = await movedLarge.readCanvas(folder('docs'));
		await movedLarge.followNode(workspaceFolder, 'old.md', 'docs/old.md');

		// A folder: its own canvas goes row by row, and its card in the parent follows.
		const folderMove = createService(new Map([
			['/work/.bh/mirror/canvas.yaml', canvas('', [row('docs', 10)])],
			['/work/.bh/mirror/docs/canvas.yaml', canvas('docs', [row('docs/a.md', 1), row('docs/b.md', 2)], [edge('docs/a.md', 'docs/b.md')])],
			['/work/.bh/mirror/notes/canvas.yaml', canvas('notes', [row('notes/b.md', 77)])]
		]));
		await folderMove.followNode(workspaceFolder, 'docs', 'notes');

		assert.deepStrictEqual({
			renamed: once,
			renamedAgain: await summary(renamed, ''),
			taken: await summary(taken, ''),
			interrupted: await summary(interrupted, ''),
			drawnFirst: await summary(drawnFirst, ''),
			moved: movedOnce,
			movedAgain: [await summary(moved, ''), await summary(moved, 'docs')],
			movedTaken: [await summary(movedTaken, ''), await summary(movedTaken, 'docs')],
			movedDrawnFirst: [await summary(movedDrawnFirst, ''), await summary(movedDrawnFirst, 'docs')],
			movedIntoUnseen: [await summary(movedIntoUnseen, ''), await summary(movedIntoUnseen, 'docs')],
			movedLarge: [await summary(movedLarge, ''), largeOnce?.cards.find(card => card.path === 'docs/old.md'), (await movedLarge.readCanvas(folder('docs')))?.cards.find(card => card.path === 'docs/old.md')],
			folderMove: [await summary(folderMove, ''), await summary(folderMove, 'docs'), await summary(folderMove, 'notes')]
		}, {
			renamed: { cards: ['new.md@10', 'b.md@50'], edges: ['new.md>b.md:east', 'b.md>new.md:east'] },
			renamedAgain: { cards: ['new.md@10', 'b.md@50'], edges: ['new.md>b.md:east', 'b.md>new.md:east'] },
			taken: { cards: ['old.md@10', 'new.md@99', 'b.md@50'], edges: ['old.md>b.md:east', 'new.md>b.md:north'] },
			interrupted: { cards: ['new.md@10'], edges: [] },
			drawnFirst: { cards: ['new.md@10', 'b.md@50'], edges: [] },
			moved: [{ cards: ['b.md@50'], edges: [] }, { cards: ['docs/x.md@700', 'docs/old.md@1040*'], edges: [] }],
			movedAgain: [{ cards: ['b.md@50'], edges: [] }, { cards: ['docs/x.md@700', 'docs/old.md@1040*'], edges: [] }],
			movedTaken: [{ cards: ['old.md@10'], edges: [] }, { cards: ['docs/old.md@70'], edges: [] }],
			movedDrawnFirst: [{ cards: [], edges: [] }, { cards: ['docs/x.md@700', 'docs/old.md@1040*'], edges: [] }],
			movedIntoUnseen: [{ cards: ['b.md@50'], edges: [] }, { cards: [], edges: [] }],
			movedLarge: [
				{ cards: [], edges: [] },
				{ path: 'docs/old.md', kind: 'file', x: 1720, y: 20, width: 600, height: 400, auto: true },
				{ path: 'docs/old.md', kind: 'file', x: 1720, y: 20, width: 600, height: 400, auto: true }
			],
			// `notes/b.md` had a row of its own: the row of `docs/b.md` stays behind.
			folderMove: [
				{ cards: ['notes@10'], edges: [] },
				{ cards: ['docs/b.md@2'], edges: [] },
				{ cards: ['notes/b.md@77', 'notes/a.md@1'], edges: ['notes/a.md>notes/b.md:east'] }
			]
		});
	});

	test('a card that goes to another folder is put at the end of that canvas with its size, and undo puts it back', async () => {
		const row = (path: string, x: number, y: number) => [`  - path: "${path}"`, '    kind: file', `    x: ${x}`, `    y: ${y}`, '    width: 260', '    height: 140'];
		const canvas = (path: string, cards: string[][]) => [`path: "${path}"`, 'cards:', ...cards.flat(), 'edges: []', ''].join('\n');
		// A row that BaseHalf chose is marked with a star.
		const places = async (service: BaseHalfCanvasMirrorService, relativePath = 'docs') => Object.fromEntries(((await service.readCanvas(folder(relativePath)))?.cards ?? []).map(card => [card.path, `${card.x},${card.y} ${card.width}x${card.height}${card.auto ? '*' : ''}`]));
		const files = (there: string[][]) => new Map([
			['/work/.bh/mirror/canvas.yaml', canvas('', [row('a.md', 10, 20), row('b.md', 400, 20)])],
			...(there.length > 0 ? [['/work/.bh/mirror/docs/canvas.yaml', canvas('docs', there)] as [string, string]] : [])
		]);
		const one = [row('docs/x.md', 900, 20)];
		// A card of the other folder lies where the card was in its own folder. That does not matter any more.
		const two = [row('docs/x.md', 40, 30), row('docs/y.md', 900, 400)];

		// Moved through the workbench.
		const workbenchOne = createService(files(one));
		await workbenchOne.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');
		const workbenchTwo = createService(files(two));
		await workbenchTwo.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');
		// Moved outside BaseHalf and followed, and followed a second time.
		const followedTwo = createService(files(two));
		await followedTwo.followNode(workspaceFolder, 'a.md', 'docs/a.md');
		const once = await places(followedTwo);
		await followedTwo.followNode(workspaceFolder, 'a.md', 'docs/a.md');
		// Into a folder that has no layout: nothing is written there.
		const unseen = createService(files([]));
		await unseen.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');
		const unseenThere = await places(unseen);
		// Undo moves the item back: the row is as it was, also when nothing was written in the other folder.
		await workbenchOne.relocateNode(workspaceFolder, 'docs/a.md', 'a.md');
		await unseen.relocateNode(workspaceFolder, 'docs/a.md', 'a.md');
		// Another card was put on the place meanwhile: the card that comes back goes to the end.
		const takenMeanwhile = createService(files(one));
		await takenMeanwhile.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');
		await takenMeanwhile.updateCardGeometry(folder(''), { path: 'b.md', kind: 'file', x: 20, y: 30, width: 260, height: 140 });
		await takenMeanwhile.relocateNode(workspaceFolder, 'docs/a.md', 'a.md');
		// The same when the other folder kept no row for it: it still has the size it had here.
		const takenAndUnseen = createService(files([]));
		await takenAndUnseen.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');
		await takenAndUnseen.updateCardGeometry(folder(''), { path: 'b.md', kind: 'file', x: 20, y: 30, width: 260, height: 140 });
		await takenAndUnseen.relocateNode(workspaceFolder, 'docs/a.md', 'a.md');
		// Another item of the same name arrives at that path from somewhere else: it is not the card that left.
		const anotherItem = createService(new Map([
			...files(one),
			['/work/.bh/mirror/other/canvas.yaml', canvas('other', [row('other/a.md', 77, 88)])]
		]));
		await anotherItem.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');
		await anotherItem.relocateNode(workspaceFolder, 'other/a.md', 'a.md');

		const atTheEnd = { 'docs/x.md': '40,30 260x140', 'docs/y.md': '900,400 260x140', 'docs/a.md': '1240,400 260x140*' };
		assert.deepStrictEqual({
			workbenchOne: await places(workbenchOne),
			workbenchTwo: await places(workbenchTwo),
			followedTwo: once,
			followedAgain: await places(followedTwo),
			unseenThere,
			back: [await places(workbenchOne, ''), await places(unseen, '')],
			backAtTheEnd: [await places(takenMeanwhile, ''), await places(takenAndUnseen, '')],
			anotherItem: await places(anotherItem, '')
		}, {
			workbenchOne: { 'docs/x.md': '900,20 260x140' },
			workbenchTwo: atTheEnd,
			followedTwo: atTheEnd,
			followedAgain: atTheEnd,
			unseenThere: {},
			back: [
				{ 'b.md': '400,20 260x140', 'a.md': '10,20 260x140' },
				{ 'b.md': '400,20 260x140', 'a.md': '10,20 260x140' }
			],
			backAtTheEnd: [
				{ 'b.md': '20,30 260x140', 'a.md': '360,30 260x140*' },
				{ 'b.md': '20,30 260x140', 'a.md': '360,30 260x140*' }
			],
			// At the end of the canvas, not where the other `a.md` had been.
			anotherItem: { 'b.md': '400,20 260x140', 'a.md': '740,20 260x140*' }
		});
	});

	test('followNodes follows the moves of one run with one write of each layout, and gives what following each by itself gives', async () => {
		const row = (path: string, x: number, auto = false) => [`  - path: "${path}"`, '    kind: file', `    x: ${x}`, '    y: 20', '    width: 260', '    height: 140', ...(auto ? ['    auto: true'] : [])];
		const edge = (from: string, to: string) => [`  - from: "${from}"`, '    from_anchor: east', `    to: "${to}"`, '    to_anchor: west'];
		const canvas = (path: string, cards: string[][], edges: string[][] = []) => [`path: "${path}"`, 'cards:', ...cards.flat(), 'edges:', ...edges.flat(), ''].join('\n');
		const layouts = (files: TestFileService) => Object.fromEntries([...files.files].filter(([path]) => path.endsWith('canvas.yaml')));

		// Many renames inside one folder: its layout is written once.
		const names = Array.from({ length: 50 }, (_, index) => `note-${index}.md`);
		const many = () => new Map([['/work/.bh/mirror/canvas.yaml', canvas('', [...names.map((name, index) => row(name, index * 340)), row('stays.md', 99_000)], [edge('note-0.md', 'note-1.md'), edge('note-2.md', 'stays.md')])]]);
		const renames = names.map(name => ({ from: name, to: `renamed-${name}`, withoutMirrorDirectory: true }));
		const manyTogether = new TestFileService(many());
		const manyFailed = await mirrorService(manyTogether as unknown as IFileService).followNodes(workspaceFolder, renames);
		const manyOneByOne = new TestFileService(many());
		const oneByOne = mirrorService(manyOneByOne as unknown as IFileService);
		for (const move of renames) {
			await oneByOne.followNode(workspaceFolder, move.from, move.to);
		}

		// Moves of several kinds. The fourth takes a row out of the layout that the
		// third put one into, so the two cannot be written in one go.
		const mixed = () => new Map([
			['/work/.bh/mirror/canvas.yaml', canvas('', [row('a.md', 10), row('b.md', 350), row('c.md', 690), row('docs', 1030), row('new-b.md', 5000, true)], [edge('a.md', 'b.md')])],
			['/work/.bh/mirror/docs/canvas.yaml', canvas('docs', [row('docs/x.md', 700), row('docs/y.md', 1040)])],
			['/work/.bh/mirror/old/canvas.yaml', canvas('old', [row('old/p.md', 1), row('old/q.md', 2)], [edge('old/p.md', 'old/q.md')])]
		]);
		const moves = [
			{ from: 'a.md', to: 'new-a.md' },
			{ from: 'b.md', to: 'new-b.md' },
			{ from: 'c.md', to: 'docs/c.md' },
			{ from: 'docs/x.md', to: 'x.md' },
			{ from: 'old', to: 'new' },
			{ from: 'same.md', to: 'same.md' }
		];
		const mixedTogether = new TestFileService(mixed());
		const mixedFailed = await mirrorService(mixedTogether as unknown as IFileService).followNodes(workspaceFolder, moves);
		const mixedOneByOne = new TestFileService(mixed());
		const each = mirrorService(mixedOneByOne as unknown as IFileService);
		for (const move of moves) {
			await each.followNode(workspaceFolder, move.from, move.to);
		}

		// One layout cannot be written: the moves of the other layouts are followed.
		const two = () => new Map([
			['/work/.bh/mirror/one/canvas.yaml', canvas('one', [row('one/a.md', 10)])],
			['/work/.bh/mirror/two/canvas.yaml', canvas('two', [row('two/a.md', 10)])]
		]);
		const inTwoFolders = [{ from: 'one/a.md', to: 'one/b.md' }, { from: 'two/a.md', to: 'two/b.md' }];
		const broken = new TestFileService(two());
		broken.failWrites('/work/.bh/mirror/one/canvas.yaml', new Error('disk full'));
		const brokenFailed = await mirrorService(broken as unknown as IFileService).followNodes(workspaceFolder, inTwoFolders);
		// It fails once: each of the moves is then followed by itself, and none is left.
		const once = new TestFileService(two());
		once.failNextWrite('/work/.bh/mirror/two/canvas.yaml', new Error('busy'));
		const onceFailed = await mirrorService(once as unknown as IFileService).followNodes(workspaceFolder, inTwoFolders);
		// A move to another folder whose old layout cannot be written: the row
		// that was written into the new layout is taken back, and the rename
		// that shared the write is followed by itself.
		const across = new TestFileService(two());
		across.failWrites('/work/.bh/mirror/one/canvas.yaml', new Error('read-only'));
		const acrossFailed = await mirrorService(across as unknown as IFileService).followNodes(workspaceFolder, [{ from: 'one/a.md', to: 'two/c.md' }, { from: 'two/a.md', to: 'two/b.md' }]);
		const paths = (layout: string) => layout.split('\n').filter(line => line.includes('- path: ')).map(line => JSON.parse(line.split('- path: ')[1]));

		assert.deepStrictEqual({
			many: [layouts(manyTogether), manyTogether.writeCount, manyOneByOne.writeCount, manyFailed.size, manyTogether.resolveCount],
			mixed: [layouts(mixedTogether), mixedFailed.size],
			mixedWrites: [mixedTogether.writeCount + mixedTogether.createCount, mixedOneByOne.writeCount + mixedOneByOne.createCount],
			broken: [[...brokenFailed].map(([index, error]) => `${index}: ${(error as Error).message}`), layouts(broken)['/work/.bh/mirror/one/canvas.yaml'].includes('one/a.md'), layouts(broken)['/work/.bh/mirror/two/canvas.yaml'].includes('two/b.md')],
			once: [onceFailed.size, layouts(once)['/work/.bh/mirror/one/canvas.yaml'].includes('one/b.md'), layouts(once)['/work/.bh/mirror/two/canvas.yaml'].includes('two/b.md')],
			across: [[...acrossFailed.keys()], paths(layouts(across)['/work/.bh/mirror/one/canvas.yaml']), paths(layouts(across)['/work/.bh/mirror/two/canvas.yaml'])]
		}, {
			// No directory is listed for an item that is known to have no mirror directory.
			many: [layouts(manyOneByOne), 1, 50, 0, 0],
			mixed: [layouts(mixedOneByOne), 0],
			// Root and `docs` twice, and the two layouts of the folder. One by one, the first three moves alone write four times.
			mixedWrites: [6, 8],
			broken: [['0: disk full'], true, true],
			once: [0, true, true],
			across: [[0], ['one/a.md'], ['two/b.md']]
		});
	});

	test('followNode leaves a layout that cannot be read in full as it is, on both sides', async () => {
		const good = ['path: "docs"', 'cards:', '  - path: "docs/a.md"', '    kind: file', '    x: 1', '    y: 20', '    width: 260', '    height: 140', 'edges: []', ''].join('\n');
		const damaged = ['path: "docs"', 'cards:', '  - path: "docs/a.md"', '    kind: file', '    x: 1', '    y: 20', '    width: 260', '    height: 140', '  - path: "docs/b.md"', '    kind: file', '    x: oops', 'edges: []', ''].join('\n');
		const unreadable = '<<<<<<< HEAD\npath: "notes"\n=======\n';
		const source = new Map([['/work/.bh/mirror/docs/canvas.yaml', damaged]]);
		const target = new Map([['/work/.bh/mirror/docs/canvas.yaml', good], ['/work/.bh/mirror/notes/canvas.yaml', unreadable]]);
		const preserved: IBaseHalfCanvasPreservedEvent[] = [];
		for (const files of [source, target]) {
			const service = createService(files);
			const listener = service.onDidPreserveUnreadableCanvas(event => preserved.push(event));
			await service.followNode(workspaceFolder, 'docs', 'notes');
			listener.dispose();
		}

		assert.deepStrictEqual({
			source: [source.get('/work/.bh/mirror/docs/canvas.yaml') === damaged, source.has('/work/.bh/mirror/notes/canvas.yaml')],
			target: [target.get('/work/.bh/mirror/docs/canvas.yaml') === good, target.get('/work/.bh/mirror/notes/canvas.yaml') === unreadable],
			preserved: preserved.length
		}, {
			source: [true, false],
			target: [true, true],
			// Nothing was rewritten, so nothing had to be kept aside and nobody is told.
			preserved: 0
		});
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

	test('relocateNode carries the card to the end of the new parent on a cross-folder move and drops in-parent edges', async () => {
		const files = new Map([
			['/work/.bh/mirror/docs/canvas.yaml', 'path: "docs"\ncards:\n  - path: "docs/x.md"\n    kind: file\n    x: 900\n    y: 20\n    width: 300\n    height: 220\nedges: []\n'],
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
		// Its coordinates belonged to the canvas it left. It keeps its size and goes beside the last card there.
		const target = await service.readCanvas(folder('docs'));
		assert.deepStrictEqual(target?.cards[1], { path: 'docs/a.md', kind: 'file', x: 1240, y: 20, width: 260, height: 140, auto: true });
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

	test('cross-parent card relocation compensates and carries the latest size', async () => {
		const sourcePath = '/work/.bh/mirror/canvas.yaml';
		const targetPath = '/work/.bh/mirror/docs/canvas.yaml';
		const initial = 'path: ""\ncards:\n  - path: "a.md"\n    kind: file\n    x: 10\n    y: 20\n    width: 260\n    height: 140\nedges: []\n';
		// The user resized the card while the move was being written.
		const external = initial.replace('width: 260', 'width: 480');
		const fileService = new TestFileService(new Map([
			[sourcePath, initial],
			[targetPath, 'path: "docs"\ncards:\n  - path: "docs/x.md"\n    kind: file\n    x: 900\n    y: 20\n    width: 260\n    height: 140\nedges: []\n']
		]));
		fileService.runAfterNextWrite(targetPath, () => fileService.replaceExternally(sourcePath, external));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.relocateNode(workspaceFolder, 'a.md', 'docs/a.md');

		assert.strictEqual(await service.readCanvas(folder('')), null);
		assert.deepStrictEqual((await service.readCanvas(folder('docs')))?.cards[1], { path: 'docs/a.md', kind: 'file', x: 1240, y: 20, width: 480, height: 140, auto: true });
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

	test('purgeNode completes around canvases it cannot read and keeps their bytes', async () => {
		const unreadable = 'path: [unterminated';
		const files = new Map([
			['/work/.bh/mirror/canvas.yaml', unreadable],
			['/work/.bh/mirror/docs/canvas.yaml', unreadable],
			['/work/.bh/mirror/docs/sub/canvas.yaml', 'path: "docs/sub"\ncards:\n  - path: "docs/sub/a.md"\n    kind: file\n    x: 1\n    y: 2\n    width: 260\n    height: 140\nedges: []\n']
		]);
		const service = createService(files);

		await service.purgeNode(workspaceFolder, 'docs');

		assert.deepStrictEqual(Object.fromEntries(files), {
			'/work/.bh/mirror/canvas.yaml': unreadable,
			'/work/.bh/mirror/docs/canvas.yaml': unreadable,
			'/work/.bh/mirror/docs/sub/canvas.yaml': 'path: "docs/sub"\ncards: []\nedges: []\n'
		});
	});

	test('relocateNode leaves an unreadable source canvas in place and replaces an unreadable destination only with incoming layout', async () => {
		const unreadable = 'path: [unterminated';
		const layout = (path: string) => `path: "${path}"\ncards:\n  - path: "${path}/a.md"\n    kind: file\n    x: 1\n    y: 2\n    width: 260\n    height: 140\nedges: []\n`;
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/lost/canvas.yaml', unreadable],
			['/work/.bh/mirror/from/canvas.yaml', layout('from')],
			['/work/.bh/mirror/to/canvas.yaml', unreadable]
		]));
		const service = mirrorService(fileService as unknown as IFileService);
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file('/work/.bh/mirror/to/canvas.yaml'), VSBuffer.fromString(unreadable));

		await service.relocateNode(workspaceFolder, 'lost', 'found', { retireDestination: true });
		await service.relocateNode(workspaceFolder, 'from', 'to', { retireDestination: true });

		assert.deepStrictEqual(Object.fromEntries(fileService.files), {
			'/work/.bh/mirror/lost/canvas.yaml': unreadable,
			'/work/.bh/mirror/from/canvas.yaml': 'path: "from"\ncards: []\nedges: []\n',
			'/work/.bh/mirror/to/canvas.yaml': layout('to'),
			[recoveryCopy.fsPath]: unreadable
		});
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
	private readonly runsAfterWrite = new Map<string, () => void>();
	private readonly externalWritesAfterRead = new Map<string, string>();
	private readonly hardWriteFailures = new Map<string, Error>();
	private readonly brokenWrites = new Map<string, Error>();
	readonly symbolicLinks = new Set<string>();
	resolveCount = 0;
	/** Whether `.bh/.gitignore` reads as present when `files` does not hold it. */
	ignoreFileThere = true;
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
			// Most tests are about one layout write: for them the ignore file is
			// there already, so that it adds no write of its own.
			if (this.ignoreFileThere && resource.fsPath === IGNORE_FILE_PATH) {
				return { value: VSBuffer.fromString(''), mtime: 0, etag: '' };
			}
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
		const broken = this.brokenWrites.get(resource.fsPath);
		if (broken) {
			throw broken;
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
		const afterWrite = this.runsAfterWrite.get(resource.fsPath);
		if (afterWrite) {
			this.runsAfterWrite.delete(resource.fsPath);
			afterWrite();
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

	/** Runs once, right after the next write that replaces the file at `path`. */
	runAfterNextWrite(path: string, run: () => void): void {
		this.runsAfterWrite.set(path, run);
	}

	writeExternallyAfterNextRead(path: string, contents: string): void {
		this.externalWritesAfterRead.set(path, contents);
	}

	failNextWrite(path: string, error: Error): void {
		this.hardWriteFailures.set(path, error);
	}

	/** Every write of the file at `path` fails from now on. */
	failWrites(path: string, error: Error): void {
		this.brokenWrites.set(path, error);
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
		this.resolveCount++;
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

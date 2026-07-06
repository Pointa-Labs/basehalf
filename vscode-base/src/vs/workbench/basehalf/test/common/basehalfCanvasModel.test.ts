/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { FileType, IFileStat } from '../../../../platform/files/common/files.js';
import {
	BASEHALF_CANVAS_CHILD_LIMIT,
	baseHalfCanvasAnchorPoint,
	baseHalfCanvasEdgeLayouts,
	baseHalfCanvasEdgePath,
	baseHalfCanvasItemsFromStat,
	baseHalfCanvasItemBounds,
	baseHalfCanvasModelFromStat,
	baseHalfCanvasPosition,
	isBaseHalfCanvasEntry
} from '../../common/basehalfCanvasModel.js';

suite('BaseHalfCanvasModel', () => {
	test('filters tooling folders, junk files, and root agent hints', () => {
		const root = folder('/workspace', [
			folder('/workspace/src'),
			folder('/workspace/node_modules'),
			file('/workspace/README.md'),
			file('/workspace/AGENTS.md'),
			file('/workspace/.DS_Store')
		]);

		assert.deepStrictEqual(baseHalfCanvasItemsFromStat(root, true).map(item => item.name), ['src', 'README.md']);
		assert.strictEqual(isBaseHalfCanvasEntry(file('/workspace/notes/AGENTS.md'), false), true);
	});

	test('sorts folders first then files alphabetically', () => {
		const root = folder('/workspace', [
			file('/workspace/z.md'),
			folder('/workspace/b'),
			file('/workspace/a.md'),
			folder('/workspace/a')
		]);

		assert.deepStrictEqual(baseHalfCanvasItemsFromStat(root, true).map(item => item.name), ['a', 'b', 'a.md', 'z.md']);
	});

	test('returns stable grid positions', () => {
		assert.deepStrictEqual(baseHalfCanvasPosition(0, 8), { x: 370, y: 550 });
		assert.deepStrictEqual(baseHalfCanvasPosition(5, 8), { x: 370, y: 830 });
	});

	test('merges saved canvas card geometry by workspace-relative path', () => {
		const root = folder('/workspace', [
			folder('/workspace/docs'),
			file('/workspace/README.md')
		]);

		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			canvas: {
				path: '',
				size: { width: 1200, height: 800 },
				cards: [{ path: 'docs', kind: 'folder', x: 320, y: 180, width: 260, height: 140 }],
				edges: []
			}
		});

		assert.deepStrictEqual(model.size, { width: 1200, height: 800 });
		assert.deepStrictEqual(model.edges, []);
		assert.deepStrictEqual(
			model.items.find(item => item.path === 'docs')?.card,
			{ path: 'docs', kind: 'folder', x: 320, y: 180, width: 260, height: 140 }
		);
		assert.strictEqual(model.items.find(item => item.path === 'README.md')?.card, undefined);
	});

	test('uses folder relative paths when matching saved card geometry inside subfolders', () => {
		const docs = folder('/workspace/docs', [
			file('/workspace/docs/chapter-01.md')
		]);

		const model = baseHalfCanvasModelFromStat(docs, {
			rootLevel: false,
			folderRelativePath: 'docs',
			canvas: {
				path: 'docs',
				cards: [{ path: 'docs/chapter-01.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 }],
				edges: []
			}
		});

		assert.strictEqual(model.items[0]?.path, 'docs/chapter-01.md');
		assert.deepStrictEqual(
			model.items[0]?.card,
			{ path: 'docs/chapter-01.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 }
		);
	});

	test('attaches badge metadata by workspace-relative path', () => {
		const root = folder('/workspace', [
			file('/workspace/README.md')
		]);

		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			badges: new Map([
				['README.md', {
					description: 'Project overview',
					references: ['docs/spec.md'],
					referenced_by: ['index.md'],
					orphan: true
				}]
			])
		});

		assert.deepStrictEqual(model.items[0].badge, {
			description: 'Project overview',
			references: ['docs/spec.md'],
			referenced_by: ['index.md'],
			orphan: true
		});
	});

	test('derives edges from badge references, styled by canvas.yaml where available', () => {
		const root = folder('/workspace', [
			file('/workspace/a.md'),
			file('/workspace/b.md'),
			file('/workspace/c.md')
		]);

		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			badges: new Map([
				// a→b styled below; a→c has no styling (drawn with default anchors);
				// a→docs/far.md is cross-canvas (not drawable here); a→a is a
				// hand-planted self-reference (never drawn).
				['a.md', { references: ['b.md', 'c.md', 'docs/far.md', 'a.md'], referenced_by: [] }]
			]),
			canvas: {
				path: '',
				cards: [],
				edges: [
					{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west', label: 'next' },
					// A stale style entry without a live reference draws nothing.
					{ from: 'b.md', from_anchor: 'south', to: 'c.md', to_anchor: 'north' }
				]
			}
		});

		assert.deepStrictEqual(model.edges, [
			{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west', label: 'next' },
			{ from: 'a.md', from_anchor: 'east', to: 'c.md', to_anchor: 'west' }
		]);
	});

	test('computes card bounds from saved geometry or the stable grid fallback', () => {
		const root = folder('/workspace', [
			file('/workspace/a.md'),
			file('/workspace/b.md')
		]);
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			canvas: {
				path: '',
				cards: [{ path: 'a.md', kind: 'file', x: 12, y: 24, width: 280, height: 160 }],
				edges: []
			}
		});

		assert.deepStrictEqual(baseHalfCanvasItemBounds(model.items[0], 0, model.items.length), { x: 12, y: 24, width: 280, height: 160 });
		assert.deepStrictEqual(baseHalfCanvasItemBounds(model.items[1], 1, model.items.length), { x: 1220, y: 690, width: 300, height: 220 });
	});

	test('keeps saved card positions in unbounded canvas coordinates', () => {
		const root = folder('/workspace', [
			file('/workspace/a.md')
		]);
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			canvas: {
				path: '',
				cards: [{ path: 'a.md', kind: 'file', x: -120, y: -80, width: 280, height: 160 }],
				edges: []
			}
		});

		assert.deepStrictEqual(baseHalfCanvasItemBounds(model.items[0], 0, model.items.length), { x: -120, y: -80, width: 280, height: 160 });
	});

	test('computes anchor points and routed edge paths', () => {
		const bounds = { x: 10, y: 20, width: 200, height: 100 };

		assert.deepStrictEqual(baseHalfCanvasAnchorPoint(bounds, 'north'), { x: 110, y: 20 });
		assert.deepStrictEqual(baseHalfCanvasAnchorPoint(bounds, 'east'), { x: 210, y: 70 });
		assert.deepStrictEqual(baseHalfCanvasAnchorPoint(bounds, 'south'), { x: 110, y: 120 });
		assert.deepStrictEqual(baseHalfCanvasAnchorPoint(bounds, 'west'), { x: 10, y: 70 });
		assert.strictEqual(
			baseHalfCanvasEdgePath({ x: 210, y: 70 }, 'east', { x: 320, y: 70 }, 'west'),
			'M 210 70 C 265 70 265 70 320 70'
		);
	});

	test('lays out edge paths and labels for visible endpoints', () => {
		const root = folder('/workspace', [
			file('/workspace/a.md'),
			file('/workspace/b.md')
		]);
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			// The edge derives from the reference; canvas.yaml supplies its styling.
			badges: new Map([
				['a.md', { references: ['b.md'], referenced_by: [] }]
			]),
			canvas: {
				path: '',
				cards: [
					{ path: 'a.md', kind: 'file', x: 10, y: 20, width: 200, height: 100 },
					{ path: 'b.md', kind: 'file', x: 320, y: 20, width: 200, height: 100 }
				],
				edges: [
					{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west', label: 'next' }
				]
			}
		});

		assert.deepStrictEqual(baseHalfCanvasEdgeLayouts(model.edges, model.items), {
			dropped: 0,
			edges: [{
				edge: { from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west', label: 'next' },
				from: { x: 210, y: 70 },
				to: { x: 320, y: 70 },
				path: 'M 210 70 C 265 70 265 70 320 70',
				label: { text: 'next', x: 265, y: 70 }
			}]
		});
	});

	test('caps very large folders and reports how many canvas entries were held back', () => {
		const children = Array.from({ length: BASEHALF_CANVAS_CHILD_LIMIT + 2 }, (_, index) => file(`/workspace/${String(index).padStart(3, '0')}.md`));
		const root = folder('/workspace', children);

		const model = baseHalfCanvasModelFromStat(root, { rootLevel: true });

		assert.strictEqual(model.items.length, BASEHALF_CANVAS_CHILD_LIMIT);
		assert.strictEqual(model.truncated, 2);
	});

	function folder(path: string, children: IFileStat[] = []): IFileStat {
		return stat(path, FileType.Directory, children);
	}

	function file(path: string): IFileStat {
		return stat(path, FileType.File);
	}

	function stat(path: string, type: FileType, children?: IFileStat[]): IFileStat {
		const resource = URI.file(path);
		return {
			resource,
			name: resource.path.split('/').pop() ?? '',
			isFile: type === FileType.File,
			isDirectory: type === FileType.Directory,
			isSymbolicLink: false,
			mtime: 0,
			ctime: 0,
			size: 0,
			children
		};
	}
});

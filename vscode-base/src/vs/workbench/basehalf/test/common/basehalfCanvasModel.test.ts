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
	baseHalfCanvasBadgeRelationships,
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

	test('exposes a relation after the latest badge snapshot completes its reciprocal pair', () => {
		const badges = new Map([
			['a.md', { references: ['b.md'], referenced_by: [] as string[] }],
			['b.md', { references: [] as string[], referenced_by: [] as string[] }]
		]);

		assert.deepStrictEqual(baseHalfCanvasBadgeRelationships('a.md', badges.get('a.md'), badges), {
			references: [],
			referencedBy: [],
			issues: [{ direction: 'outbound', from: 'a.md', to: 'b.md', reason: 'incomplete' }]
		});

		// An Agent commonly writes the two badge files sequentially while detail is
		// open. Re-evaluating against the latest workspace snapshot must reveal the
		// relation as soon as the target backlink lands.
		badges.set('b.md', { references: [], referenced_by: ['a.md'] });
		assert.deepStrictEqual(baseHalfCanvasBadgeRelationships('a.md', badges.get('a.md'), badges), {
			references: ['b.md'],
			referencedBy: [],
			issues: []
		});
	});

	test('does not count one-sided raw references in badge presentation state', () => {
		const badge = {
			references: ['outbound-half.md', 'outbound-complete.md'],
			referenced_by: ['inbound-half.md', 'inbound-complete.md']
		};
		const badges = new Map([
			['a.md', badge],
			['outbound-half.md', { references: [] as string[], referenced_by: [] as string[] }],
			['outbound-complete.md', { references: [] as string[], referenced_by: ['a.md'] }],
			['inbound-half.md', { references: [] as string[], referenced_by: [] as string[] }],
			['inbound-complete.md', { references: ['a.md'], referenced_by: [] as string[] }]
		]);

		const oneSidedOnly = baseHalfCanvasBadgeRelationships('a.md', {
			references: ['outbound-half.md'],
			referenced_by: ['inbound-half.md']
		}, badges);
		assert.deepStrictEqual(oneSidedOnly, {
			references: [],
			referencedBy: [],
			issues: [
				{ direction: 'outbound', from: 'a.md', to: 'outbound-half.md', reason: 'incomplete' },
				{ direction: 'inbound', from: 'inbound-half.md', to: 'a.md', reason: 'incomplete' }
			]
		});
		assert.strictEqual(oneSidedOnly.references.length > 0 || oneSidedOnly.referencedBy.length > 0, false);

		const relations = baseHalfCanvasBadgeRelationships('a.md', badge, badges);
		assert.deepStrictEqual(relations, {
			references: ['outbound-complete.md'],
			referencedBy: ['inbound-complete.md'],
			issues: [
				{ direction: 'outbound', from: 'a.md', to: 'outbound-half.md', reason: 'incomplete' },
				{ direction: 'inbound', from: 'inbound-half.md', to: 'a.md', reason: 'incomplete' }
			]
		});
		assert.strictEqual(relations.references.length + relations.referencedBy.length, 2);
	});

	test('distinguishes unreadable relationship endpoints and removes duplicate or self issues', () => {
		const outboundProblem = {
			relativePath: 'outbound-broken.md',
			resource: URI.file('/workspace/.bh/mirror/outbound-broken.md/badge.yaml'),
			message: 'Invalid YAML',
			corrupt: true
		};
		const inboundProblem = {
			relativePath: 'inbound-broken.md',
			resource: URI.file('/workspace/.bh/mirror/inbound-broken.md/badge.yaml'),
			message: 'Unable to read',
			corrupt: false
		};
		const badge = {
			references: ['outbound-half.md', 'outbound-half.md', 'outbound-broken.md', 'outbound-complete.md', 'a.md'],
			referenced_by: ['inbound-half.md', 'inbound-half.md', 'inbound-broken.md', 'inbound-complete.md', 'a.md']
		};
		const badges = new Map([
			['a.md', badge],
			['outbound-half.md', { references: [] as string[], referenced_by: [] as string[] }],
			['outbound-complete.md', { references: [] as string[], referenced_by: ['a.md'] }],
			['inbound-half.md', { references: [] as string[], referenced_by: [] as string[] }],
			['inbound-complete.md', { references: ['a.md'], referenced_by: [] as string[] }]
		]);
		const relationships = baseHalfCanvasBadgeRelationships('a.md', badge, badges, new Map([
			[outboundProblem.relativePath, outboundProblem],
			[inboundProblem.relativePath, inboundProblem]
		]));

		assert.deepStrictEqual(relationships, {
			references: ['outbound-complete.md'],
			referencedBy: ['inbound-complete.md'],
			issues: [
				{ direction: 'outbound', from: 'a.md', to: 'outbound-half.md', reason: 'incomplete' },
				{ direction: 'outbound', from: 'a.md', to: 'outbound-broken.md', reason: 'unreadable', problem: outboundProblem },
				{ direction: 'inbound', from: 'inbound-half.md', to: 'a.md', reason: 'incomplete' },
				{ direction: 'inbound', from: 'inbound-broken.md', to: 'a.md', reason: 'unreadable', problem: inboundProblem }
			]
		});
	});

	test('derives mutually recorded reference edges, anchored by canvas.yaml where available', () => {
		const root = folder('/workspace', [
			file('/workspace/a.md'),
			file('/workspace/b.md'),
			file('/workspace/c.md')
		]);

		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			badges: new Map([
				// a→b is anchored below; a→c has no saved anchors (drawn with defaults);
				// a→docs/far.md is cross-canvas (not drawable here); a→a is a
				// hand-planted self-reference (never drawn).
				['a.md', { references: ['b.md', 'c.md', 'docs/far.md', 'a.md'], referenced_by: [] }],
				['b.md', { references: [], referenced_by: ['a.md'] }],
				['c.md', { references: [], referenced_by: ['a.md'] }]
			]),
			canvas: {
				path: '',
				cards: [],
				edges: [
					{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' },
					// A stale style entry without a live reference draws nothing.
					{ from: 'b.md', from_anchor: 'south', to: 'c.md', to_anchor: 'north' }
				]
			}
		});

		assert.deepStrictEqual(model.edges, [
			{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' },
			{ from: 'a.md', from_anchor: 'east', to: 'c.md', to_anchor: 'west' }
		]);
	});

	test('does not draw a one-sided reference as a real relationship', () => {
		const root = folder('/workspace', [file('/workspace/a.md'), file('/workspace/b.md')]);
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			badges: new Map([
				['a.md', { references: ['b.md'], referenced_by: [] }],
				['b.md', { references: [], referenced_by: [] }]
			])
		});

		assert.deepStrictEqual(model.edges, []);
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

	test('lays out edge paths for visible endpoints', () => {
		const root = folder('/workspace', [
			file('/workspace/a.md'),
			file('/workspace/b.md')
		]);
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			// The edge derives from the reciprocal reference pair; canvas.yaml supplies anchors.
			badges: new Map([
				['a.md', { references: ['b.md'], referenced_by: [] }],
				['b.md', { references: [], referenced_by: ['a.md'] }]
			]),
			canvas: {
				path: '',
				cards: [
					{ path: 'a.md', kind: 'file', x: 10, y: 20, width: 200, height: 100 },
					{ path: 'b.md', kind: 'file', x: 320, y: 20, width: 200, height: 100 }
				],
				edges: [
					{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' }
				]
			}
		});

		assert.deepStrictEqual(baseHalfCanvasEdgeLayouts(model.edges, model.items), {
			dropped: 0,
			edges: [{
				edge: { from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' },
				from: { x: 210, y: 70 },
				to: { x: 320, y: 70 },
				path: 'M 210 70 C 265 70 265 70 320 70'
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

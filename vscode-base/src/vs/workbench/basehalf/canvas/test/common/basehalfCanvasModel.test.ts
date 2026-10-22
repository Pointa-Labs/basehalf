/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileType, IFileStat } from '../../../../../platform/files/common/files.js';
import {
	BASEHALF_CANVAS_CHILD_LIMIT,
	baseHalfCanvasAnchorPoint,
	baseHalfCanvasEdgeLayouts,
	baseHalfCanvasCenteredPlace,
	baseHalfCanvasEdgePath,
	baseHalfCanvasDraftStat,
	baseHalfCanvasEndPlace,
	baseHalfCanvasFolderWithDrafts,
	baseHalfCanvasItemsFromStat,
	baseHalfCanvasItemsSharePreviewVersion,
	baseHalfCanvasItemBounds,
	baseHalfCanvasModelFromStat,
	baseHalfCanvasOpenPosition,
	baseHalfCanvasPosition,
	baseHalfCanvasRowSpan,
	baseHalfCanvasTransferPlaces,
	baseHalfCanvasTransferPosition,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasItemRelationships,
	isBaseHalfCanvasEntry,
	isBaseHalfCanvasPathEligible
} from '../../common/basehalfCanvasModel.js';

suite('BaseHalfCanvasModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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

	test('reuses hydrated previews only while the resource version is unchanged', () => {
		const previous = {
			path: 'notes.md',
			name: 'notes.md',
			kind: 'file' as const,
			stat: { ...file('/workspace/notes.md'), etag: 'v1', mtime: 10, size: 12 }
		};

		assert.strictEqual(baseHalfCanvasItemsSharePreviewVersion(previous, {
			...previous,
			card: { path: 'notes.md', kind: 'file', x: 400, y: 300, width: 300, height: 220 },
			stat: { ...previous.stat }
		}), true);
		assert.strictEqual(baseHalfCanvasItemsSharePreviewVersion(previous, {
			...previous,
			stat: { ...previous.stat, etag: 'v2', mtime: 11 }
		}), false);
		assert.strictEqual(baseHalfCanvasItemsSharePreviewVersion(previous, {
			...previous,
			path: 'renamed.md',
			name: 'renamed.md',
			stat: { ...previous.stat, resource: URI.file('/workspace/renamed.md') }
		}), false);

		const withoutEtag = { ...previous, stat: { ...previous.stat, etag: undefined } };
		assert.strictEqual(baseHalfCanvasItemsSharePreviewVersion(withoutEtag, {
			...withoutEtag,
			stat: { ...withoutEtag.stat }
		}), true);
		assert.strictEqual(baseHalfCanvasItemsSharePreviewVersion(withoutEtag, {
			...withoutEtag,
			stat: { ...withoutEtag.stat, size: 13 }
		}), false);
		assert.strictEqual(baseHalfCanvasItemsSharePreviewVersion(
			{ ...withoutEtag, stat: { ...withoutEtag.stat, mtime: undefined } },
			{ ...withoutEtag, stat: { ...withoutEtag.stat, mtime: undefined } }
		), false);
	});

	test('returns stable grid positions', () => {
		assert.deepStrictEqual(baseHalfCanvasPosition(0, 8), { x: 370, y: 550 });
		assert.deepStrictEqual(baseHalfCanvasPosition(5, 8), { x: 370, y: 830 });
	});

	test('lays out imported groups as a compact grid from the drop point', () => {
		const origin = { x: 100, y: 200 };
		assert.deepStrictEqual(baseHalfCanvasTransferPosition(origin, 0, 5), { x: 100, y: 200 });
		assert.deepStrictEqual(baseHalfCanvasTransferPosition(origin, 1, 5), { x: 440, y: 200 });
		assert.deepStrictEqual(baseHalfCanvasTransferPosition(origin, 2, 5), { x: 780, y: 200 });
		assert.deepStrictEqual(baseHalfCanvasTransferPosition(origin, 3, 5), { x: 100, y: 480 });
	});

	test('places sequential new cards around the preferred point without overlap', () => {
		const size = { width: 300, height: 220 };
		const preferred = { x: 500, y: 400 };
		const source = { ...preferred, ...size };
		const first = baseHalfCanvasOpenPosition(preferred, size, [source]);
		const second = baseHalfCanvasOpenPosition(preferred, size, [source, { ...first, ...size }]);
		const third = baseHalfCanvasOpenPosition(preferred, size, [source, { ...first, ...size }, { ...second, ...size }]);

		assert.deepStrictEqual(first, { x: 840, y: 400 });
		assert.deepStrictEqual(second, { x: 500, y: 680 });
		assert.deepStrictEqual(third, { x: 500, y: 120 });
	});

	test('keeps non-overlapping create positions inside the visible canvas when possible', () => {
		const size = { width: 300, height: 220 };
		const preferred = { x: 500, y: 400 };
		const viewport = { x: 160, y: 100, width: 640, height: 800 };
		const source = { ...preferred, ...size };
		const first = baseHalfCanvasOpenPosition(preferred, size, [source], viewport);
		const second = baseHalfCanvasOpenPosition(preferred, size, [source, { ...first, ...size }], viewport);
		const third = baseHalfCanvasOpenPosition(preferred, size, [source, { ...first, ...size }, { ...second, ...size }], viewport);

		assert.deepStrictEqual(first, { x: 500, y: 680 });
		assert.deepStrictEqual(second, { x: 500, y: 120 });
		assert.deepStrictEqual(third, { x: 160, y: 400 });
	});

	test('a card created without a point is centered on the middle of the visible part', () => {
		// The visible part at 80%: a video card of 720 by 405 fits it, but not from its middle down and to the right.
		const viewport = { x: 0, y: 0, width: 1250, height: 750 };
		const middle = { x: 625, y: 375 };
		const video = { width: 720, height: 405 };
		const centered = baseHalfCanvasCenteredPlace(middle, video);
		assert.deepStrictEqual({
			centered,
			placed: baseHalfCanvasOpenPosition(centered, video, [], viewport),
			// A corner at the middle reaches past the right and bottom edges, and comes back inside along them.
			fromTheMiddle: baseHalfCanvasOpenPosition(middle, video, [], viewport)
		}, {
			centered: { x: 265, y: 172.5 },
			placed: { x: 265, y: 172.5 },
			fromTheMiddle: { x: 530, y: 345 }
		});
	});

	test('a step past an edge of the visible part comes back inside it, so a large card finds the room in sight', () => {
		// As in the smoke: a video card whose centered place is taken by a card
		// at the middle; the whole steps right, below, above, and left all leave
		// the visible part, which has room below the middle all the same.
		const viewport = { x: -772, y: -64, width: 1109, height: 863 };
		const video = { width: 720, height: 405 };
		const image = { x: 0, y: 0, width: 300, height: 220 };
		const placed = baseHalfCanvasOpenPosition({ x: -577, y: 149 }, video, [image], viewport);
		assert.deepStrictEqual({ placed, inside: placed.x >= viewport.x && placed.y >= viewport.y && placed.x + video.width <= viewport.x + viewport.width && placed.y + video.height <= viewport.y + viewport.height }, {
			placed: { x: -577, y: 394 },
			inside: true
		});
		// Larger than the visible part: no place in it, the end of the canvas.
		assert.deepStrictEqual(baseHalfCanvasOpenPosition({ x: 0, y: 0 }, { width: 2000, height: 405 }, [image], viewport), baseHalfCanvasEndPlace([image], { width: 2000, height: 405 }, baseHalfCanvasRowSpan([image], 1)));
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
		// The file has no row yet: it appears beside the folder card, as a row BaseHalf chose.
		assert.deepStrictEqual(model.items.find(item => item.path === 'README.md')?.card, { path: 'README.md', kind: 'file', x: 660, y: 180, width: 300, height: 220, auto: true });
		assert.deepStrictEqual(model.appeared.map(card => card.path), ['README.md']);
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

	test('attaches badge descriptions and connections by workspace-relative path', () => {
		const root = folder('/workspace', [
			file('/workspace/README.md'),
			file('/workspace/plain.md')
		]);

		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			badges: new Map([
				['README.md', { description: 'Project overview', orphan: true }]
			]),
			relationships: new Map([
				['README.md', relationships({ upstream: ['docs/spec.md'], downstream: ['index.md'] })],
				// A card without connections or issues carries no relationships.
				['plain.md', relationships({})]
			])
		});

		assert.deepStrictEqual(model.items.map(item => ({ path: item.path, badge: item.badge, relationships: item.relationships })), [
			{ path: 'plain.md', badge: undefined, relationships: undefined },
			{
				path: 'README.md',
				badge: { description: 'Project overview', orphan: true },
				relationships: { upstream: ['docs/spec.md'], downstream: ['index.md'], issueCount: 0 }
			}
		]);
	});

	test('derives edges from each card\'s own upstream list, anchored by canvas.yaml rows where available', () => {
		const root = folder('/workspace', [
			file('/workspace/a.md'),
			file('/workspace/b.md'),
			file('/workspace/c.md')
		]);

		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			relationships: new Map([
				// b and c list a upstream. b's anchors are remembered below; c has
				// no row (default anchors). c also lists a node in another folder
				// (not drawable here) and itself (never drawn).
				['b.md', relationships({ upstream: ['a.md'] })],
				['c.md', relationships({ upstream: ['a.md', 'docs/far.md', 'c.md'] })]
			]),
			canvas: {
				path: '',
				cards: [],
				edges: [
					{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' },
					// A row without a live reference is anchor memory only: it draws nothing.
					{ from: 'b.md', from_anchor: 'south', to: 'c.md', to_anchor: 'north' }
				]
			}
		});

		assert.deepStrictEqual(model.edges, [
			{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' },
			{ from: 'a.md', from_anchor: 'east', to: 'c.md', to_anchor: 'west' }
		]);
	});

	test('draws no edges without the index and never from a downstream list alone', () => {
		const root = folder('/workspace', [file('/workspace/a.md'), file('/workspace/b.md')]);
		assert.deepStrictEqual(baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			canvas: { path: '', cards: [], edges: [{ from: 'a.md', from_anchor: 'east', to: 'b.md', to_anchor: 'west' }] }
		}).edges, []);
		assert.deepStrictEqual(baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			relationships: new Map([['a.md', relationships({ downstream: ['b.md'] })]])
		}).edges, []);
	});

	test('keeps connected cards when the child cap holds filler back', () => {
		const children = Array.from({ length: BASEHALF_CANVAS_CHILD_LIMIT + 2 }, (_, index) => file(`/workspace/${String(index).padStart(3, '0')}.md`));
		const root = folder('/workspace', children);
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			relationships: new Map([['301.md', relationships({ downstream: ['000.md'] })]])
		});

		assert.strictEqual(model.items.some(item => item.path === '301.md'), true);
		assert.strictEqual(model.truncated, 2);
	});

	test('checks canvas eligibility of every path segment by name', () => {
		assert.deepStrictEqual([
			isBaseHalfCanvasPathEligible('docs/a.md', false),
			isBaseHalfCanvasPathEligible('node_modules/x/a.md', false),
			isBaseHalfCanvasPathEligible('.bh/mirror', true),
			isBaseHalfCanvasPathEligible('CLAUDE.md', false),
			isBaseHalfCanvasPathEligible('docs/CLAUDE.md', false),
			isBaseHalfCanvasPathEligible('docs/.DS_Store', false),
			isBaseHalfCanvasPathEligible('', true)
		], [true, false, false, false, true, false, false]);
	});

	test('chooses default edge anchors from relative card geometry', () => {
		const root = folder('/workspace', [file('/workspace/a.md'), file('/workspace/b.md')]);
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			relationships: new Map([['b.md', relationships({ upstream: ['a.md'] })]]),
			canvas: {
				path: '',
				cards: [
					{ path: 'a.md', kind: 'file', x: 400, y: 400, width: 300, height: 220 },
					{ path: 'b.md', kind: 'file', x: 400, y: 100, width: 300, height: 220 }
				],
				edges: []
			}
		});

		assert.deepStrictEqual(model.edges, [
			{ from: 'a.md', from_anchor: 'north', to: 'b.md', to_anchor: 'south' }
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
		// b.md has no row: it appears beside the last card and keeps the size of a new card.
		assert.deepStrictEqual(baseHalfCanvasItemBounds(model.items[1], 1, model.items.length), { x: 352, y: 24, width: 300, height: 220 });
	});

	/** The rows a first drawing of these files writes: the plain grid, as chosen rows. */
	function firstDrawing(names: readonly string[]) {
		return baseHalfCanvasModelFromStat(folder('/workspace', names.map(name => file(`/workspace/${name}`))), { rootLevel: true });
	}

	function place(card: { readonly x: number; readonly y: number } | undefined): [number, number] | undefined {
		return card ? [card.x, card.y] : undefined;
	}

	test('the first drawing of a folder is the plain grid, and every card gets a chosen row', () => {
		const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(name => `${name}.md`);
		const model = firstDrawing(names);

		assert.deepStrictEqual({
			drawn: model.items.map(item => place(item.card)),
			rows: model.appeared.map(card => [card.path, card.width, card.height, card.auto])
		}, {
			drawn: names.map((_, index) => place(baseHalfCanvasPosition(index, names.length))),
			rows: names.map(name => [name, 300, 220, true])
		});
	});

	test('a card that appears goes to the end of the canvas, and no row that is there changes', () => {
		const twelve = Array.from({ length: 12 }, (_, index) => `${String.fromCharCode(98 + index)}.md`);
		const ten = twelve.slice(0, 10);
		const rowsOf = (names: readonly string[]) => [...firstDrawing(names).appeared];
		const after = (rows: readonly IBaseHalfCanvasCard[], names: readonly string[]) => baseHalfCanvasModelFromStat(
			folder('/workspace', names.map(name => file(`/workspace/${name}`))),
			{ rootLevel: true, canvas: { path: '', cards: rows, edges: [] } }
		);
		const added = (rows: readonly IBaseHalfCanvasCard[], names: readonly string[], ...more: string[]) => after(rows, [...names, ...more]).appeared.map(card => [card.path, card.x, card.y]);
		const dragged = rowsOf(twelve).map((card, index) => index === 0 ? { ...card, x: card.x - 100, y: card.y - 37, auto: undefined } : card);
		const kept = after(rowsOf(twelve), [...twelve, 'a.md']);

		assert.deepStrictEqual({
			// The last row has room. A name that sorts first is not sorted in.
			besideTheLast: added(rowsOf(twelve), twelve, 'a.md'),
			rowsUntouched: kept.items.filter(item => item.path !== 'a.md').map(item => item.card),
			// The same after the user moved the first card a little: the row goes on.
			afterADrag: added(dragged, twelve, 'a.md'),
			// The last row is full: a new row starts under the first column.
			newRow: added(rowsOf(ten), ten, 'a.md'),
			// Several at once follow each other in list order.
			together: added(rowsOf(ten), ten, 'x.md', 'a.md', 'y.md', 'z1.md', 'z2.md', 'z3.md', 'z4.md'),
			// An empty stretch between the user's cards stays empty.
			gapKept: added([
				{ path: 'b.md', kind: 'file', x: 0, y: 0, width: 300, height: 220 },
				{ path: 'c.md', kind: 'file', x: 1360, y: 0, width: 300, height: 220 }
			], ['b.md', 'c.md'], 'd.md'),
			// The user's cards are wider than five cells: the rows of new cards are that wide.
			wide: added([
				{ path: 'b.md', kind: 'file', x: 0, y: 0, width: 300, height: 220 },
				{ path: 'c.md', kind: 'file', x: 2040, y: 0, width: 300, height: 220 },
				{ path: 'd.md', kind: 'file', x: 0, y: 280, width: 300, height: 220 }
			], ['b.md', 'c.md', 'd.md'], 'e.md', 'f.md', 'g.md', 'h.md', 'i.md', 'j.md', 'k.md')
		}, {
			besideTheLast: [['a.md', 1050, 970]],
			rowsUntouched: rowsOf(twelve),
			afterADrag: [['a.md', 1050, 970]],
			newRow: [['a.md', 370, 1110]],
			together: [['a.md', 370, 1110], ['x.md', 710, 1110], ['y.md', 1050, 1110], ['z1.md', 1390, 1110], ['z2.md', 1730, 1110], ['z3.md', 370, 1390], ['z4.md', 710, 1390]],
			gapKept: [['d.md', 0, 280]],
			wide: [['e.md', 340, 280], ['f.md', 680, 280], ['g.md', 1020, 280], ['h.md', 1360, 280], ['i.md', 1700, 280], ['j.md', 2040, 280], ['k.md', 0, 560]]
		});
	});

	test('a draft is an item of its folder with a stat made from its path, marked as a draft, and drawn at the size of its kind', () => {
		const shots = folder('/workspace/shots', [file('/workspace/shots/brief.md'), file('/workspace/shots/hero.png')]);
		const withDrafts = baseHalfCanvasFolderWithDrafts(shots, [
			{ resource: URI.file('/workspace/shots/video.mp4'), name: 'video.mp4' },
			{ resource: URI.file('/workspace/shots/image.png'), name: 'image.png' },
			// An item that has the name is no draft.
			{ resource: URI.file('/workspace/shots/HERO.png'), name: 'HERO.png' }
		]);
		const model = baseHalfCanvasModelFromStat(withDrafts, {
			rootLevel: false,
			folderRelativePath: 'shots',
			generationCards: new Map([
				['shots/video.mp4', { kind: 'video', draft: true }],
				['shots/image.png', { kind: 'image', draft: true }],
				['shots/hero.png', { kind: 'image', draft: false }]
			])
		});
		assert.deepStrictEqual(model.items.map(item => [item.path, item.stat.isFile, item.generation, item.card?.width, item.card?.height]), [
			['shots/brief.md', true, undefined, 300, 220],
			['shots/hero.png', true, { kind: 'image', draft: false }, 300, 220],
			['shots/image.png', true, { kind: 'image', draft: true }, 300, 220],
			['shots/video.mp4', true, { kind: 'video', draft: true }, 720, 405]
		]);
	});

	test('a draft keeps its preview until it gets its file, which is read anew', () => {
		const draft = { path: 'video.mp4', name: 'video.mp4', kind: 'file' as const, stat: baseHalfCanvasDraftStat(URI.file('/workspace/video.mp4'), 'video.mp4'), generation: { kind: 'video' as const, draft: true } };
		const drawnAgain = { ...draft, stat: baseHalfCanvasDraftStat(URI.file('/workspace/video.mp4'), 'video.mp4') };
		const withFile = { ...draft, stat: file('/workspace/video.mp4'), generation: { kind: 'video' as const, draft: false } };
		assert.deepStrictEqual([
			baseHalfCanvasItemsSharePreviewVersion(draft, drawnAgain),
			baseHalfCanvasItemsSharePreviewVersion(draft, withFile)
		], [true, false]);
	});

	test('a card that is larger than a cell keeps the next cards clear of it', () => {
		const root = folder('/workspace', ['a.mp4', 'b.md', 'c.md', 'd.md'].map(name => file(`/workspace/${name}`)));
		// A video generation card is drawn at 720 × 405.
		const model = baseHalfCanvasModelFromStat(root, { rootLevel: true, generationCards: new Map([['a.mp4', { kind: 'video', draft: false }]]) });

		assert.deepStrictEqual(model.appeared.map(card => [card.path, card.x, card.y, card.width, card.height]), [
			['a.mp4', 540, 690, 720, 405],
			// Beside it, 40 beyond its right edge.
			['b.md', 1300, 690, 300, 220],
			// The row of four cells is full: a new row, 60 below the lowest edge.
			['c.md', 540, 1155, 300, 220],
			['d.md', 880, 1155, 300, 220]
		]);
	});

	test('a group dropped at a point keeps its block, and a card whose slot is taken goes beside it', () => {
		const size = { width: 300, height: 220 };
		const origin = { x: 100, y: 200 };

		assert.deepStrictEqual({
			open: baseHalfCanvasTransferPlaces(origin, Array.from({ length: 5 }, () => size), []),
			// The first slot is taken. The other four stay, and the first card goes above the block.
			firstTaken: baseHalfCanvasTransferPlaces(origin, Array.from({ length: 5 }, () => size), [{ ...origin, ...size }])
		}, {
			open: [{ x: 100, y: 200 }, { x: 440, y: 200 }, { x: 780, y: 200 }, { x: 100, y: 480 }, { x: 440, y: 480 }],
			firstTaken: [{ x: 100, y: -80 }, { x: 440, y: 200 }, { x: 780, y: 200 }, { x: 100, y: 480 }, { x: 440, y: 480 }]
		});
	});

	test('when nothing near a point is open, the card goes to the end of the canvas', () => {
		const size = { width: 300, height: 220 };
		const taken = [{ x: 0, y: 0, ...size }, { x: 340, y: 0, ...size }];
		// The visible part holds one card and it is taken.
		const viewport = { x: 0, y: 0, width: 300, height: 220 };

		assert.deepStrictEqual({
			place: baseHalfCanvasOpenPosition({ x: 0, y: 0 }, size, taken, viewport),
			end: baseHalfCanvasEndPlace(taken, size, baseHalfCanvasRowSpan(taken, 1))
		}, {
			place: { x: 680, y: 0 },
			end: { x: 680, y: 0 }
		});
	});

	test('a place that waits for a write is kept and counts as taken, and a row is found whatever the spelling', () => {
		const root = folder('/workspace', ['a.md', 'b.md', 'c.md'].map(name => file(`/workspace/${name}`)));
		const waiting = { path: 'b.md', kind: 'file' as const, x: 340, y: 0, width: 300, height: 220, auto: true as const };
		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			canvas: { path: '', cards: [{ path: 'A.md', kind: 'file', x: 0, y: 0, width: 300, height: 220 }], edges: [] },
			waiting: new Map([['b.md', waiting]]),
			pathKey: path => path.toLowerCase()
		});

		assert.deepStrictEqual({
			drawn: model.items.map(item => [item.path, ...place(item.card)!]),
			appeared: model.appeared.map(card => card.path),
			// The row of `A.md` is the row of `a.md`: it is neither new nor gone, and takes the new spelling.
			respelled: model.respelled
		}, {
			drawn: [['a.md', 0, 0], ['b.md', 340, 0], ['c.md', 680, 0]],
			appeared: ['b.md', 'c.md'],
			respelled: [{ from: 'A.md', to: 'a.md' }]
		});
	});

	test('an item appears only while a canvas has room, and takes the place at the end when a card goes', () => {
		const names = Array.from({ length: BASEHALF_CANVAS_CHILD_LIMIT + 20 }, (_, index) => `${String(index).padStart(3, '0')}.md`);
		const first = firstDrawing(names);
		const canvas = { path: '', cards: first.appeared, edges: [] };
		const again = (list: readonly string[]) => baseHalfCanvasModelFromStat(folder('/workspace', list.map(name => file(`/workspace/${name}`))), { rootLevel: true, canvas });
		const full = again([...names, '000a.md']);
		const oneGone = again(names.filter(name => name !== '005.md'));
		const last = first.appeared[first.appeared.length - 1];

		assert.deepStrictEqual({
			rows: first.appeared.length,
			held: first.truncated,
			noCardWhileFull: [full.items.length, full.appeared.length, full.items.some(item => item.path === '000a.md')],
			// The first file that had no card gets one, beside the last card. The row of the file that is gone still counts.
			afterOneWent: oneGone.appeared.map(card => [card.path, card.x - last.x, card.y - last.y])
		}, {
			rows: BASEHALF_CANVAS_CHILD_LIMIT,
			held: 20,
			noCardWhileFull: [BASEHALF_CANVAS_CHILD_LIMIT, 0, false],
			afterOneWent: [[`${BASEHALF_CANVAS_CHILD_LIMIT}.md`, 340, 0]]
		});
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
			// The edge derives from b's upstream list; canvas.yaml supplies anchors.
			relationships: new Map([['b.md', relationships({ upstream: ['a.md'] })]]),
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

	function relationships(value: Partial<IBaseHalfCanvasItemRelationships>): IBaseHalfCanvasItemRelationships {
		return { upstream: [], downstream: [], issueCount: 0, ...value };
	}

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

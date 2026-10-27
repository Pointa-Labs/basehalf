/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileType, IFileStat } from '../../../../../platform/files/common/files.js';
import { BASEHALF_EXACT_UPSTREAM_IDENTITY } from '../../../references/common/basehalfReferenceEntries.js';
import { IBaseHalfIndexedStore } from '../../../references/common/basehalfReferenceIndex.js';
import { readBaseHalfSidecarUpstream } from '../../../references/common/basehalfReferenceStore.js';
import { IBaseHalfWorkspaceResource } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfCanvasItemBounds, baseHalfCanvasModelFromStat, IBaseHalfCanvasCard, IBaseHalfCanvasEdge, IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasSceneEdge } from '../../common/basehalfCanvasScene.js';
import { BaseHalfCanvasConnections } from '../../browser/view/basehalfCanvasConnections.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../../browser/basehalfCanvasWorkbench.contribution.js';

const SCENE = 'file:///workspace::';
const WORKSPACE = URI.file('/workspace');
const CARD = 'shot.mp4';
const ROWS: readonly IBaseHalfCanvasCard[] = [
	{ path: 'a.png', kind: 'file', x: 0, y: 0, width: 300, height: 220 },
	{ path: 'b.png', kind: 'file', x: 0, y: 300, width: 300, height: 220 },
	{ path: 'c.png', kind: 'file', x: 0, y: 600, width: 300, height: 220 },
	{ path: CARD, kind: 'file', x: 600, y: 300, width: 300, height: 220 }
];

suite('BaseHalfCanvasConnections', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * The canvas view as `showUpstreamLines` sees it: the cards of the last
	 * drawing from the folder, with `drawn` as the card's upstream list then,
	 * and the list the reference index holds for the card now.
	 */
	function createCanvas(drawn: readonly string[]) {
		const items = model(ROWS, drawn).items;
		const index = { list: drawn };
		const updates: { readonly revision: number; readonly edges: readonly IBaseHalfCanvasSceneEdge[] }[] = [];
		const view = {
			getCurrentFolder: () => ({ workspaceFolder: WORKSPACE, resource: WORKSPACE, relativePath: '' }),
			sceneKey: () => SCENE,
			renderedItemsByPath: new Map(items.map(item => [item.path, item])),
			canvasNavigationService: { state: {} },
			canvasScene: {
				isInteracting: () => false,
				update: (snapshot: { readonly revision: number; readonly edges: readonly IBaseHalfCanvasSceneEdge[] }) => { updates.push(snapshot); }
			},
			referenceIndexService: {
				getState: () => 'ready',
				getStore: (node: IBaseHalfWorkspaceResource): IBaseHalfIndexedStore | undefined => node.relativePath !== CARD ? undefined : {
					node,
					storeKind: 'sidecar',
					storeResource: URI.joinPath(WORKSPACE, '.bh', 'mirror', CARD, 'upstream.yaml'),
					read: readBaseHalfSidecarUpstream(`upstream: [${index.list.join(', ')}]\n`, { nodePath: CARD }),
					sidecarState: 'active'
				}
			},
			upstreamIdentity: () => BASEHALF_EXACT_UPSTREAM_IDENTITY,
			workspaceNode: (workspaceFolder: URI, relativePath: string, kind: IBaseHalfCanvasItem['kind']) => ({ resource: URI.joinPath(workspaceFolder, relativePath), workspaceFolder, relativePath, kind }),
			renderedLayoutEdges: [] as readonly IBaseHalfCanvasEdge[],
			renderedSceneEdges: sceneEdges(model(ROWS, drawn).edges),
			renderedSceneStructuralEpoch: 1,
			renderSeq: 4,
			renderedSceneCards: items.map((item, position) => ({ path: item.path, kind: item.kind, ...baseHalfCanvasItemBounds(item, position, items.length) }))
		};
		const connections = new BaseHalfCanvasConnections(view as unknown as BaseHalfCanvasWorkbenchContribution);
		return { view, connections, index, updates };
	}

	test('draws the lines of a panel\'s list only while the reference index holds that list, so a read that came late never takes the canvas back', () => {
		const { view, connections, index, updates } = createCanvas(['a.png', 'b.png']);
		const before = lines(view.renderedSceneEdges);
		// A read of the panel from before b.png was connected comes late: the index and the canvas have the newer list.
		connections.showUpstreamLines(SCENE, CARD, ['a.png']);
		const late = { lines: lines(view.renderedSceneEdges), updates: updates.length };
		// The panel's own change: its list is the index's as soon as it is saved.
		index.list = ['a.png', 'b.png', 'c.png'];
		connections.showUpstreamLines(SCENE, CARD, ['a.png', 'b.png', 'c.png']);
		const connected = { lines: lines(view.renderedSceneEdges), updates: updates.map(update => `${update.revision}: ${lines(update.edges).join(', ')}`) };
		// The same list again, a list the index does not hold yet, and another canvas draw nothing.
		connections.showUpstreamLines(SCENE, CARD, ['a.png', 'b.png', 'c.png']);
		connections.showUpstreamLines(SCENE, CARD, ['c.png']);
		connections.showUpstreamLines('file:///workspace::docs', CARD, ['a.png', 'b.png', 'c.png']);
		assert.deepStrictEqual({ before, late, connected, updates: updates.length }, {
			before: ['a.png -> shot.mp4 east west', 'b.png -> shot.mp4 east west'],
			late: { lines: ['a.png -> shot.mp4 east west', 'b.png -> shot.mp4 east west'], updates: 0 },
			connected: {
				lines: ['a.png -> shot.mp4 east west', 'b.png -> shot.mp4 east west', 'c.png -> shot.mp4 east west'],
				updates: ['4: a.png -> shot.mp4 east west, b.png -> shot.mp4 east west, c.png -> shot.mp4 east west']
			},
			updates: 1
		});
	});

	test('places a new line\'s ends by where the cards are now, as the next drawing from the layout places them', () => {
		const { view, connections, index } = createCanvas(['a.png']);
		// c.png was moved to the right of the card after the last drawing: the scene has its new place, the drawn items its old row.
		const moved = ROWS.map(row => row.path === 'c.png' ? { ...row, x: 1200 } : row);
		view.renderedSceneCards = view.renderedSceneCards.map(card => card.path === 'c.png' ? { ...card, x: 1200 } : card);
		index.list = ['a.png', 'c.png'];
		connections.showUpstreamLines(SCENE, CARD, ['a.png', 'c.png']);
		assert.deepStrictEqual({
			drawn: lines(view.renderedSceneEdges),
			next: lines(sceneEdges(model(moved, ['a.png', 'c.png']).edges))
		}, {
			drawn: ['a.png -> shot.mp4 east west', 'c.png -> shot.mp4 west east'],
			next: ['a.png -> shot.mp4 east west', 'c.png -> shot.mp4 west east']
		});
	});

	function model(rows: readonly IBaseHalfCanvasCard[], upstream: readonly string[]) {
		return baseHalfCanvasModelFromStat(folder('/workspace', rows.map(row => file(`/workspace/${row.path}`))), {
			rootLevel: true,
			relationships: new Map([[CARD, { upstream, downstream: [], issueCount: 0 }]]),
			canvas: { path: '', cards: [...rows], edges: [] }
		});
	}

	function sceneEdges(edges: readonly IBaseHalfCanvasEdge[]): readonly IBaseHalfCanvasSceneEdge[] {
		return edges.map(edge => ({ ...edge, id: `${edge.from}\u0000${edge.to}`, fromKind: 'file', toKind: 'file' }));
	}

	function lines(edges: readonly IBaseHalfCanvasSceneEdge[]): string[] {
		return edges.map(edge => `${edge.from} -> ${edge.to} ${edge.from_anchor} ${edge.to_anchor}`);
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

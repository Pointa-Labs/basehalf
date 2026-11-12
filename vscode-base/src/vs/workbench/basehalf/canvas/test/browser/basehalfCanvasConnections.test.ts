/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileOperationError, FileOperationResult, FileType, IFileStat } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { BASEHALF_EXACT_UPSTREAM_IDENTITY } from '../../../references/common/basehalfReferenceEntries.js';
import { IBaseHalfIndexedStore, IBaseHalfUpstreamView } from '../../../references/common/basehalfReferenceIndex.js';
import { readBaseHalfSidecarUpstream } from '../../../references/common/basehalfReferenceStore.js';
import { IBaseHalfCanvasFolderState, IBaseHalfWorkspaceResource } from '../../../navigation/common/basehalfCanvasNavigation.js';
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

	test('reads the list of a card that appears from its own file, also while the reference index is building or has not read the file yet, and of no card that has its place', async () => {
		// a.md and d.md have their places; b.md, c.md, and e.md appear. e.md lists nothing.
		const lists = new Map<string, readonly string[]>([
			['b.md', ['a.md']],
			['c.md', ['a.md', 'b.md', 'docs/far.md']],
			['d.md', ['a.md']]
		]);
		const root = folder('/workspace', ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'].map(name => file(`/workspace/${name}`)));
		const read = async (state: 'building' | 'ready', indexed: readonly string[], appearing?: readonly string[]) => {
			const direct: string[] = [];
			const view = {
				referenceIndexService: {
					getState: () => state,
					getStores: () => [],
					getStore: (node: IBaseHalfWorkspaceResource): IBaseHalfIndexedStore | undefined => !indexed.includes(node.relativePath) ? undefined : {
						node,
						storeKind: 'sidecar',
						storeResource: URI.joinPath(WORKSPACE, '.bh', 'mirror', node.relativePath, 'upstream.yaml'),
						read: readBaseHalfSidecarUpstream(`upstream: [${(lists.get(node.relativePath) ?? []).join(', ')}]\n`, { nodePath: node.relativePath }),
						sidecarState: 'active'
					},
					resolveUpstream: async (node: IBaseHalfWorkspaceResource) => {
						direct.push(node.relativePath);
						return { entries: (lists.get(node.relativePath) ?? []).map(path => ({ status: 'valid', path })), issueCount: 0 } as unknown as IBaseHalfUpstreamView;
					},
					getDownstream: () => []
				},
				fileService: { stat: async () => { throw new FileOperationError('no marker', FileOperationResult.FILE_NOT_FOUND); } },
				upstreamIdentity: () => BASEHALF_EXACT_UPSTREAM_IDENTITY,
				workspaceNode: (workspaceFolder: URI, relativePath: string, kind: IBaseHalfCanvasItem['kind']) => ({ resource: URI.joinPath(workspaceFolder, relativePath), workspaceFolder, relativePath, kind }),
				openBadgeFaces: new Set<string>(),
				logService: new NullLogService()
			};
			const connections = new BaseHalfCanvasConnections(view as unknown as BaseHalfCanvasWorkbenchContribution);
			const result = await connections.readCanvasConnections(
				{ workspaceFolder: WORKSPACE, resource: WORKSPACE, relativePath: '' } as IBaseHalfCanvasFolderState,
				root,
				appearing ? new Set(appearing) : undefined
			);
			const follows = (entries: Iterable<readonly [string, readonly string[]]>) =>
				[...entries].filter(([, upstream]) => upstream.length > 0).map(([path, upstream]) => `${path} follows ${upstream.join(', ')}`).sort();
			return {
				read: direct.sort().join(', '),
				appearing: follows(result.appearingUpstream),
				lines: follows([...result.relationships].map(([path, { upstream }]) => [path, upstream] as const))
			};
		};
		const appearing = ['b.md', 'c.md', 'e.md'];
		assert.deepStrictEqual({
			// No card has a line while the index is building, and the cards that appear are read.
			building: await read('building', [], appearing),
			// The index is ready and has not read the new files: their lists are read, and drawn at once.
			notRead: await read('ready', ['a.md', 'd.md'], appearing),
			// The index has read them: no file is read twice, and an empty list is not read at all.
			indexed: await read('ready', ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], appearing),
			// A drawing in which no card appears reads as before.
			noneAppears: await read('ready', ['a.md', 'd.md']),
			// More cards than a canvas shows are not read one by one.
			tooMany: await read('building', [], [...appearing, ...Array.from({ length: 300 }, (_, index) => `more-${index}.md`)])
		}, {
			building: {
				read: 'b.md, c.md, e.md',
				appearing: ['b.md follows a.md', 'c.md follows a.md, b.md, docs/far.md'],
				lines: []
			},
			notRead: {
				read: 'b.md, c.md, d.md, e.md',
				appearing: ['b.md follows a.md', 'c.md follows a.md, b.md, docs/far.md'],
				lines: ['b.md follows a.md', 'c.md follows a.md, b.md, docs/far.md', 'd.md follows a.md']
			},
			indexed: {
				read: 'b.md, c.md, d.md',
				appearing: ['b.md follows a.md', 'c.md follows a.md, b.md, docs/far.md'],
				lines: ['b.md follows a.md', 'c.md follows a.md, b.md, docs/far.md', 'd.md follows a.md']
			},
			noneAppears: {
				read: 'd.md',
				appearing: [],
				lines: ['d.md follows a.md']
			},
			tooMany: {
				read: '',
				appearing: [],
				lines: []
			}
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

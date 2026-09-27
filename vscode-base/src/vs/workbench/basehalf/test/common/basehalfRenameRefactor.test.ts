/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IBaseHalfWorkspaceResource } from '../../common/basehalfCanvasNavigation.js';
import { BASEHALF_EXACT_UPSTREAM_IDENTITY, baseHalfAnalyzeUpstreamItems, IBaseHalfUpstreamIdentity } from '../../common/basehalfReferenceEntries.js';
import { IBaseHalfIndexedStore } from '../../common/basehalfReferenceIndex.js';
import { BaseHalfUpstreamStoreKind } from '../../common/basehalfReferenceStore.js';
import {
	baseHalfComposeRenamePlan,
	baseHalfIsSpellingOnlyMove,
	baseHalfPlanRenameUpdate,
	baseHalfPrimaryMoves,
	baseHalfRelocateRenameStores,
	baseHalfRemapMovedPath,
	baseHalfSnapshotRenameStores,
	baseHalfUpdateOnFileMove,
	IBaseHalfPathMove,
	IBaseHalfRenameStoreState,
	IBaseHalfRenameUpdatePlan
} from '../../common/basehalfRenameRefactor.js';

const folder = URI.file('/work');
/** A case-insensitive file system's identity. */
const CASE_INSENSITIVE: IBaseHalfUpstreamIdentity = { key: path => path.normalize('NFC').toLowerCase() };

function node(path: string): IBaseHalfWorkspaceResource {
	return { resource: URI.joinPath(folder, ...path.split('/')), workspaceFolder: folder, relativePath: path };
}

function items(nodePath: string, entries: readonly string[], identity = BASEHALF_EXACT_UPSTREAM_IDENTITY) {
	return baseHalfAnalyzeUpstreamItems(entries.map(text => ({ text, scalar: true })), nodePath, identity);
}

function indexed(path: string, storeKind: BaseHalfUpstreamStoreKind, entries: readonly string[], identity = BASEHALF_EXACT_UPSTREAM_IDENTITY, extra: Partial<IBaseHalfIndexedStore> = {}): IBaseHalfIndexedStore {
	return {
		node: node(path),
		storeKind,
		storeResource: node(path).resource,
		read: { readable: true, writable: true, items: items(path, entries, identity), hasKey: true, issue: false },
		...(storeKind === 'sidecar' ? { sidecarState: 'active' as const } : {}),
		...extra
	};
}

function state(path: string, storeKind: BaseHalfUpstreamStoreKind, current: readonly string[], snapshotEntries: readonly string[], extra: Partial<IBaseHalfRenameStoreState> = {}, identity = BASEHALF_EXACT_UPSTREAM_IDENTITY): IBaseHalfRenameStoreState {
	return { node: node(path), storeKind, items: items(path, current, identity), snapshotEntries, upstreamOnly: false, ...extra };
}

/** A plan in a compact, comparable shape. */
function summary(plan: IBaseHalfRenameUpdatePlan) {
	return {
		edits: plan.edits.map(edit => `${edit.node.relativePath}: ${edit.replacements.map(replacement => `${replacement.from}→${replacement.to}`).join(', ')}`),
		skipped: plan.skipped.map(skip => `${skip.node.relativePath}: ${skip.reason}${skip.entries ? ` ${skip.entries.join(', ')}` : ''}`),
		leftAlone: plan.leftAlone.map(entry => `${entry.node.relativePath}: ${entry.entry} ${entry.reason}`)
	};
}

suite('BaseHalfRenameRefactor (planner)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a folder move covers entries below it, and stores inside the folder are read at their new paths', () => {
		const moves: IBaseHalfPathMove[] = [{ from: 'docs', to: 'archive' }];
		const snapshot = baseHalfSnapshotRenameStores([
			indexed('notes.md', 'markdown', ['docs', 'docs/sub/a.md', 'other.md', 'docs-2/x.md']),
			indexed('docs/b.md', 'markdown', ['docs/sub/a.md']),
			indexed('docs', 'sidecar', ['other.md']),
			indexed('x.md', 'markdown', ['other.md']),
			indexed('gone.pdf', 'sidecar', ['docs'], BASEHALF_EXACT_UPSTREAM_IDENTITY, { sidecarState: 'missingNode' })
		], moves, BASEHALF_EXACT_UPSTREAM_IDENTITY, target => target.relativePath === 'renders/final.md');
		const relocated = baseHalfRelocateRenameStores(snapshot, moves, BASEHALF_EXACT_UPSTREAM_IDENTITY);
		const plan = baseHalfPlanRenameUpdate({
			moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: () => false,
			stores: relocated.map(store => state(store.nodePath, store.storeKind, store.nodePath === 'notes.md'
				? ['docs', 'docs/sub/a.md', 'other.md', 'docs-2/x.md']
				: ['docs/sub/a.md'], store.entries))
		});
		assert.deepStrictEqual({
			snapshot: snapshot.map(store => `${store.nodePath} ${store.storeKind} [${store.entries.join(', ')}]`),
			relocated: relocated.map(store => store.nodePath),
			plan: summary(plan)
		}, {
			snapshot: [
				'docs/b.md markdown [docs/sub/a.md]',
				'notes.md markdown [docs, docs/sub/a.md]'
			],
			relocated: ['archive/b.md', 'notes.md'],
			plan: {
				edits: [
					'archive/b.md: docs/sub/a.md→archive/sub/a.md',
					'notes.md: docs→archive, docs/sub/a.md→archive/sub/a.md'
				],
				skipped: [],
				leftAlone: []
			}
		});
	});

	test('an entry that names a sibling inside the moved folder is updated at the store\'s new path', () => {
		const moves: IBaseHalfPathMove[] = [{ from: 'topic', to: 'subject' }];
		const snapshot = baseHalfSnapshotRenameStores([
			indexed('topic/b.md', 'markdown', ['topic/a.md', 'root.md']),
			indexed('topic/clip.bhnode', 'node', ['topic/b.md'])
		], moves, BASEHALF_EXACT_UPSTREAM_IDENTITY, () => false);
		const stores = baseHalfRelocateRenameStores(snapshot, moves, BASEHALF_EXACT_UPSTREAM_IDENTITY);
		const plan = baseHalfPlanRenameUpdate({
			moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: () => false,
			stores: [
				state('subject/b.md', 'markdown', ['topic/a.md', 'root.md'], stores[0].entries),
				state('subject/clip.bhnode', 'node', ['topic/b.md'], stores[1].entries, { lifecycle: 'draft', bindings: [{ sourcePath: 'topic/b.md' }] })
			]
		});
		assert.deepStrictEqual({ stores: stores.map(store => store.nodePath), plan: summary(plan) }, {
			stores: ['subject/b.md', 'subject/clip.bhnode'],
			plan: {
				// A Draft's binding follows its entry in the same write (edit service).
				edits: ['subject/b.md: topic/a.md→subject/a.md', 'subject/clip.bhnode: topic/b.md→subject/b.md'],
				skipped: [],
				leftAlone: []
			}
		});
	});

	test('a case-only rename on a case-insensitive file system updates only the spelling', () => {
		const moves: IBaseHalfPathMove[] = [{ from: 'docs/Guide.md', to: 'docs/guide.md' }];
		const snapshot = baseHalfSnapshotRenameStores([
			indexed('a.md', 'markdown', ['docs/Guide.md'], CASE_INSENSITIVE),
			indexed('b.md', 'markdown', ['docs/guide.md'], CASE_INSENSITIVE),
			indexed('c.md', 'markdown', ['DOCS/GUIDE.md'], CASE_INSENSITIVE)
		], moves, CASE_INSENSITIVE, () => false);
		const plan = baseHalfPlanRenameUpdate({
			moves,
			identity: CASE_INSENSITIVE,
			// The old spelling names the renamed node itself.
			exists: () => true,
			stores: snapshot.map(store => state(store.nodePath, 'markdown', store.entries, store.entries, {}, CASE_INSENSITIVE))
		});
		assert.deepStrictEqual({
			spellingOnly: [baseHalfIsSpellingOnlyMove(moves, CASE_INSENSITIVE), baseHalfIsSpellingOnlyMove(moves, BASEHALF_EXACT_UPSTREAM_IDENTITY)],
			snapshot: snapshot.map(store => store.nodePath),
			plan: summary(plan)
		}, {
			spellingOnly: [true, false],
			snapshot: ['a.md', 'c.md'],
			plan: {
				edits: ['a.md: docs/Guide.md→docs/guide.md', 'c.md: DOCS/GUIDE.md→docs/guide.md'],
				skipped: [],
				leftAlone: []
			}
		});
	});

	test('a running node, an upstream-only node, and an unreadable store are skipped with their reasons', () => {
		const moves: IBaseHalfPathMove[] = [{ from: 'a.md', to: 'b.md' }];
		const plan = baseHalfPlanRenameUpdate({
			moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: () => false,
			stores: [
				state('clip.bhnode', 'node', ['a.md'], ['a.md'], { lifecycle: 'draft', blocking: { reason: 'running', message: 'This node is running.' } }),
				state('renders/final.md', 'markdown', ['a.md'], ['a.md'], { upstreamOnly: true }),
				state('broken.md', 'markdown', [], ['a.md'], { items: undefined }),
				state('dirty.md', 'markdown', ['a.md'], ['a.md'], { blocking: { reason: 'unsaved', message: 'Save or revert dirty.md first.' } }),
				state('notes.md', 'markdown', ['a.md'], ['a.md'])
			]
		});
		assert.deepStrictEqual({ plan: summary(plan), messages: plan.skipped.map(skip => skip.message ?? null) }, {
			plan: {
				edits: ['notes.md: a.md→b.md'],
				skipped: ['broken.md: unreadable', 'clip.bhnode: running', 'dirty.md: unsaved', 'renders/final.md: upstreamOnly'],
				leftAlone: []
			},
			messages: [null, 'This node is running.', 'Save or revert dirty.md first.', null]
		});
	});

	test('a sealed node keeps its bound entries at their historical paths and updates its unbound entries', () => {
		const moves: IBaseHalfPathMove[] = [{ from: 'docs', to: 'archive' }];
		const plan = baseHalfPlanRenameUpdate({
			moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: () => false,
			stores: [
				state('sealed.bhnode', 'node', ['docs/brief.md', 'docs/notes.md'], ['docs/brief.md', 'docs/notes.md'], { lifecycle: 'sealed', bindings: [{ sourcePath: 'docs/brief.md' }] }),
				state('attempted.bhnode', 'node', ['docs/brief.md'], ['docs/brief.md'], { lifecycle: 'attempted', bindings: [{ sourcePath: 'docs/brief.md' }] }),
				state('draft.bhnode', 'node', ['docs/brief.md'], ['docs/brief.md'], { lifecycle: 'draft', bindings: [{ sourcePath: 'docs/brief.md' }] })
			]
		});
		assert.deepStrictEqual(summary(plan), {
			edits: ['draft.bhnode: docs/brief.md→archive/brief.md', 'sealed.bhnode: docs/notes.md→archive/notes.md'],
			skipped: ['attempted.bhnode: historical docs/brief.md', 'sealed.bhnode: historical docs/brief.md'],
			leftAlone: []
		});
	});

	test('re-planning leaves alone entries that changed since the move or whose old path names a node again', () => {
		const moves: IBaseHalfPathMove[] = [{ from: 'docs', to: 'archive' }];
		const plan = baseHalfPlanRenameUpdate({
			moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: path => path === 'docs/back.md',
			stores: [state('notes.md', 'markdown', ['docs/back.md', 'docs/kept.md', 'docs/added.md/'], ['docs/back.md', 'docs/kept.md', 'docs/edited.md'])]
		});
		assert.deepStrictEqual(summary(plan), {
			// An entry added since still names the old path and is updated too.
			edits: ['notes.md: docs/kept.md→archive/kept.md, docs/added.md→archive/added.md'],
			skipped: [],
			leftAlone: ['notes.md: docs/back.md resolves', 'notes.md: docs/edited.md changed']
		});
	});

	test('pending moves compose: entries map through both moves, and a move back to the exact old path needs nothing', () => {
		const first = {
			moves: [{ from: 'a.md', to: 'b.md' }],
			stores: [{ nodePath: 'topic/n.md', storeKind: 'markdown' as const, upstreamOnly: false, entries: ['a.md'] }],
			storeKindChanges: ['b.md']
		};
		const twice = baseHalfComposeRenamePlan(first, [{ from: 'b.md', to: 'c.md' }, { from: 'topic', to: 'subject' }], BASEHALF_EXACT_UPSTREAM_IDENTITY);
		const back = baseHalfComposeRenamePlan(twice, [{ from: 'c.md', to: 'a.md' }], BASEHALF_EXACT_UPSTREAM_IDENTITY);
		const plan = baseHalfPlanRenameUpdate({
			moves: twice.moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: () => false,
			stores: twice.stores.map(store => state(store.nodePath, store.storeKind, ['a.md'], store.entries))
		});
		assert.deepStrictEqual({
			twice: [twice.moves, twice.stores.map(store => store.nodePath), twice.storeKindChanges],
			back: back.moves,
			plan: summary(plan).edits
		}, {
			twice: [[{ from: 'a.md', to: 'c.md' }], ['subject/n.md'], ['c.md']],
			back: [],
			plan: ['subject/n.md: a.md→c.md']
		});
	});

	test('pending moves compose through a later move of an item inside a moved folder', () => {
		const first = {
			moves: [{ from: 'docs', to: 'notes' }],
			stores: [{ nodePath: 'x.md', storeKind: 'markdown' as const, upstreamOnly: false, entries: ['docs/x.md', 'docs/y.md', 'docs/z.md'] }],
			storeKindChanges: ['notes']
		};
		// notes/x.md moves on; notes/z.md moves back into a new docs folder.
		const composed = baseHalfComposeRenamePlan(first, [{ from: 'notes/x.md', to: 'archive/x.md' }, { from: 'notes/z.md', to: 'docs/z.md' }], BASEHALF_EXACT_UPSTREAM_IDENTITY);
		const again = baseHalfComposeRenamePlan(composed, [{ from: 'archive', to: 'kept' }], BASEHALF_EXACT_UPSTREAM_IDENTITY);
		// The folder moves back; its item that moved on stays where it is.
		const back = baseHalfComposeRenamePlan(again, [{ from: 'notes', to: 'docs' }], BASEHALF_EXACT_UPSTREAM_IDENTITY);
		const plan = (moves: readonly IBaseHalfPathMove[]) => summary(baseHalfPlanRenameUpdate({
			moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: path => path === 'docs/z.md',
			stores: [state('x.md', 'markdown', ['docs/x.md', 'docs/y.md', 'docs/z.md'], ['docs/x.md', 'docs/y.md', 'docs/z.md'])]
		})).edits;
		assert.deepStrictEqual({
			composed: composed.moves,
			primary: baseHalfPrimaryMoves(composed.moves, BASEHALF_EXACT_UPSTREAM_IDENTITY),
			composedPlan: plan(composed.moves),
			againPlan: plan(again.moves),
			back: [back.moves, baseHalfPrimaryMoves(back.moves, BASEHALF_EXACT_UPSTREAM_IDENTITY)],
			backPlan: plan(back.moves)
		}, {
			composed: [{ from: 'docs', to: 'notes' }, { from: 'docs/x.md', to: 'archive/x.md' }, { from: 'docs/z.md', to: 'docs/z.md' }],
			primary: [{ from: 'docs', to: 'notes' }],
			// docs/z.md names the item at its old path again: it keeps the entry.
			composedPlan: ['x.md: docs/x.md→archive/x.md, docs/y.md→notes/y.md'],
			againPlan: ['x.md: docs/x.md→kept/x.md, docs/y.md→notes/y.md'],
			back: [[{ from: 'docs/x.md', to: 'kept/x.md' }], [{ from: 'docs/x.md', to: 'kept/x.md' }]],
			backPlan: ['x.md: docs/x.md→kept/x.md']
		});
	});

	test('a later plan leaves entries alone that name the old paths of an earlier unanswered plan', () => {
		// Plan 1 moved docs/a.md to docs/b.md and is unanswered; then docs moves to archive.
		const earlier = baseHalfComposeRenamePlan({
			moves: [{ from: 'docs/a.md', to: 'docs/b.md' }],
			stores: [{ nodePath: 'n.md', storeKind: 'markdown', upstreamOnly: false, entries: ['docs/a.md'] }],
			storeKindChanges: ['docs/b.md']
		}, [{ from: 'docs', to: 'archive' }], BASEHALF_EXACT_UPSTREAM_IDENTITY);
		const moves: IBaseHalfPathMove[] = [{ from: 'docs', to: 'archive' }];
		const exclude = ['docs/a.md'];
		const snapshot = baseHalfSnapshotRenameStores([
			indexed('n.md', 'markdown', ['docs/a.md', 'docs/c.md']),
			indexed('m.md', 'markdown', ['docs/a.md'])
		], moves, BASEHALF_EXACT_UPSTREAM_IDENTITY, () => false, exclude);
		const later = baseHalfPlanRenameUpdate({
			moves,
			exclude,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: () => false,
			stores: snapshot.map(store => state(store.nodePath, 'markdown', ['docs/a.md', 'docs/c.md'], store.entries))
		});
		const first = baseHalfPlanRenameUpdate({
			moves: earlier.moves,
			identity: BASEHALF_EXACT_UPSTREAM_IDENTITY,
			exists: () => false,
			stores: [state('n.md', 'markdown', ['docs/a.md', 'archive/c.md'], ['docs/a.md'])]
		});
		assert.deepStrictEqual({
			earlier: earlier.moves,
			snapshot: snapshot.map(store => `${store.nodePath} [${store.entries.join(', ')}]`),
			later: summary(later),
			first: summary(first)
		}, {
			earlier: [{ from: 'docs/a.md', to: 'archive/b.md' }],
			snapshot: ['n.md [docs/c.md]'],
			later: { edits: ['n.md: docs/c.md→archive/c.md'], skipped: [], leftAlone: [] },
			first: { edits: ['n.md: docs/a.md→archive/b.md'], skipped: [], leftAlone: [] }
		});
	});

	test('remaps paths on segment boundaries and reads the setting with a prompt fallback', () => {
		const moves = [{ from: 'docs', to: 'archive/docs' }];
		assert.deepStrictEqual({
			remapped: ['docs', 'docs/a/b.md', 'docs-2/a.md', 'Docs/a.md'].map(path => baseHalfRemapMovedPath(path, moves, BASEHALF_EXACT_UPSTREAM_IDENTITY) ?? null),
			// The most specific move wins, whatever the order.
			specific: ['docs/a/b.md', 'docs/a/c.md', 'docs/x.md'].map(path => baseHalfRemapMovedPath(path, [...moves, { from: 'docs/a', to: 'kept' }], BASEHALF_EXACT_UPSTREAM_IDENTITY)),
			caseInsensitive: baseHalfRemapMovedPath('Docs/a.md', moves, CASE_INSENSITIVE),
			settings: ['prompt', 'always', 'never', 'sometimes', undefined].map(baseHalfUpdateOnFileMove)
		}, {
			remapped: ['archive/docs', 'archive/docs/a/b.md', null, null],
			specific: ['kept/b.md', 'kept/c.md', 'archive/docs/x.md'],
			caseInsensitive: 'archive/docs/a.md',
			settings: ['prompt', 'always', 'never', 'prompt', 'prompt']
		});
	});
});

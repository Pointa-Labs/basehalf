/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { BaseHalfAgentSessionState } from '../../common/basehalfAgentArea.js';
import { baseHalfAgentSessionFolderToKeep, baseHalfAgentSessionIsKept, baseHalfAgentSessionsToStart, baseHalfKeepAgentArrangement, baseHalfReadAgentArrangement, baseHalfRestoreAgentArrangement, baseHalfWriteAgentArrangement, IBaseHalfKeptAgentArrangement, IBaseHalfKeptAgentSession } from '../../common/basehalfAgentArrangement.js';
import { leafRects, orderedLeafIds } from '../../common/basehalfAgentSplitTree.js';
import { BASEHALF_EMPTY_AGENT_TABS_STATE, IBaseHalfAgentTabsState, closeActiveAgentPane, closeAgentTab, createAgentTab, focusAgentPane, markAgentPaneActivity, selectAgentTab, setAgentSplitFraction, setAgentTabTitle, splitActiveAgentPane, toggleAgentPaneZoom, undoAgentClose } from '../../common/basehalfAgentTabsModel.js';

suite('BaseHalfAgentArrangement', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * Three tabs. `shell` has one Terminal session in `sub`. `work`, named by the user, has three panes in two
	 * splits whose dividers were moved, the second pane in front and zoomed. `claude` has Claude Code. `work`
	 * is in front, and `claude` has unseen output.
	 */
	function threeTabs(): IBaseHalfAgentTabsState {
		let state = createAgentTab(BASEHALF_EMPTY_AGENT_TABS_STATE, 'shell', 'p-shell');
		state = createAgentTab(state, 'work', 'p-codex');
		state = splitActiveAgentPane(state, 'right', 'p-term', 's1');
		state = splitActiveAgentPane(state, 'down', 'p-notes', 's2');
		state = setAgentSplitFraction(state, 's1', 0.3);
		state = setAgentSplitFraction(state, 's2', 0.7);
		state = setAgentTabTitle(state, 'work', 'Research');
		state = createAgentTab(state, 'claude', 'p-claude');
		state = focusAgentPane(state, 'work', 'p-term');
		state = toggleAgentPaneZoom(state);
		return markAgentPaneActivity(state, 'p-claude');
	}

	const sessions: Record<string, IBaseHalfKeptAgentSession> = {
		'p-shell': { kind: 'terminal', folder: '/work/notes/sub' },
		'p-codex': { kind: 'tui-codex' },
		'p-term': { kind: 'terminal' },
		'p-notes': { kind: 'terminal', folder: '/work/elsewhere' },
		'p-claude': { kind: 'tui-claude' },
		'p-extension': { kind: 'extension-claude' }
	};
	const every = (paneId: string) => sessions[paneId];
	const without = (...left: string[]) => (paneId: string) => left.includes(paneId) ? undefined : sessions[paneId];

	const kept: IBaseHalfKeptAgentArrangement = {
		version: 1,
		tabs: [
			{ panes: { type: 'pane', kind: 'terminal', folder: '/work/notes/sub' }, front: 0 },
			{
				name: 'Research',
				panes: {
					type: 'split', dir: 'row', fraction: 0.3,
					a: { type: 'pane', kind: 'tui-codex' },
					b: { type: 'split', dir: 'column', fraction: 0.7, a: { type: 'pane', kind: 'terminal' }, b: { type: 'pane', kind: 'terminal', folder: '/work/elsewhere' } }
				},
				front: 1
			},
			{ panes: { type: 'pane', kind: 'tui-claude' }, front: 0 }
		],
		front: 1
	};

	test('keeps the tabs in their order, a tab\'s name, each split with its size, each session, and what is in front', () => {
		assert.deepStrictEqual(baseHalfKeepAgentArrangement(threeTabs(), every), kept);
	});

	test('leaves out what was closed, what ended, and what an extension created, and the nearest tab and pane are in front', () => {
		const state = threeTabs();
		// The pane in front of `work` is closed, and so is the tab `shell`: both can still be brought back.
		const closedPane = closeActiveAgentPane(state, 'c1');
		const closedBoth = closeAgentTab(closedPane, 'shell', 'c2');
		const describe = (arrangement: IBaseHalfKeptAgentArrangement | undefined) => arrangement && {
			tabs: arrangement.tabs.map(tab => ({ name: tab.name, panes: JSON.stringify(tab.panes), front: tab.front })),
			front: arrangement.front
		};
		const codex = { type: 'pane', kind: 'tui-codex' };
		const term = { type: 'pane', kind: 'terminal' };
		const notes = { type: 'pane', kind: 'terminal', folder: '/work/elsewhere' };
		const shell = { name: undefined, panes: JSON.stringify({ type: 'pane', kind: 'terminal', folder: '/work/notes/sub' }), front: 0 };
		const claude = { name: undefined, panes: JSON.stringify({ type: 'pane', kind: 'tui-claude' }), front: 0 };
		assert.deepStrictEqual({
			closed: describe(baseHalfKeepAgentArrangement(closedBoth, every)),
			afterUndo: baseHalfKeepAgentArrangement(undoAgentClose(undoAgentClose(closedBoth, 'c2', () => 'x'), 'c1', () => 's3'), every)?.tabs.length,
			// The pane beside one that ended takes its room, and the pane in front is the nearest that is kept.
			endedInFront: describe(baseHalfKeepAgentArrangement(state, without('p-term'))),
			endedFirst: describe(baseHalfKeepAgentArrangement(state, without('p-codex'))),
			// A tab all of whose sessions ended is left out; it was in front, so the next tab is.
			endedTab: describe(baseHalfKeepAgentArrangement(state, without('p-codex', 'p-term', 'p-notes'))),
			endedLastTabInFront: describe(baseHalfKeepAgentArrangement(selectAgentTab(state, 'claude'), without('p-claude')))?.front,
			nothingLeft: baseHalfKeepAgentArrangement(state, () => undefined),
			noTabs: baseHalfKeepAgentArrangement(BASEHALF_EMPTY_AGENT_TABS_STATE, every)
		}, {
			closed: {
				tabs: [
					{ name: 'Research', panes: JSON.stringify({ type: 'split', dir: 'row', fraction: 0.3, a: codex, b: notes }), front: 0 },
					claude
				],
				front: 0
			},
			afterUndo: 3,
			endedInFront: {
				tabs: [shell, { name: 'Research', panes: JSON.stringify({ type: 'split', dir: 'row', fraction: 0.3, a: codex, b: notes }), front: 1 }, claude],
				front: 1
			},
			endedFirst: {
				tabs: [shell, { name: 'Research', panes: JSON.stringify({ type: 'split', dir: 'column', fraction: 0.7, a: term, b: notes }), front: 0 }, claude],
				front: 1
			},
			endedTab: { tabs: [shell, claude], front: 1 },
			endedLastTabInFront: 1,
			nothingLeft: undefined,
			noTabs: undefined
		});
	});

	test('a session is in the arrangement while it runs, starts, or waits, unless an extension created its terminal', () => {
		const states: BaseHalfAgentSessionState[] = ['waiting', 'starting', 'ready', 'exited', 'unavailable', 'failed', 'disposed'];
		assert.deepStrictEqual({
			own: states.filter(state => baseHalfAgentSessionIsKept(state, false)),
			ofAnExtension: states.filter(state => baseHalfAgentSessionIsKept(state, true)),
			folders: [
				baseHalfAgentSessionFolderToKeep('/work/notes', '/work/notes'),
				baseHalfAgentSessionFolderToKeep('/work/notes/', '/work/notes'),
				baseHalfAgentSessionFolderToKeep('/work/notes/sub', '/work/notes'),
				baseHalfAgentSessionFolderToKeep(undefined, '/work/notes'),
				baseHalfAgentSessionFolderToKeep('/', undefined)
			]
		}, {
			own: ['waiting', 'starting', 'ready'],
			ofAnExtension: [],
			// The workspace folder is kept as none: a session there is in the workspace folder, wherever it is.
			folders: [undefined, undefined, '/work/notes/sub', undefined, '/']
		});
	});

	test('what is kept reads back, and restores the same tabs, panes, sizes, names, and sessions under new ids', () => {
		let next = 0;
		const restored = baseHalfRestoreAgentArrangement(baseHalfReadAgentArrangement(baseHalfWriteAgentArrangement(kept))!, what => `${what}-${++next}`);
		const byId = new Map(restored.sessions.map(session => [session.id, session]));
		const work = restored.state.tabs[1];
		const rects = leafRects(work.tree);
		assert.deepStrictEqual({
			readsBack: baseHalfReadAgentArrangement(baseHalfWriteAgentArrangement(kept)),
			// Kept again, the restored tabs are the arrangement they came from.
			keptAgain: baseHalfKeepAgentArrangement(restored.state, paneId => byId.get(paneId) && { kind: byId.get(paneId)!.kind, folder: byId.get(paneId)!.folder }),
			tabs: restored.state.tabs.map(tab => ({ id: tab.id, name: tab.titleOverride, panes: orderedLeafIds(tab.tree), front: tab.activePaneId, zoomed: tab.zoomedPaneId })),
			front: restored.state.activeTabId,
			sessions: restored.sessions,
			widths: orderedLeafIds(work.tree).map(id => Math.round(rects.get(id)!.w * 100)),
			heights: orderedLeafIds(work.tree).map(id => Math.round(rects.get(id)!.h * 100)),
			unseenOutput: restored.state.activity,
			closed: restored.state.closing
		}, {
			readsBack: kept,
			keptAgain: kept,
			tabs: [
				{ id: 'tab-2', name: undefined, panes: ['agent-1'], front: 'agent-1', zoomed: null },
				{ id: 'tab-8', name: 'Research', panes: ['agent-3', 'agent-4', 'agent-5'], front: 'agent-4', zoomed: null },
				{ id: 'tab-10', name: undefined, panes: ['agent-9'], front: 'agent-9', zoomed: null }
			],
			front: 'tab-8',
			sessions: [
				{ id: 'agent-1', kind: 'terminal', folder: '/work/notes/sub' },
				{ id: 'agent-3', kind: 'tui-codex' },
				{ id: 'agent-4', kind: 'terminal' },
				{ id: 'agent-5', kind: 'terminal', folder: '/work/elsewhere' },
				{ id: 'agent-9', kind: 'tui-claude' }
			],
			widths: [30, 70, 70],
			heights: [100, 70, 30],
			unseenOutput: [],
			closed: []
		});
	});

	test('reads what is not an arrangement as none, and leaves out a session of a kind it does not know', () => {
		const pane = { type: 'pane', kind: 'terminal' };
		const read = (value: unknown) => baseHalfReadAgentArrangement(typeof value === 'string' ? value : JSON.stringify(value));
		assert.deepStrictEqual({
			nothing: baseHalfReadAgentArrangement(undefined),
			empty: read(''),
			notJson: read('{'),
			aList: read([]),
			anotherVersion: read({ version: 2, tabs: [{ panes: pane, front: 0 }], front: 0 }),
			noTabs: read({ version: 1, tabs: [], front: 0 }),
			unknownKind: read({ version: 1, tabs: [{ panes: { type: 'pane', kind: 'future-agent' }, front: 0 }, { panes: { type: 'split', dir: 'row', fraction: 0.4, a: { type: 'pane', kind: 'future-agent' }, b: pane }, front: 1 }], front: 0 }),
			outOfRange: read({ version: 1, tabs: [{ name: '  Build  ', panes: { type: 'split', dir: 'column', fraction: 7, a: pane, b: { type: 'pane', kind: 'tui-codex', folder: 12 } }, front: 9 }, 'tab', { panes: 3 }], front: -4 })
		}, {
			nothing: undefined,
			empty: undefined,
			notJson: undefined,
			aList: undefined,
			anotherVersion: undefined,
			noTabs: undefined,
			unknownKind: { version: 1, tabs: [{ panes: pane, front: 0 }], front: 0 },
			outOfRange: { version: 1, tabs: [{ name: 'Build', panes: { type: 'split', dir: 'column', fraction: 0.9, a: pane, b: { type: 'pane', kind: 'tui-codex' } }, front: 1 }], front: 0 }
		});
	});

	test('a session starts when it is first in view: the panes of the tab in front, once the Agent Area is shown', () => {
		const state = threeTabs();
		const waiting = new Set(['p-shell', 'p-codex', 'p-term', 'p-notes', 'p-claude']);
		const steps: string[][] = [];
		const step = (tabs: IBaseHalfAgentTabsState, shown: boolean) => {
			const start = baseHalfAgentSessionsToStart(tabs, shown, paneId => waiting.has(paneId));
			start.forEach(paneId => waiting.delete(paneId));
			steps.push(start);
		};
		step(state, false);
		step(state, true);
		step(state, true);
		step(selectAgentTab(state, 'claude'), false);
		step(selectAgentTab(state, 'claude'), true);
		step(selectAgentTab(state, 'work'), true);
		step(BASEHALF_EMPTY_AGENT_TABS_STATE, true);
		assert.deepStrictEqual({ steps, neverStarted: [...waiting] }, {
			steps: [[], ['p-codex', 'p-term', 'p-notes'], [], [], ['p-claude'], [], []],
			neverStarted: ['p-shell']
		});
	});
});

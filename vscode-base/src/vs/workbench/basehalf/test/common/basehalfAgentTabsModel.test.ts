/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { orderedLeafIds } from '../../common/basehalfAgentSplitTree.js';
import {
	BASEHALF_EMPTY_AGENT_TABS_STATE,
	IBaseHalfAgentTabsState,
	activeAgentTab,
	closeActiveAgentPane,
	closeAgentTab,
	closeAgentTabsToRight,
	closeOtherAgentTabs,
	closingEntryPaneIds,
	createAgentTab,
	equalizeAgentPanes,
	finalizeAgentClose,
	focusAgentPane,
	gotoAgentPaneDir,
	gotoAgentPaneRing,
	gotoAgentTab,
	lastAgentTab,
	liveAgentPaneIds,
	markAgentPaneActivity,
	mountedAgentPaneIds,
	moveAgentPane,
	removeAgentPane,
	reorderAgentTab,
	resizeActiveAgentPane,
	selectAgentTab,
	setAgentTabTitle,
	splitActiveAgentPane,
	switchAgentTab,
	toggleAgentPaneZoom,
	undoAgentClose
} from '../../common/basehalfAgentTabsModel.js';

suite('BaseHalfAgentTabsModel', () => {
	let seq: number;
	setup(() => { seq = 0; });
	const mint = () => `m${++seq}`;

	/** Three tabs t1..t3, one pane each (p1..p3), t1 active. */
	function threeTabs(): IBaseHalfAgentTabsState {
		let s = createAgentTab(BASEHALF_EMPTY_AGENT_TABS_STATE, 't1', 'p1');
		s = createAgentTab(s, 't2', 'p2');
		s = createAgentTab(s, 't3', 'p3');
		return selectAgentTab(s, 't1');
	}

	test('createAgentTab inserts after the active tab and activates it', () => {
		let s = threeTabs();
		s = createAgentTab(s, 't4', 'p4');
		assert.deepStrictEqual(s.tabs.map(t => t.id), ['t1', 't4', 't2', 't3']);
		assert.strictEqual(s.activeTabId, 't4');
	});

	test('tab selection clears the activity dot and wraps/clamps', () => {
		let s = threeTabs();
		s = markAgentPaneActivity(s, 'p3');
		assert.deepStrictEqual(s.activity, ['t3']);
		// Activity is never set for the active tab.
		assert.strictEqual(markAgentPaneActivity(s, 'p1'), s);

		s = switchAgentTab(s, -1); // wraps t1 → t3, clearing its dot
		assert.strictEqual(s.activeTabId, 't3');
		assert.deepStrictEqual(s.activity, []);

		assert.strictEqual(gotoAgentTab(s, 99).activeTabId, 't3'); // clamped to last
		assert.strictEqual(gotoAgentTab(s, 2).activeTabId, 't2');
		assert.strictEqual(lastAgentTab(threeTabs()).activeTabId, 't3');
		assert.strictEqual(selectAgentTab(s, 'nope'), s);
	});

	test('setAgentTabTitle sets and clears the override', () => {
		let s = threeTabs();
		s = setAgentTabTitle(s, 't2', '  Research  ');
		assert.strictEqual(s.tabs[1].titleOverride, 'Research');
		s = setAgentTabTitle(s, 't2', '   ');
		assert.strictEqual(s.tabs[1].titleOverride, undefined);
	});

	test('reorderAgentTab moves a tab to the target strip index', () => {
		const s = reorderAgentTab(threeTabs(), 't1', 3);
		assert.deepStrictEqual(s.tabs.map(t => t.id), ['t2', 't3', 't1']);
		assert.strictEqual(s.activeTabId, 't1');
	});

	test('split, directional focus, ring focus, and move operate on the active tab', () => {
		let s = threeTabs();
		s = splitActiveAgentPane(s, 'right', 'p1b', 's1');
		s = splitActiveAgentPane(s, 'down', 'p1c', 's2');
		const tab = activeAgentTab(s)!;
		assert.deepStrictEqual(orderedLeafIds(tab.tree), ['p1', 'p1b', 'p1c']);
		assert.strictEqual(tab.activePaneId, 'p1c');

		s = gotoAgentPaneDir(s, 'up');
		assert.strictEqual(activeAgentTab(s)!.activePaneId, 'p1b');
		s = gotoAgentPaneRing(s, -1);
		assert.strictEqual(activeAgentTab(s)!.activePaneId, 'p1');

		s = moveAgentPane(s, 'p1', 'down', 'p1c', 's3');
		assert.deepStrictEqual(orderedLeafIds(activeAgentTab(s)!.tree), ['p1b', 'p1c', 'p1']);

		s = focusAgentPane(s, 't1', 'p1b');
		assert.strictEqual(activeAgentTab(s)!.activePaneId, 'p1b');
		assert.strictEqual(focusAgentPane(s, 't1', 'ghost'), s);
	});

	test('resize steps the surrounding split fraction and unzooms', () => {
		let s = splitActiveAgentPane(threeTabs(), 'right', 'p1b', 's1');
		s = toggleAgentPaneZoom(s);
		assert.strictEqual(activeAgentTab(s)!.zoomedPaneId, 'p1b');
		s = resizeActiveAgentPane(s, 'right');
		const tab = activeAgentTab(s)!;
		assert.strictEqual(tab.zoomedPaneId, null);
		assert.ok(tab.tree.type === 'split' && Math.abs(tab.tree.fraction - 0.54) < 1e-9);
		// Equalize resets to even fractions.
		const even = equalizeAgentPanes(s);
		assert.ok(activeAgentTab(even)!.tree.type === 'split' && (activeAgentTab(even)!.tree as { fraction: number }).fraction === 0.5);
	});

	test('closing a pane is soft and closing the last pane soft-closes the tab', () => {
		let s = splitActiveAgentPane(threeTabs(), 'right', 'p1b', 's1');
		s = closeActiveAgentPane(s, 'k1'); // closes p1b, focus back to p1
		let tab = activeAgentTab(s)!;
		assert.deepStrictEqual(orderedLeafIds(tab.tree), ['p1']);
		assert.strictEqual(tab.activePaneId, 'p1');
		assert.deepStrictEqual(s.closing.map(c => c.kind), ['pane']);

		s = closeActiveAgentPane(s, 'k2'); // last pane → tab soft-close
		assert.deepStrictEqual(s.tabs.map(t => t.id), ['t2', 't3']);
		assert.strictEqual(s.activeTabId, 't2');
		assert.deepStrictEqual(s.closing.map(c => c.kind), ['pane', 'tab']);

		// Sessions of both entries stay mounted until finalize.
		assert.deepStrictEqual(mountedAgentPaneIds(s).sort(), ['p1', 'p1b', 'p2', 'p3']);
		assert.deepStrictEqual(liveAgentPaneIds(s).sort(), ['p2', 'p3']);

		tab = activeAgentTab(s)!;
		const { state: finalized, entry } = finalizeAgentClose(s, 'k2');
		assert.deepStrictEqual(entry && closingEntryPaneIds(entry), ['p1']);
		assert.deepStrictEqual(finalized.closing.map(c => c.key), ['k1']);
	});

	test('closing every tab reaches the empty state', () => {
		let s = threeTabs();
		s = closeAgentTab(s, 't1', 'k1');
		s = closeAgentTab(s, 't2', 'k2');
		s = closeAgentTab(s, 't3', 'k3');
		assert.deepStrictEqual({ tabs: s.tabs, active: s.activeTabId }, { tabs: [], active: null });
	});

	test('close others / close to the right soft-close whole tabs', () => {
		const others = closeOtherAgentTabs(threeTabs(), 't2', mint);
		assert.deepStrictEqual(others.tabs.map(t => t.id), ['t2']);
		assert.strictEqual(others.activeTabId, 't2');
		assert.deepStrictEqual(others.closing.map(c => c.kind), ['tab', 'tab']);

		const right = closeAgentTabsToRight(threeTabs(), 't2', mint);
		assert.deepStrictEqual(right.tabs.map(t => t.id), ['t1', 't2']);
		assert.strictEqual(right.activeTabId, 't1');
	});

	test('undo restores a tab at its index and a pane on its original side', () => {
		let s = splitActiveAgentPane(threeTabs(), 'right', 'p1b', 's1');
		s = closeActiveAgentPane(s, 'k1', 'p1'); // p1 was side a → restores as left
		s = undoAgentClose(s, 'k1', mint);
		assert.deepStrictEqual(orderedLeafIds(activeAgentTab(s)!.tree), ['p1', 'p1b']);
		assert.strictEqual(activeAgentTab(s)!.activePaneId, 'p1');
		assert.deepStrictEqual(s.closing, []);

		let t = closeAgentTab(threeTabs(), 't2', 'k2');
		t = undoAgentClose(t, 'k2', mint);
		assert.deepStrictEqual(t.tabs.map(tab => tab.id), ['t1', 't2', 't3']);
		assert.strictEqual(t.activeTabId, 't2');
	});

	test('undoing a pane whose tab is gone restores it as a fresh tab', () => {
		let s = splitActiveAgentPane(threeTabs(), 'right', 'p1b', 's1');
		s = closeActiveAgentPane(s, 'k1', 'p1b');
		s = closeAgentTab(s, 't1', 'k2');
		s = undoAgentClose(s, 'k1', mint);
		const restored = s.tabs[s.tabs.length - 1];
		assert.deepStrictEqual(orderedLeafIds(restored.tree), ['p1b']);
		assert.strictEqual(s.activeTabId, restored.id);
	});

	test('removeAgentPane hard-purges dead sessions from live tabs and closing snapshots', () => {
		let s = splitActiveAgentPane(threeTabs(), 'right', 'p1b', 's1');
		s = closeActiveAgentPane(s, 'k1', 'p1b'); // p1b soft-closed
		s = removeAgentPane(s, 'p1b'); // its session dies during grace
		assert.deepStrictEqual(s.closing, []);

		s = removeAgentPane(s, 'p1'); // sole live pane → tab removed, no soft entry
		assert.deepStrictEqual(s.tabs.map(t => t.id), ['t2', 't3']);
		assert.strictEqual(s.activeTabId, 't2');
		assert.deepStrictEqual(s.closing, []);

		// A dead pane inside a soft-closed TAB shrinks the snapshot; the last one
		// drops the entry entirely.
		let t = closeAgentTab(threeTabs(), 't2', 'k9');
		t = removeAgentPane(t, 'p2');
		assert.deepStrictEqual(t.closing, []);
	});
});

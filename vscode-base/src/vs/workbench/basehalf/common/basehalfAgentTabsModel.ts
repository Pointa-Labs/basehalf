/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BaseHalfFocusDir,
	BaseHalfPaneNode,
	BaseHalfSplitDir,
	closeLeaf,
	directionalNeighbor,
	equalize,
	findLeaf,
	findSplit,
	firstLeaf,
	insertBeside,
	orderedLeafIds,
	paneLeaf,
	resizeTarget,
	ringNeighbor,
	setFraction,
	splitBounds,
	splitLeaf
} from './basehalfAgentSplitTree.js';

// Agent Area tab layout, ported from the original BaseHalf terminal dock and
// generalized: the area is a list of TABS shown in one strip (always visible,
// for discoverability in an embedded panel). Each tab owns its OWN pane
// split-tree whose leaves are PANES — one Agent Area SESSION each (TUI agent,
// extension agent, or shell). Splitting divides a pane within the current tab,
// never the tabs. Tabs are the top-level container; splits live inside a tab.
//
// Every transition here is PURE: ids/keys are passed in (the service owns id
// minting), and a no-op returns the SAME state object so callers can cheaply
// detect "nothing changed".
//
// Deliberate deviations from the old dock:
// - Zero tabs is a valid state (the Agent Area has an explicit empty state
//   with the session choices); the old dock always kept ≥1 shell tab alive.
// - A pane is any Agent Area session kind, not just a pty.

/** One tab: a name override plus its own pane split-tree (one session per leaf). */
export interface IBaseHalfAgentTab {
	readonly id: string;
	/** Split tree of panes; every leaf id is a pane(=session) id. */
	readonly tree: BaseHalfPaneNode;
	/** The focused pane within this tab. */
	readonly activePaneId: string;
	/** When set, this pane fills the tab area (zoom); the tree is preserved. */
	readonly zoomedPaneId: string | null;
	/**
	 * A user-set tab name (double-click / context-menu rename). When set it
	 * overrides the live session title; empty/undefined → live title.
	 */
	readonly titleOverride?: string;
}

/**
 * A soft-closed tab — the whole tab, kept MOUNTED (hidden) so its sessions
 * keep running and can be restored intact until a grace timer (or dismiss).
 */
export interface IBaseHalfClosingTab {
	readonly key: string;
	readonly kind: 'tab';
	readonly tab: IBaseHalfAgentTab;
	readonly index: number;
}

/**
 * A soft-closed pane inside a surviving tab — kept MOUNTED (hidden) so its
 * session keeps running. `treeSnapshot` is the tab's tree BEFORE the close, so
 * undo can restore the pane on its original side.
 */
export interface IBaseHalfClosingPane {
	readonly key: string;
	readonly kind: 'pane';
	readonly tabId: string;
	readonly paneId: string;
	readonly treeSnapshot: BaseHalfPaneNode;
}

export type BaseHalfClosingEntry = IBaseHalfClosingTab | IBaseHalfClosingPane;

export interface IBaseHalfAgentTabsState {
	/** Ordered tabs shown in the strip. */
	readonly tabs: readonly IBaseHalfAgentTab[];
	readonly activeTabId: string | null;
	/** Tab ids with unseen output — drives the tab activity dot. */
	readonly activity: readonly string[];
	/** Soft-closed tabs/panes awaiting finalize (stay mounted + running). */
	readonly closing: readonly BaseHalfClosingEntry[];
}

export const BASEHALF_EMPTY_AGENT_TABS_STATE: IBaseHalfAgentTabsState = {
	tabs: [],
	activeTabId: null,
	activity: [],
	closing: []
};

/**
 * Fraction of the WHOLE tab area a divider moves per keyboard-resize press,
 * scaled by the split's own size so nested and root splits move by the same
 * visual amount.
 */
export const BASEHALF_AGENT_PANE_RESIZE_STEP = 0.04;

export function activeAgentTab(state: IBaseHalfAgentTabsState): IBaseHalfAgentTab | undefined {
	return state.tabs.find(tab => tab.id === state.activeTabId);
}

export function agentTabForPane(state: IBaseHalfAgentTabsState, paneId: string): IBaseHalfAgentTab | undefined {
	return state.tabs.find(tab => findLeaf(tab.tree, paneId));
}

/** Every live pane id, tab strip order (excludes soft-closed panes). */
export function liveAgentPaneIds(state: IBaseHalfAgentTabsState): string[] {
	return state.tabs.flatMap(tab => orderedLeafIds(tab.tree));
}

/** Every pane id that must stay MOUNTED: live panes plus soft-closed ones. */
export function mountedAgentPaneIds(state: IBaseHalfAgentTabsState): string[] {
	const out = liveAgentPaneIds(state);
	for (const entry of state.closing) {
		if (entry.kind === 'tab') {
			out.push(...orderedLeafIds(entry.tab.tree));
		} else {
			out.push(entry.paneId);
		}
	}
	return out;
}

function replaceTab(tabs: readonly IBaseHalfAgentTab[], tabId: string, next: IBaseHalfAgentTab): readonly IBaseHalfAgentTab[] {
	return tabs.map(tab => (tab.id === tabId ? next : tab));
}

/** Apply a pure transform to the active tab; no-op if there is none. */
function updateActiveTab(state: IBaseHalfAgentTabsState, fn: (tab: IBaseHalfAgentTab) => IBaseHalfAgentTab): IBaseHalfAgentTabsState {
	const tab = activeAgentTab(state);
	if (!tab) {
		return state;
	}
	const next = fn(tab);
	if (next === tab) {
		return state;
	}
	return { ...state, tabs: replaceTab(state.tabs, tab.id, next) };
}

/**
 * Drop a tab's activity flag (it became active → its output is now seen).
 * Returns the SAME array when nothing changes.
 */
function clearActivity(activity: readonly string[], tabId: string): readonly string[] {
	if (!activity.includes(tabId)) {
		return activity;
	}
	return activity.filter(id => id !== tabId);
}

function activateTab(state: IBaseHalfAgentTabsState, tabId: string): IBaseHalfAgentTabsState {
	if (state.activeTabId === tabId && !state.activity.includes(tabId)) {
		return state;
	}
	return { ...state, activeTabId: tabId, activity: clearActivity(state.activity, tabId) };
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

/** New tab (one fresh pane), inserted after the active tab + focused. */
export function createAgentTab(state: IBaseHalfAgentTabsState, tabId: string, paneId: string): IBaseHalfAgentTabsState {
	const tab: IBaseHalfAgentTab = { id: tabId, tree: paneLeaf(paneId), activePaneId: paneId, zoomedPaneId: null };
	const at = state.tabs.findIndex(t => t.id === state.activeTabId);
	const tabs = [...state.tabs];
	tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
	return { ...state, tabs, activeTabId: tab.id };
}

export function selectAgentTab(state: IBaseHalfAgentTabsState, tabId: string): IBaseHalfAgentTabsState {
	if (!state.tabs.some(tab => tab.id === tabId)) {
		return state;
	}
	return activateTab(state, tabId);
}

/** Previous / next tab, wrapping. */
export function switchAgentTab(state: IBaseHalfAgentTabsState, delta: 1 | -1): IBaseHalfAgentTabsState {
	if (state.tabs.length <= 1) {
		return state;
	}
	const i = state.tabs.findIndex(tab => tab.id === state.activeTabId);
	const next = state.tabs[(i + delta + state.tabs.length) % state.tabs.length];
	if (!next) {
		return state;
	}
	return activateTab(state, next.id);
}

/** Select tab by 1-based index, clamped to the last. */
export function gotoAgentTab(state: IBaseHalfAgentTabsState, index: number): IBaseHalfAgentTabsState {
	if (!state.tabs.length) {
		return state;
	}
	const i = Math.min(Math.max(1, Math.floor(index)), state.tabs.length) - 1;
	const next = state.tabs[i];
	if (!next) {
		return state;
	}
	return activateTab(state, next.id);
}

/** Select the last tab. */
export function lastAgentTab(state: IBaseHalfAgentTabsState): IBaseHalfAgentTabsState {
	const next = state.tabs[state.tabs.length - 1];
	if (!next) {
		return state;
	}
	return activateTab(state, next.id);
}

export function setAgentTabTitle(state: IBaseHalfAgentTabsState, tabId: string, title: string): IBaseHalfAgentTabsState {
	if (!state.tabs.some(tab => tab.id === tabId)) {
		return state;
	}
	const override = title.trim();
	return {
		...state,
		tabs: state.tabs.map(tab => (tab.id === tabId ? { ...tab, titleOverride: override || undefined } : tab))
	};
}

export function reorderAgentTab(state: IBaseHalfAgentTabsState, tabId: string, toIndex: number): IBaseHalfAgentTabsState {
	const from = state.tabs.findIndex(tab => tab.id === tabId);
	if (from < 0) {
		return state;
	}
	const tabs = [...state.tabs];
	const [moved] = tabs.splice(from, 1);
	if (!moved) {
		return state;
	}
	const adjusted = from < toIndex ? toIndex - 1 : toIndex;
	tabs.splice(Math.min(Math.max(0, adjusted), tabs.length), 0, moved);
	return { ...state, tabs };
}

// ── Panes within the active tab ──────────────────────────────────────────────

/** Split the active pane; the new pane takes focus. */
export function splitActiveAgentPane(state: IBaseHalfAgentTabsState, dir: BaseHalfSplitDir, newPaneId: string, splitId: string): IBaseHalfAgentTabsState {
	return updateActiveTab(state, tab => ({
		...tab,
		tree: splitLeaf(tab.tree, tab.activePaneId, dir, newPaneId, splitId),
		activePaneId: newPaneId,
		zoomedPaneId: null
	}));
}

export function focusAgentPane(state: IBaseHalfAgentTabsState, tabId: string, paneId: string): IBaseHalfAgentTabsState {
	const tab = state.tabs.find(t => t.id === tabId);
	if (!tab || !findLeaf(tab.tree, paneId)) {
		return state;
	}
	if (state.activeTabId === tabId && tab.activePaneId === paneId && !state.activity.includes(tabId)) {
		return state;
	}
	return {
		...state,
		activeTabId: tabId,
		tabs: state.tabs.map(t => (t.id === tabId ? { ...t, activePaneId: paneId } : t)),
		activity: clearActivity(state.activity, tabId)
	};
}

/** Move pane focus spatially within the active tab. */
export function gotoAgentPaneDir(state: IBaseHalfAgentTabsState, dir: BaseHalfFocusDir): IBaseHalfAgentTabsState {
	return updateActiveTab(state, tab => {
		const next = directionalNeighbor(tab.tree, tab.activePaneId, dir);
		return next ? { ...tab, activePaneId: next, zoomedPaneId: null } : tab;
	});
}

/** Cycle pane focus in tree order within the active tab. */
export function gotoAgentPaneRing(state: IBaseHalfAgentTabsState, delta: 1 | -1): IBaseHalfAgentTabsState {
	return updateActiveTab(state, tab => {
		const next = ringNeighbor(tab.tree, tab.activePaneId, delta);
		if (next === tab.activePaneId && tab.zoomedPaneId === null) {
			return tab;
		}
		return { ...tab, activePaneId: next, zoomedPaneId: null };
	});
}

/**
 * Drag-rearrange: move `paneId` to sit beside `destPaneId` on `side` (both in
 * the active tab); the dragged pane keeps its session (same id → no remount).
 */
export function moveAgentPane(state: IBaseHalfAgentTabsState, paneId: string, side: BaseHalfFocusDir, destPaneId: string, splitId: string): IBaseHalfAgentTabsState {
	if (paneId === destPaneId) {
		return state;
	}
	const tab = activeAgentTab(state);
	if (!tab || !findLeaf(tab.tree, paneId) || !findLeaf(tab.tree, destPaneId)) {
		return state;
	}
	// Pull the pane out (its sibling collapses up), then re-insert it beside the
	// target on `side`. The leaf keeps its id, so the session never remounts.
	const { root } = closeLeaf(tab.tree, paneId);
	if (!root) {
		return state; // it was the only pane
	}
	const tree = insertBeside(root, destPaneId, side, paneId, splitId);
	return {
		...state,
		tabs: replaceTab(state.tabs, tab.id, { ...tab, tree, activePaneId: paneId, zoomedPaneId: null })
	};
}

/** Resize the split around the active pane by one keyboard step. */
export function resizeActiveAgentPane(state: IBaseHalfAgentTabsState, dir: BaseHalfFocusDir): IBaseHalfAgentTabsState {
	const tab = activeAgentTab(state);
	if (!tab) {
		return state;
	}
	const target = resizeTarget(tab.tree, tab.activePaneId, dir);
	if (!target) {
		return state;
	}
	const split = findSplit(tab.tree, target.splitId);
	if (!split) {
		return state;
	}
	const bounds = splitBounds(tab.tree, target.splitId);
	const axis = Math.max(0.05, split.dir === 'row' ? (bounds?.w ?? 1) : (bounds?.h ?? 1));
	const delta = ((dir === 'right' || dir === 'down' ? 1 : -1) * BASEHALF_AGENT_PANE_RESIZE_STEP) / axis;
	return {
		...state,
		tabs: replaceTab(state.tabs, tab.id, {
			...tab,
			tree: setFraction(tab.tree, target.splitId, split.fraction + delta),
			zoomedPaneId: null
		})
	};
}

/** Even out all splits in the active tab. */
export function equalizeAgentPanes(state: IBaseHalfAgentTabsState): IBaseHalfAgentTabsState {
	const tab = activeAgentTab(state);
	if (!tab || tab.tree.type === 'leaf') {
		return state;
	}
	// Rebalancing reveals the whole layout, so unzoom (matches resize).
	return {
		...state,
		tabs: replaceTab(state.tabs, tab.id, { ...tab, tree: equalize(tab.tree), zoomedPaneId: null })
	};
}

/** Zoom/unzoom the active pane within its tab. */
export function toggleAgentPaneZoom(state: IBaseHalfAgentTabsState): IBaseHalfAgentTabsState {
	return updateActiveTab(state, tab =>
		tab.tree.type === 'leaf'
			? tab.zoomedPaneId === null ? tab : { ...tab, zoomedPaneId: null }
			: { ...tab, zoomedPaneId: tab.zoomedPaneId ? null : tab.activePaneId }
	);
}

export function setAgentSplitFraction(state: IBaseHalfAgentTabsState, splitId: string, fraction: number): IBaseHalfAgentTabsState {
	const tab = activeAgentTab(state);
	if (!tab) {
		return state;
	}
	return {
		...state,
		tabs: replaceTab(state.tabs, tab.id, { ...tab, tree: setFraction(tab.tree, splitId, fraction) })
	};
}

// ── Closing (soft) ───────────────────────────────────────────────────────────

/** Soft-close a whole tab. Zero remaining tabs is a valid outcome. */
export function closeAgentTab(state: IBaseHalfAgentTabsState, tabId: string, closeKey: string): IBaseHalfAgentTabsState {
	const index = state.tabs.findIndex(tab => tab.id === tabId);
	const tab = state.tabs[index];
	if (!tab) {
		return state;
	}
	const entry: IBaseHalfClosingTab = { key: closeKey, kind: 'tab', tab, index };
	const closing = [...state.closing, entry];
	const activity = clearActivity(state.activity, tabId);
	const remaining = state.tabs.filter(t => t.id !== tabId);
	if (remaining.length === 0) {
		return { tabs: remaining, activeTabId: null, activity, closing };
	}
	const activeTabId =
		state.activeTabId === tabId
			? (remaining[Math.min(index, remaining.length - 1)]?.id ?? state.activeTabId)
			: state.activeTabId;
	return { tabs: remaining, activeTabId, activity, closing };
}

/** Close one pane in the active tab; the last pane closing closes the tab. */
export function closeActiveAgentPane(state: IBaseHalfAgentTabsState, closeKey: string, paneId?: string): IBaseHalfAgentTabsState {
	const tab = activeAgentTab(state);
	if (!tab) {
		return state;
	}
	const pid = paneId ?? tab.activePaneId;
	if (!findLeaf(tab.tree, pid)) {
		return state;
	}
	// Last pane → closing it closes the whole tab (soft).
	if (orderedLeafIds(tab.tree).length <= 1) {
		return closeAgentTab(state, tab.id, closeKey);
	}

	const entry: IBaseHalfClosingPane = { key: closeKey, kind: 'pane', tabId: tab.id, paneId: pid, treeSnapshot: tab.tree };
	const { root, focusId } = closeLeaf(tab.tree, pid);
	const tree = root ?? tab.tree;
	const activePaneId = tab.activePaneId === pid ? (focusId ?? firstLeaf(tree).id) : tab.activePaneId;
	return {
		...state,
		tabs: replaceTab(state.tabs, tab.id, {
			...tab,
			tree,
			activePaneId,
			zoomedPaneId: tab.zoomedPaneId === pid ? null : tab.zoomedPaneId
		}),
		closing: [...state.closing, entry]
	};
}

export function closeOtherAgentTabs(state: IBaseHalfAgentTabsState, tabId: string, mintKey: () => string): IBaseHalfAgentTabsState {
	const keep = state.tabs.find(tab => tab.id === tabId);
	if (!keep || state.tabs.length <= 1) {
		return state;
	}
	const removed = state.tabs
		.map((tab, index) => ({ tab, index }))
		.filter(({ tab }) => tab.id !== tabId);
	return {
		tabs: [keep],
		activeTabId: tabId,
		activity: removed.reduce((activity, { tab }) => clearActivity(activity, tab.id), state.activity),
		closing: [
			...state.closing,
			...removed.map(({ tab, index }): IBaseHalfClosingTab => ({ key: mintKey(), kind: 'tab', tab, index }))
		]
	};
}

export function closeAgentTabsToRight(state: IBaseHalfAgentTabsState, tabId: string, mintKey: () => string): IBaseHalfAgentTabsState {
	const idx = state.tabs.findIndex(tab => tab.id === tabId);
	if (idx < 0 || idx >= state.tabs.length - 1) {
		return state;
	}
	const kept = state.tabs.slice(0, idx + 1);
	const removed = state.tabs.slice(idx + 1).map((tab, k) => ({ tab, index: idx + 1 + k }));
	const activeTabId = kept.some(tab => tab.id === state.activeTabId) ? state.activeTabId : tabId;
	return {
		tabs: kept,
		activeTabId,
		activity: removed.reduce((activity, { tab }) => clearActivity(activity, tab.id), state.activity),
		closing: [
			...state.closing,
			...removed.map(({ tab, index }): IBaseHalfClosingTab => ({ key: mintKey(), kind: 'tab', tab, index }))
		]
	};
}

/** The parent split of a leaf and which side it's on (for restoring position). */
function locateLeaf(root: BaseHalfPaneNode, leafId: string): { split: Extract<BaseHalfPaneNode, { type: 'split' }>; side: 'a' | 'b' } | null {
	if (root.type === 'leaf') {
		return null;
	}
	if (root.a.type === 'leaf' && root.a.id === leafId) {
		return { split: root, side: 'a' };
	}
	if (root.b.type === 'leaf' && root.b.id === leafId) {
		return { split: root, side: 'b' };
	}
	return locateLeaf(root.a, leafId) ?? locateLeaf(root.b, leafId);
}

/**
 * Re-insert a soft-closed pane's leaf into the tab's CURRENT tree, restoring
 * its old spot when a former sibling still exists (else beside the first
 * pane). Never replaces the whole tree, so panes split during the undo grace
 * survive.
 */
function reinsertPaneLeaf(current: BaseHalfPaneNode, snapshot: BaseHalfPaneNode, paneId: string, splitId: string): BaseHalfPaneNode {
	const loc = locateLeaf(snapshot, paneId);
	if (loc) {
		const wasA = loc.side === 'a';
		const side: BaseHalfFocusDir = loc.split.dir === 'row' ? (wasA ? 'left' : 'right') : wasA ? 'up' : 'down';
		const sibling = wasA ? loc.split.b : loc.split.a;
		const anchor = orderedLeafIds(sibling).find(id => findLeaf(current, id));
		if (anchor) {
			return insertBeside(current, anchor, side, paneId, splitId);
		}
	}
	// Snapshot had it as the whole tree, or no former sibling survives → append.
	return insertBeside(current, firstLeaf(current).id, 'right', paneId, splitId);
}

export function undoAgentClose(state: IBaseHalfAgentTabsState, key: string, mintId: () => string): IBaseHalfAgentTabsState {
	const entry = state.closing.find(c => c.key === key);
	if (!entry) {
		return state;
	}
	const closing = state.closing.filter(c => c.key !== key);

	if (entry.kind === 'tab') {
		const tabs = [...state.tabs];
		tabs.splice(Math.min(Math.max(0, entry.index), tabs.length), 0, entry.tab);
		return { ...state, tabs, activeTabId: entry.tab.id, closing };
	}

	// Pane: restore into its tab if it still exists, else as a fresh tab.
	const tab = state.tabs.find(t => t.id === entry.tabId);
	if (tab) {
		return {
			...state,
			tabs: replaceTab(state.tabs, tab.id, {
				...tab,
				tree: reinsertPaneLeaf(tab.tree, entry.treeSnapshot, entry.paneId, mintId()),
				activePaneId: entry.paneId,
				zoomedPaneId: null
			}),
			activeTabId: tab.id,
			closing
		};
	}
	const restored: IBaseHalfAgentTab = { id: mintId(), tree: paneLeaf(entry.paneId), activePaneId: entry.paneId, zoomedPaneId: null };
	return { ...state, tabs: [...state.tabs, restored], activeTabId: restored.id, closing };
}

/**
 * Drop a closing entry (grace expired or dismissed). Returns the entry so the
 * caller can dispose its sessions.
 */
export function finalizeAgentClose(state: IBaseHalfAgentTabsState, key: string): { state: IBaseHalfAgentTabsState; entry: BaseHalfClosingEntry | undefined } {
	const entry = state.closing.find(c => c.key === key);
	if (!entry) {
		return { state, entry: undefined };
	}
	return { state: { ...state, closing: state.closing.filter(c => c.key !== key) }, entry };
}

/** The pane ids a finalized closing entry owned — the sessions to dispose. */
export function closingEntryPaneIds(entry: BaseHalfClosingEntry): string[] {
	return entry.kind === 'tab' ? orderedLeafIds(entry.tab.tree) : [entry.paneId];
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

/** Mark a pane's tab as having unseen output (no-op for the active tab). */
export function markAgentPaneActivity(state: IBaseHalfAgentTabsState, paneId: string): IBaseHalfAgentTabsState {
	const owner = agentTabForPane(state, paneId);
	if (!owner) {
		return state; // a closing pane, or unknown → ignore
	}
	if (owner.id === state.activeTabId || state.activity.includes(owner.id)) {
		return state;
	}
	return { ...state, activity: [...state.activity, owner.id] };
}

/**
 * Hard-remove a pane whose session died (process exited and was disposed):
 * collapse it out of its live tab (removing the tab when it empties, with no
 * soft-close), and purge it from soft-closed snapshots so undo never restores
 * a dead session.
 */
export function removeAgentPane(state: IBaseHalfAgentTabsState, paneId: string): IBaseHalfAgentTabsState {
	let next = state;

	const owner = agentTabForPane(next, paneId);
	if (owner) {
		const { root, focusId } = closeLeaf(owner.tree, paneId);
		if (!root) {
			const index = next.tabs.findIndex(tab => tab.id === owner.id);
			const remaining = next.tabs.filter(tab => tab.id !== owner.id);
			const activeTabId =
				next.activeTabId === owner.id
					? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
					: next.activeTabId;
			next = { ...next, tabs: remaining, activeTabId, activity: clearActivity(next.activity, owner.id) };
		} else {
			next = {
				...next,
				tabs: replaceTab(next.tabs, owner.id, {
					...owner,
					tree: root,
					activePaneId: owner.activePaneId === paneId ? (focusId ?? firstLeaf(root).id) : owner.activePaneId,
					zoomedPaneId: owner.zoomedPaneId === paneId ? null : owner.zoomedPaneId
				})
			};
		}
	}

	// Purge from soft-closed entries: a pane entry for this pane vanishes; a tab
	// entry loses the leaf (and vanishes when it was the last one).
	if (next.closing.some(entry => closingEntryPaneIds(entry).includes(paneId))) {
		const closing: BaseHalfClosingEntry[] = [];
		for (const entry of next.closing) {
			if (entry.kind === 'pane') {
				if (entry.paneId !== paneId) {
					closing.push(entry);
				}
				continue;
			}
			if (!findLeaf(entry.tab.tree, paneId)) {
				closing.push(entry);
				continue;
			}
			const { root } = closeLeaf(entry.tab.tree, paneId);
			if (root) {
				closing.push({
					...entry,
					tab: {
						...entry.tab,
						tree: root,
						activePaneId: entry.tab.activePaneId === paneId ? firstLeaf(root).id : entry.tab.activePaneId,
						zoomedPaneId: entry.tab.zoomedPaneId === paneId ? null : entry.tab.zoomedPaneId
					}
				});
			}
		}
		next = { ...next, closing };
	}

	return next;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_AGENT_SESSION_CHOICES, BaseHalfAgentSessionKind, BaseHalfAgentSessionState } from './basehalfAgentArea.js';
import { BaseHalfPaneNode, orderedLeafIds, paneLeaf } from './basehalfAgentSplitTree.js';
import { BASEHALF_EMPTY_AGENT_TABS_STATE, IBaseHalfAgentTab, IBaseHalfAgentTabsState, activeAgentTab } from './basehalfAgentTabsModel.js';

// The arrangement of the Agent Area that a folder opens with (docs/specs/agent-area-terminal.md, The sessions a
// folder opens with): what of the tabs and their panes is kept, how it reads back, what is restored from it, and
// when a restored session starts. All of it is plain data: ids are passed in, and nothing here touches a window.

/** The version of what is kept. BaseHalf reads no other. */
export const BASEHALF_AGENT_ARRANGEMENT_VERSION = 1;

/** A session as the arrangement keeps it: its kind, and the folder a terminal session is in. */
export interface IBaseHalfKeptAgentSession {
	readonly kind: BaseHalfAgentSessionKind;
	/** The folder a terminal session is in; none is the workspace folder. */
	readonly folder?: string;
}

export interface IBaseHalfKeptAgentPane extends IBaseHalfKeptAgentSession {
	readonly type: 'pane';
}

export interface IBaseHalfKeptAgentSplit {
	readonly type: 'split';
	readonly dir: 'row' | 'column';
	/** The share of the split that `a` has. */
	readonly fraction: number;
	readonly a: BaseHalfKeptAgentNode;
	readonly b: BaseHalfKeptAgentNode;
}

export type BaseHalfKeptAgentNode = IBaseHalfKeptAgentPane | IBaseHalfKeptAgentSplit;

export interface IBaseHalfKeptAgentTab {
	/** The name the user gave the tab. */
	readonly name?: string;
	readonly panes: BaseHalfKeptAgentNode;
	/** The pane in front, counted from 0 in the order of the panes. */
	readonly front: number;
}

export interface IBaseHalfKeptAgentArrangement {
	readonly version: typeof BASEHALF_AGENT_ARRANGEMENT_VERSION;
	readonly tabs: readonly IBaseHalfKeptAgentTab[];
	/** The tab in front, counted from 0. */
	readonly front: number;
}

/**
 * Whether a session is in the arrangement: one that runs, starts, or waits to start. A session whose program
 * ended or could not start is not, and neither is a terminal that an extension created.
 */
export function baseHalfAgentSessionIsKept(state: BaseHalfAgentSessionState, createdByExtension: boolean): boolean {
	return !createdByExtension && (state === 'waiting' || state === 'starting' || state === 'ready');
}

/** The folder to keep for a session: none when it is the workspace folder, which is kept as being there. */
export function baseHalfAgentSessionFolderToKeep(folder: string | undefined, workspaceFolder: string | undefined): string | undefined {
	const trimmed = (path: string) => path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
	if (!folder || (workspaceFolder !== undefined && trimmed(folder) === trimmed(workspaceFolder))) {
		return undefined;
	}
	return folder;
}

interface IKeptNode {
	readonly node: BaseHalfKeptAgentNode;
	/** The ids of the panes that are kept, in their order. */
	readonly paneIds: readonly string[];
}

function keepNode(node: BaseHalfPaneNode, session: (paneId: string) => IBaseHalfKeptAgentSession | undefined): IKeptNode | undefined {
	if (node.type === 'leaf') {
		const kept = session(node.id);
		if (!kept) {
			return undefined;
		}
		return { node: { type: 'pane', kind: kept.kind, ...(kept.folder ? { folder: kept.folder } : {}) }, paneIds: [node.id] };
	}
	const a = keepNode(node.a, session);
	const b = keepNode(node.b, session);
	if (!a || !b) {
		// The pane beside one that is left out takes its room.
		return a ?? b;
	}
	return { node: { type: 'split', dir: node.dir, fraction: node.fraction, a: a.node, b: b.node }, paneIds: [...a.paneIds, ...b.paneIds] };
}

/** The place of the nearest kept entry: the one at `index`, or the first kept one after it, or the last before. */
function nearestKept(kept: readonly boolean[], index: number): number {
	const before = kept.slice(0, Math.max(0, index)).filter(Boolean).length;
	const total = kept.filter(Boolean).length;
	return Math.max(0, Math.min(before, total - 1));
}

/**
 * What is kept of the tabs. `session` says what to keep of a pane's session, and nothing for one that is not in
 * the arrangement. Tabs and panes that were closed and wait for Undo are not among `state.tabs`, so they are
 * left out. Returns nothing when no tab is kept.
 */
export function baseHalfKeepAgentArrangement(state: IBaseHalfAgentTabsState, session: (paneId: string) => IBaseHalfKeptAgentSession | undefined): IBaseHalfKeptAgentArrangement | undefined {
	const tabs: IBaseHalfKeptAgentTab[] = [];
	const keptTabs: boolean[] = [];
	for (const tab of state.tabs) {
		const kept = keepNode(tab.tree, session);
		keptTabs.push(!!kept);
		if (!kept) {
			continue;
		}
		const order = orderedLeafIds(tab.tree);
		const front = nearestKept(order.map(id => kept.paneIds.includes(id)), order.indexOf(tab.activePaneId));
		tabs.push({ ...(tab.titleOverride ? { name: tab.titleOverride } : {}), panes: kept.node, front });
	}
	if (!tabs.length) {
		return undefined;
	}
	const active = state.tabs.findIndex(tab => tab.id === state.activeTabId);
	return { version: BASEHALF_AGENT_ARRANGEMENT_VERSION, tabs, front: nearestKept(keptTabs, active < 0 ? 0 : active) };
}

export function baseHalfWriteAgentArrangement(arrangement: IBaseHalfKeptAgentArrangement): string {
	return JSON.stringify(arrangement);
}

const KINDS: readonly string[] = BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.kind);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNode(value: unknown): BaseHalfKeptAgentNode | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (value.type === 'pane') {
		if (typeof value.kind !== 'string' || !KINDS.includes(value.kind)) {
			// A kind of session that this BaseHalf does not know is left out like a session that ended.
			return undefined;
		}
		const folder = typeof value.folder === 'string' && value.folder ? value.folder : undefined;
		return { type: 'pane', kind: value.kind as BaseHalfAgentSessionKind, ...(folder ? { folder } : {}) };
	}
	if (value.type !== 'split' || (value.dir !== 'row' && value.dir !== 'column')) {
		return undefined;
	}
	const a = readNode(value.a);
	const b = readNode(value.b);
	if (!a || !b) {
		return a ?? b;
	}
	const fraction = typeof value.fraction === 'number' && Number.isFinite(value.fraction) ? Math.max(0.1, Math.min(0.9, value.fraction)) : 0.5;
	return { type: 'split', dir: value.dir, fraction, a, b };
}

function countPanes(node: BaseHalfKeptAgentNode): number {
	return node.type === 'pane' ? 1 : countPanes(node.a) + countPanes(node.b);
}

function placeWithin(value: unknown, count: number): number {
	return typeof value === 'number' && Number.isInteger(value) ? Math.max(0, Math.min(count - 1, value)) : 0;
}

/**
 * Reads what {@link baseHalfWriteAgentArrangement} wrote. Text that is not an arrangement of this version is
 * read as none; a pane or a tab that cannot be read is left out.
 */
export function baseHalfReadAgentArrangement(text: string | undefined): IBaseHalfKeptAgentArrangement | undefined {
	if (!text) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || parsed.version !== BASEHALF_AGENT_ARRANGEMENT_VERSION || !Array.isArray(parsed.tabs)) {
		return undefined;
	}
	const tabs: IBaseHalfKeptAgentTab[] = [];
	for (const tab of parsed.tabs) {
		const panes = isRecord(tab) ? readNode(tab.panes) : undefined;
		if (!isRecord(tab) || !panes) {
			continue;
		}
		const name = typeof tab.name === 'string' && tab.name.trim() ? tab.name.trim() : undefined;
		tabs.push({ ...(name ? { name } : {}), panes, front: placeWithin(tab.front, countPanes(panes)) });
	}
	if (!tabs.length) {
		return undefined;
	}
	return { version: BASEHALF_AGENT_ARRANGEMENT_VERSION, tabs, front: placeWithin(parsed.front, tabs.length) };
}

/** A session to make for a restored pane. */
export interface IBaseHalfRestoredAgentSession extends IBaseHalfKeptAgentSession {
	readonly id: string;
}

export interface IBaseHalfRestoredAgentArrangement {
	readonly state: IBaseHalfAgentTabsState;
	/** The sessions of the panes, in the order of the tabs and of their panes. */
	readonly sessions: readonly IBaseHalfRestoredAgentSession[];
}

/**
 * The tabs that an arrangement opens with, and the session of each pane. `mint` gives each tab, pane, and split
 * a new id. Nothing is closed in the result, and no tab has unseen output.
 */
export function baseHalfRestoreAgentArrangement(arrangement: IBaseHalfKeptAgentArrangement, mint: (what: 'tab' | 'agent' | 'split') => string): IBaseHalfRestoredAgentArrangement {
	const sessions: IBaseHalfRestoredAgentSession[] = [];
	const restoreNode = (node: BaseHalfKeptAgentNode): BaseHalfPaneNode => {
		if (node.type === 'pane') {
			const id = mint('agent');
			sessions.push({ id, kind: node.kind, ...(node.folder ? { folder: node.folder } : {}) });
			return paneLeaf(id);
		}
		const a = restoreNode(node.a);
		const b = restoreNode(node.b);
		return { type: 'split', id: mint('split'), dir: node.dir, a, b, fraction: node.fraction };
	};
	const tabs: IBaseHalfAgentTab[] = arrangement.tabs.map(tab => {
		const tree = restoreNode(tab.panes);
		const order = orderedLeafIds(tree);
		return {
			id: mint('tab'),
			tree,
			activePaneId: order[Math.max(0, Math.min(order.length - 1, tab.front))],
			zoomedPaneId: null,
			...(tab.name ? { titleOverride: tab.name } : {})
		};
	});
	if (!tabs.length) {
		return { state: BASEHALF_EMPTY_AGENT_TABS_STATE, sessions };
	}
	const front = tabs[Math.max(0, Math.min(tabs.length - 1, arrangement.front))];
	return { state: { tabs, activeTabId: front.id, activity: [], closing: [] }, sessions };
}

/**
 * The sessions to start now: those of the tab in front that wait to start, while the Agent Area is shown. A
 * session starts when it is first in view, so a tab that is not in front starts nothing until it is chosen.
 */
export function baseHalfAgentSessionsToStart(state: IBaseHalfAgentTabsState, areaShown: boolean, waits: (paneId: string) => boolean): string[] {
	const tab = areaShown ? activeAgentTab(state) : undefined;
	return tab ? orderedLeafIds(tab.tree).filter(waits) : [];
}

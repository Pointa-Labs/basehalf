/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfReferenceRefusalReason, IBaseHalfUpstreamEntryReplacement } from './basehalfReferenceEdit.js';
import { IBaseHalfUpstreamIdentity, IBaseHalfUpstreamItem } from './basehalfReferenceEntries.js';
import { IBaseHalfIndexedStore } from './basehalfReferenceIndex.js';
import { BaseHalfUpstreamStoreKind } from './basehalfReferenceStore.js';

/**
 * Pure planning of the rename refactor and Relink Everywhere (reference
 * graph, "Rename refactor"). A move leaves the entries that name the old path
 * dangling, and BaseHalf replaces them in place without asking (following
 * moved items, "Entries are always updated"). Relink Everywhere replaces a
 * dangling path the same way.
 */

/** One move of a path inside one workspace folder, in workspace-relative paths. */
export interface IBaseHalfPathMove {
	/** The path entries name: where the node was before the move. */
	readonly from: string;
	/** Where the node is now. */
	readonly to: string;
}

/**
 * The path `path` names after `moves`: the target of the most specific move
 * whose source is `path` or a folder above it (the first of equally specific
 * ones), or `undefined` when no move covers it. A composed plan relies on
 * this: a later move of an item inside a moved folder is a more specific move
 * that wins over the folder's. Paths are compared under the workspace
 * folder's identity, so on a case-insensitive file system `Docs/a.md` is
 * covered by a move of `docs`.
 */
export function baseHalfRemapMovedPath(path: string, moves: readonly IBaseHalfPathMove[], identity: IBaseHalfUpstreamIdentity): string | undefined {
	const key = identity.key(path);
	let best: { readonly move: IBaseHalfPathMove; readonly depth: number; readonly exact: boolean } | undefined;
	for (const move of moves) {
		const fromKey = identity.key(move.from);
		const exact = key === fromKey;
		if (!exact && !key.startsWith(`${fromKey}/`)) {
			continue;
		}
		const depth = move.from.split('/').length;
		if (!best || depth > best.depth) {
			best = { move, depth, exact };
		}
	}
	if (!best) {
		return undefined;
	}
	return best.exact ? best.move.to : [best.move.to, ...path.split('/').slice(best.depth)].join('/');
}

/** Whether `path` is one of `roots` or lies below one, under the folder's identity. */
export function baseHalfPathIsCovered(path: string, roots: readonly string[], identity: IBaseHalfUpstreamIdentity): boolean {
	const key = identity.key(path);
	return roots.some(root => {
		const rootKey = identity.key(root);
		return key === rootKey || key.startsWith(`${rootKey}/`);
	});
}

/** The moves that change a path: a composed plan keeps a move back to its exact old path only while it shadows a less specific move. */
export function baseHalfEffectiveMoves(moves: readonly IBaseHalfPathMove[]): IBaseHalfPathMove[] {
	return moves.filter(move => move.from !== move.to);
}

/**
 * The moves a prompt names: the effective moves that no other effective move
 * covers. A composed plan's more specific moves (an item moved again from
 * inside a moved folder) are left out.
 */
export function baseHalfPrimaryMoves(moves: readonly IBaseHalfPathMove[], identity: IBaseHalfUpstreamIdentity): IBaseHalfPathMove[] {
	const effective = baseHalfEffectiveMoves(moves);
	return effective.filter(move => !effective.some(other => other !== move && identity.key(move.from).startsWith(`${identity.key(other.from)}/`)));
}

/** A store whose entries name a moved path. */
export interface IBaseHalfRenameStore {
	/** The downstream node's path; after the move and its mirror cascade, its current path. */
	readonly nodePath: string;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	/** The entries that named a moved path, as written. */
	readonly entries: readonly string[];
}

/**
 * The snapshot of a move taken from the index when the working-copy file
 * operation is prepared: every active, readable store whose valid entries
 * name a moved path or a path inside a moved folder, at the paths the nodes
 * have before the move. An entry that already has the spelling of the new
 * path is not listed (a case-only rename on a case-insensitive file system).
 * Entries covered by `exclude` (the old paths of earlier unanswered plans,
 * which own them) are not listed either.
 */
export function baseHalfSnapshotRenameStores(
	stores: readonly IBaseHalfIndexedStore[],
	moves: readonly IBaseHalfPathMove[],
	identity: IBaseHalfUpstreamIdentity,
	exclude: readonly string[] = []
): IBaseHalfRenameStore[] {
	const out: IBaseHalfRenameStore[] = [];
	for (const store of stores) {
		if ((store.storeKind === 'sidecar' && store.sidecarState !== 'active') || !store.read.readable) {
			continue;
		}
		const entries = store.read.items.flatMap(item => {
			if (item.path === undefined || baseHalfPathIsCovered(item.path, exclude, identity)) {
				return [];
			}
			const target = baseHalfRemapMovedPath(item.path, moves, identity);
			return target !== undefined && target !== item.path ? [item.text] : [];
		});
		if (entries.length > 0) {
			out.push({ nodePath: store.node.relativePath, storeKind: store.storeKind, entries });
		}
	}
	return out.sort((left, right) => left.nodePath.localeCompare(right.nodePath));
}

/** An unanswered rename: the moves it covers and the stores that name them. */
export interface IBaseHalfRenamePlanState {
	/**
	 * From the paths entries name to where those items are now. After
	 * composition it can hold more specific moves (an item moved again from
	 * inside a moved folder), which win over the folder's move.
	 */
	readonly moves: readonly IBaseHalfPathMove[];
	readonly stores: readonly IBaseHalfRenameStore[];
	/**
	 * Current paths of moved nodes whose store kind changed from BaseHalf
	 * metadata to their own file (`notes.txt` → `notes.md`): the upstream list
	 * that moved with the node now belongs in the file.
	 */
	readonly storeKindChanges: readonly string[];
	/**
	 * The old paths of plans that were still unanswered when this move
	 * happened. Those plans own the entries that name them (the items had
	 * already moved away), so this plan never rewrites them.
	 */
	readonly exclude?: readonly string[];
}

/**
 * Maps an unanswered plan through a later move in the same workspace folder:
 * stores and nodes that moved again are read at their new paths, and entries
 * that name a path that moved twice map through both moves, including an
 * item moved again from inside a moved folder. A move whose path came back to
 * its exact old spelling needs no update and is dropped, unless it shadows a
 * less specific move of the plan.
 */
export function baseHalfComposeRenamePlan(plan: IBaseHalfRenamePlanState, later: readonly IBaseHalfPathMove[], identity: IBaseHalfUpstreamIdentity): IBaseHalfRenamePlanState {
	const remap = (path: string) => baseHalfRemapMovedPath(path, later, identity) ?? path;
	const moves: IBaseHalfPathMove[] = plan.moves.map(move => ({ from: move.from, to: remap(move.to) }));
	// A later move of an item below a move's target: the entries that named
	// that item before the earlier move now follow it to the later target.
	for (const move of plan.moves) {
		const toKey = identity.key(move.to);
		const depth = move.to.split('/').length;
		for (const next of later) {
			const nextKey = identity.key(next.from);
			if (!nextKey.startsWith(`${toKey}/`)) {
				continue;
			}
			const from = [move.from, ...next.from.split('/').slice(depth)].join('/');
			// Only where this plan mapped `from` to the item that moved again.
			const current = baseHalfRemapMovedPath(from, plan.moves, identity);
			if (current === undefined || identity.key(current) !== nextKey || moves.some(candidate => identity.key(candidate.from) === identity.key(from))) {
				continue;
			}
			moves.push({ from, to: next.to });
		}
	}
	return {
		// A move back to the exact old path is kept only while the move that
		// would otherwise cover that path maps it somewhere else.
		moves: moves.filter(move => {
			if (move.from !== move.to) {
				return true;
			}
			const fallback = baseHalfRemapMovedPath(move.from, moves.filter(other => other !== move), identity);
			return fallback !== undefined && fallback !== move.from;
		}),
		stores: plan.stores.map(store => ({ ...store, nodePath: remap(store.nodePath) })),
		storeKindChanges: plan.storeKindChanges.map(remap),
		...(plan.exclude ? { exclude: plan.exclude } : {})
	};
}

/** Moves a snapshot's stores to the paths their nodes have after `moves`. */
export function baseHalfRelocateRenameStores(stores: readonly IBaseHalfRenameStore[], moves: readonly IBaseHalfPathMove[], identity: IBaseHalfUpstreamIdentity): IBaseHalfRenameStore[] {
	return stores.map(store => ({ ...store, nodePath: baseHalfRemapMovedPath(store.nodePath, moves, identity) ?? store.nodePath }));
}

/** The state of one planned store, re-read when the refactor runs. */
export interface IBaseHalfRenameStoreState {
	/** The downstream node at its current path. */
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	/** The current items, valid and invalid; `undefined` when the store can't be read. */
	readonly items: readonly IBaseHalfUpstreamItem[] | undefined;
	/** The entries recorded when the move was prepared. */
	readonly snapshotEntries: readonly string[];
	/** Why the reference edit service would refuse to write this store. */
	readonly blocking?: { readonly reason: BaseHalfReferenceRefusalReason; readonly message: string };
}

/**
 * Why a store is left out: a refusal of the reference edit service
 * (`unsaved`, `markedFolder`, `unreadable`, …).
 */
export type BaseHalfRenameSkipReason = BaseHalfReferenceRefusalReason;

export interface IBaseHalfRenameSkip {
	readonly node: IBaseHalfWorkspaceResource;
	readonly reason: BaseHalfRenameSkipReason;
	/** The edit service's explanation, when it refused the store. */
	readonly message?: string;
}

/**
 * An entry the refactor leaves alone:
 * - `changed`: it is no longer listed as it was when the move happened;
 * - `resolves`: its old path names an existing node again.
 */
export interface IBaseHalfRenameLeftAlone {
	readonly node: IBaseHalfWorkspaceResource;
	readonly entry: string;
	readonly reason: 'changed' | 'resolves';
}

export interface IBaseHalfRenameStoreEdit {
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	readonly replacements: readonly IBaseHalfUpstreamEntryReplacement[];
}

export interface IBaseHalfRenameUpdatePlan {
	/** One `replaceEntries` operation per downstream node, in path order. */
	readonly edits: readonly IBaseHalfRenameStoreEdit[];
	readonly skipped: readonly IBaseHalfRenameSkip[];
	readonly leftAlone: readonly IBaseHalfRenameLeftAlone[];
}

export interface IBaseHalfRenameUpdateInput {
	readonly stores: readonly IBaseHalfRenameStoreState[];
	readonly moves: readonly IBaseHalfPathMove[];
	readonly identity: IBaseHalfUpstreamIdentity;
	/** Whether a workspace-relative path names an existing node now: a file, a folder, or a draft. */
	readonly exists: (path: string) => boolean;
	/** Old paths that earlier unanswered plans own: entries they cover are never rewritten. */
	readonly exclude?: readonly string[];
}

/**
 * Plans the refactor from the stores' current content. It rewrites only
 * entries that still name an old path and whose old path still names no
 * node; a spelling-only move rewrites every entry whose spelling differs from
 * the new one. Entries inside a moved folder that name other items of that
 * folder are covered like any other store, and so is the list of a draft.
 * Stores the edit service refuses (`blocking`) and unreadable stores are
 * skipped with their reason.
 */
export function baseHalfPlanRenameUpdate(input: IBaseHalfRenameUpdateInput): IBaseHalfRenameUpdatePlan {
	const { identity, moves } = input;
	const edits: IBaseHalfRenameStoreEdit[] = [];
	const skipped: IBaseHalfRenameSkip[] = [];
	const leftAlone: IBaseHalfRenameLeftAlone[] = [];
	const stores = [...input.stores].sort((left, right) => left.node.relativePath.localeCompare(right.node.relativePath));
	for (const store of stores) {
		const node = store.node;
		if (store.blocking) {
			skipped.push({ node, reason: store.blocking.reason, message: store.blocking.message });
			continue;
		}
		if (!store.items) {
			skipped.push({ node, reason: 'unreadable' });
			continue;
		}
		const replacements: IBaseHalfUpstreamEntryReplacement[] = [];
		const listed = new Set<string>();
		const selfKey = identity.key(node.relativePath);
		for (const item of store.items) {
			if (item.path === undefined) {
				continue;
			}
			listed.add(identity.key(item.path));
			if (baseHalfPathIsCovered(item.path, input.exclude ?? [], identity)) {
				continue;
			}
			const target = baseHalfRemapMovedPath(item.path, moves, identity);
			if (target === undefined || target === item.path || identity.key(target) === selfKey) {
				continue;
			}
			const spellingOnly = identity.key(target) === identity.key(item.path);
			if (!spellingOnly && input.exists(item.path)) {
				leftAlone.push({ node, entry: item.text, reason: 'resolves' });
				continue;
			}
			replacements.push({ from: item.path, to: target });
		}
		for (const entry of store.snapshotEntries) {
			const path = entry.endsWith('/') ? entry.slice(0, -1) : entry;
			if (!listed.has(identity.key(path))) {
				leftAlone.push({ node, entry, reason: 'changed' });
			}
		}
		if (replacements.length > 0) {
			edits.push({ node, storeKind: store.storeKind, replacements });
		}
	}
	return { edits, skipped, leftAlone };
}


/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import type { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import type { IBaseHalfIndexedStore, IBaseHalfUpstreamEntryView } from './basehalfReferenceIndex.js';
import type { BaseHalfNodeJsonValue } from './basehalfNodeDocument.js';
import { BASEHALF_EXACT_UPSTREAM_IDENTITY, baseHalfNormalizeUpstreamEntry, BaseHalfUpstreamEntryProblem, IBaseHalfUpstreamIdentity } from './basehalfReferenceEntries.js';
import type { BaseHalfUpstreamStoreProblem } from './basehalfReferenceStore.js';

/**
 * Pure helpers for the canvas and badge editor projection of the reference
 * graph (D37). UI copy says "upstream", "downstream", and "connection"; it
 * never says "reference", which is also an AI Video input role.
 */

/** One node offered by the Add Upstream, Add Downstream, or Relink picker. */
export interface IBaseHalfUpstreamPickerCandidate {
	/** Workspace-relative path. */
	readonly path: string;
	readonly kind: 'file' | 'folder';
}

function parentPath(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}

function comparePaths(left: string, right: string): number {
	return left.localeCompare(right);
}

/**
 * Orders picker candidates:
 * 1. cards on the current canvas, in canvas order;
 * 2. the folders above `nodePath`, nearest first, each followed by its direct
 *    children (by path);
 * 3. everything else, by path.
 *
 * Every candidate appears once. Callers remove the node itself and its
 * current entries before ordering.
 */
export function baseHalfOrderUpstreamPickerCandidates<T extends IBaseHalfUpstreamPickerCandidate>(
	candidates: readonly T[],
	nodePath: string,
	canvasCardPaths: readonly string[]
): T[] {
	const byPath = new Map(candidates.map(candidate => [candidate.path, candidate]));
	const ordered: T[] = [];
	const seen = new Set<string>();
	const take = (candidate: T | undefined) => {
		if (candidate && !seen.has(candidate.path)) {
			seen.add(candidate.path);
			ordered.push(candidate);
		}
	};
	for (const path of canvasCardPaths) {
		take(byPath.get(path));
	}
	const childrenByParent = new Map<string, T[]>();
	for (const candidate of candidates) {
		const parent = parentPath(candidate.path);
		let children = childrenByParent.get(parent);
		if (!children) {
			children = [];
			childrenByParent.set(parent, children);
		}
		children.push(candidate);
	}
	let ancestor = nodePath;
	while (ancestor !== '') {
		ancestor = parentPath(ancestor);
		if (ancestor !== '') {
			take(byPath.get(ancestor));
		}
		for (const child of [...(childrenByParent.get(ancestor) ?? [])].sort((left, right) => comparePaths(left.path, right.path))) {
			take(child);
		}
	}
	for (const candidate of [...candidates].sort((left, right) => comparePaths(left.path, right.path))) {
		take(candidate);
	}
	return ordered;
}

/**
 * The one candidate whose file name equals the entry's file name, for
 * **Relink to <path>**. `undefined` when no node or more than one node has
 * that name.
 */
export function baseHalfUniqueUpstreamNameMatch<T extends IBaseHalfUpstreamPickerCandidate>(
	entryPath: string,
	candidates: readonly T[]
): T | undefined {
	const name = entryPath.slice(entryPath.lastIndexOf('/') + 1).normalize('NFC');
	if (!name) {
		return undefined;
	}
	let match: T | undefined;
	for (const candidate of candidates) {
		if (candidate.path.slice(candidate.path.lastIndexOf('/') + 1).normalize('NFC') !== name) {
			continue;
		}
		if (match) {
			return undefined;
		}
		match = candidate;
	}
	return match;
}

/** The counts a toggle, a collapsed badge summary, or a delete prompt shows. */
export interface IBaseHalfCanvasConnectionCounts {
	/** Upstream nodes (valid, non-dangling entries) in any folder. */
	readonly upstream: number;
	/** Downstream nodes in any folder; `undefined` while the index is building. */
	readonly downstream: number | undefined;
	/** Warning rows plus one for a store-level issue. */
	readonly issues: number;
	/** The index is partial: the downstream count may be incomplete. */
	readonly incomplete?: boolean;
}

/**
 * "↑N upstream · ↓M downstream", plus "· K issues" when there are issues.
 * While the index is building the downstream side is unknown and the summary
 * reads "Loading…".
 */
export function baseHalfCanvasConnectionSummary(counts: IBaseHalfCanvasConnectionCounts): string {
	if (counts.downstream === undefined) {
		return localize('basehalf.canvas.connections.loading', "Loading…");
	}
	const upstream = localize('basehalf.canvas.connections.upstreamCount', "↑{0} upstream", counts.upstream);
	const downstream = counts.incomplete
		? localize('basehalf.canvas.connections.downstreamCountIncomplete', "↓{0} downstream (incomplete)", counts.downstream)
		: localize('basehalf.canvas.connections.downstreamCount', "↓{0} downstream", counts.downstream);
	const parts = [upstream, downstream];
	if (counts.issues > 0) {
		parts.push(counts.issues === 1
			? localize('basehalf.canvas.connections.oneIssue', "1 issue")
			: localize('basehalf.canvas.connections.issues', "{0} issues", counts.issues));
	}
	return parts.join(' · ');
}

/** Why one Upstream row is shown in a warning style (or, for historical inputs, a neutral one). */
export function baseHalfUpstreamEntryMessage(entry: Pick<IBaseHalfUpstreamEntryView, 'status' | 'problem' | 'historical'>): string {
	if (entry.status === 'valid') {
		return '';
	}
	if (entry.status === 'dangling') {
		return entry.historical
			? localize('basehalf.upstream.entry.historical', "Moved or deleted since this result was made")
			: localize('basehalf.upstream.entry.dangling', "Nothing at this path. It was moved or deleted.");
	}
	return baseHalfUpstreamEntryProblemMessage(entry.problem);
}

/** A short explanation of an invalid entry. */
export function baseHalfUpstreamEntryProblemMessage(problem: BaseHalfUpstreamEntryProblem | undefined): string {
	switch (problem) {
		case 'empty': return localize('basehalf.upstream.problem.empty', "This entry is empty.");
		case 'notScalar': return localize('basehalf.upstream.problem.notScalar', "This entry is not a path.");
		case 'notString': return localize('basehalf.upstream.problem.notString', "This entry is not a path.");
		case 'absolute': return localize('basehalf.upstream.problem.absolute', "Paths start at the workspace folder, without a leading /.");
		case 'backslash': return localize('basehalf.upstream.problem.backslash', "Paths use / between folders, not \\.");
		case 'controlCharacter': return localize('basehalf.upstream.problem.controlCharacter', "This path contains a control character.");
		case 'invalidSegment': return localize('basehalf.upstream.problem.invalidSegment', "This path has an empty, '.', or '..' part.");
		case 'metadata': return localize('basehalf.upstream.problem.metadata', "This path names BaseHalf metadata under .bh.");
		case 'self': return localize('basehalf.upstream.problem.self', "This entry names the card itself.");
		case 'duplicate': return localize('basehalf.upstream.problem.duplicate', "This path is already listed above.");
		case 'overLimit': return localize('basehalf.upstream.problem.overLimit', "A node lists at most 64 upstream entries.");
		default: return localize('basehalf.upstream.problem.invalid', "This entry is not a valid path.");
	}
}

/** Why a store's `upstream` value cannot be read or written by BaseHalf. */
export function baseHalfUpstreamStoreProblemMessage(problem: BaseHalfUpstreamStoreProblem | undefined, readError?: string): string {
	if (readError !== undefined) {
		return localize('basehalf.upstream.store.readError', "The upstream list could not be read: {0}", readError);
	}
	switch (problem) {
		case 'mappingValue': return localize('basehalf.upstream.store.mappingValue', "`upstream` holds a mapping, so it can't be read as a list.");
		case 'duplicateKey': return localize('basehalf.upstream.store.duplicateKey', "`upstream` appears more than once.");
		case 'anchorAliasTag': return localize('basehalf.upstream.store.anchorAliasTag', "`upstream` uses a YAML anchor, alias, or tag.");
		case 'blockScalar': return localize('basehalf.upstream.store.blockScalar', "`upstream` is a block of text, not a list.");
		case 'invalidDocument': return localize('basehalf.upstream.store.invalidDocument', "This node document can't be read.");
		case 'foreignValue': return localize('basehalf.upstream.store.foreignValue', "`upstream` is used by another tool.");
		case 'frontmatterRejected': return localize('basehalf.upstream.store.frontmatterRejected', "The block at the top of this file isn't frontmatter BaseHalf can edit.");
		case 'tomlFrontmatter': return localize('basehalf.upstream.store.tomlFrontmatter', "BaseHalf doesn't edit TOML frontmatter.");
		case 'mappingNotBlock': return localize('basehalf.upstream.store.mappingNotBlock', "The frontmatter isn't a plain list of keys BaseHalf can edit.");
		case 'frontmatterBeyondWindow': return localize('basehalf.upstream.store.frontmatterBeyondWindow', "The frontmatter is too large for BaseHalf to edit.");
		case 'multilineItem': return localize('basehalf.upstream.store.multilineItem', "An `upstream` entry spans several lines.");
		default: return localize('basehalf.upstream.store.unknown', "The upstream list can't be edited here.");
	}
}

/** One store that lists a node about to be deleted. */
export interface IBaseHalfCanvasDeleteImpactStore {
	readonly node: IBaseHalfWorkspaceResource;
	/** The entries naming a deleted node (or a node inside a deleted folder), in list order. */
	readonly entries: readonly { readonly index: number; readonly text: string; readonly path: string }[];
}

/**
 * The downstream stores that name any of `deletedPaths` (or a path inside a
 * deleted folder). Stores that are themselves deleted, inactive sidecars, and
 * the historical bound inputs of attempted or sealed `.bhnode` documents are
 * left out: removing those would change no user-visible connection.
 */
export function baseHalfCanvasDeleteImpact(
	stores: readonly IBaseHalfIndexedStore[],
	deletedPaths: readonly string[],
	identity: IBaseHalfUpstreamIdentity = BASEHALF_EXACT_UPSTREAM_IDENTITY
): IBaseHalfCanvasDeleteImpactStore[] {
	const deletedKeys = new Set(deletedPaths.map(path => identity.key(path)));
	const isDeleted = (path: string): boolean => {
		let current = path;
		while (current !== '') {
			if (deletedKeys.has(identity.key(current))) {
				return true;
			}
			current = parentPath(current);
		}
		return false;
	};
	const impact: IBaseHalfCanvasDeleteImpactStore[] = [];
	for (const store of stores) {
		if ((store.sidecarState !== undefined && store.sidecarState !== 'active') || !store.read.readable || isDeleted(store.node.relativePath)) {
			continue;
		}
		const historical = store.lifecycle === 'attempted' || store.lifecycle === 'sealed';
		const bound = new Set((store.bindings ?? []).map(binding => identity.key(binding.sourcePath)));
		const entries = store.read.items.flatMap(item => item.path !== undefined
			&& isDeleted(item.path)
			&& !(historical && bound.has(identity.key(item.path)))
			? [{ index: item.index, text: item.text, path: item.path }]
			: []);
		if (entries.length > 0) {
			impact.push({ node: store.node, entries });
		}
	}
	return impact.sort((left, right) => comparePaths(left.node.relativePath, right.node.relativePath));
}

/**
 * Resolves a card's valid entry paths to the spelling of the sibling cards
 * they name (identity comparison: NFC, and case on case-insensitive file
 * systems), so the model can derive edges by path. Entries that name no
 * sibling keep their own spelling.
 */
export function baseHalfCanvasResolveSiblingUpstream(
	entryPaths: readonly string[],
	siblingPaths: readonly string[],
	identity: IBaseHalfUpstreamIdentity = BASEHALF_EXACT_UPSTREAM_IDENTITY
): string[] {
	const siblingByKey = new Map(siblingPaths.map(path => [identity.key(path), path]));
	const resolved: string[] = [];
	const seen = new Set<string>();
	for (const path of entryPaths) {
		const key = identity.key(path);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		resolved.push(siblingByKey.get(key) ?? path);
	}
	return resolved;
}

/**
 * A `.bhnode` `upstream` list after a Composer edit (D37): removed sources
 * leave the list, added sources are appended unless an item already names
 * them (never listed twice), and every other item keeps its position and
 * source value.
 */
export function baseHalfNodeUpstreamWithSourceChanges(
	upstream: readonly BaseHalfNodeJsonValue[],
	removedSourcePaths: readonly string[],
	addedSourcePaths: readonly string[],
	identity: IBaseHalfUpstreamIdentity = BASEHALF_EXACT_UPSTREAM_IDENTITY
): BaseHalfNodeJsonValue[] {
	const itemKey = (value: BaseHalfNodeJsonValue) => typeof value === 'string' ? identity.key(baseHalfNormalizeUpstreamEntry(value)) : undefined;
	const removed = new Set(removedSourcePaths.map(path => identity.key(baseHalfNormalizeUpstreamEntry(path))));
	const next = upstream.filter(value => {
		const key = itemKey(value);
		return key === undefined || !removed.has(key);
	});
	for (const path of addedSourcePaths.map(baseHalfNormalizeUpstreamEntry)) {
		const key = identity.key(path);
		if (!removed.has(key) && !next.some(value => itemKey(value) === key)) {
			next.push(path);
		}
	}
	return next;
}

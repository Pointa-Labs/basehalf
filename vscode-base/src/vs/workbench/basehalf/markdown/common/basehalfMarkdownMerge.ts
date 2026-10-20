/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Planning helpers for applying an external file change to a live rich
 * Markdown editor incrementally, so blocks outside the changed region — and
 * with them the user's cursor, scroll position, and undo history — survive
 * edits made by agents or other tools while the document is open.
 */

export interface IBaseHalfMarkdownMergeRegion {
	/** First changed old-segment index (inclusive). */
	readonly oldStart: number;
	/** End of the changed old-segment range (exclusive). */
	readonly oldEnd: number;
	/** First changed new-segment index (inclusive). */
	readonly newStart: number;
	/** End of the changed new-segment range (exclusive). */
	readonly newEnd: number;
}

/**
 * Diffs two segment sequences by trimming the common prefix and suffix and
 * treating everything between as one changed region. Localized edits (the
 * common case for agent writes) map to a minimal region; scattered edits
 * collapse into one wider region, which is still correct — just less minimal.
 * Returns `null` when the sequences are identical.
 */
export function diffBaseHalfMarkdownSegments(
	oldRaws: readonly string[],
	newRaws: readonly string[]
): IBaseHalfMarkdownMergeRegion | null {
	const maxCommon = Math.min(oldRaws.length, newRaws.length);
	let prefix = 0;
	while (prefix < maxCommon && oldRaws[prefix] === newRaws[prefix]) {
		prefix++;
	}

	let suffix = 0;
	while (
		suffix < maxCommon - prefix
		&& oldRaws[oldRaws.length - 1 - suffix] === newRaws[newRaws.length - 1 - suffix]
	) {
		suffix++;
	}

	if (prefix === oldRaws.length && prefix === newRaws.length) {
		return null;
	}

	return {
		oldStart: prefix,
		oldEnd: oldRaws.length - suffix,
		newStart: prefix,
		newEnd: newRaws.length - suffix
	};
}

/**
 * Groups per-block save contributions under the disk segmentation they
 * serialize to: group `i` lists the contribution indices whose concatenated
 * text equals `segmentRaws[i]`. Returns `null` when the contributions do not
 * reproduce the segmentation exactly — the caller must fall back to a full
 * rebuild instead of merging against a misaligned view.
 */
export function groupBaseHalfMarkdownContributions(
	contributionTexts: readonly string[],
	segmentRaws: readonly string[]
): number[][] | null {
	const groups: number[][] = [];
	let index = 0;
	for (const raw of segmentRaws) {
		const group: number[] = [];
		let accumulated = '';
		while (accumulated.length < raw.length && index < contributionTexts.length) {
			accumulated += contributionTexts[index];
			group.push(index);
			index++;
		}

		if (accumulated !== raw) {
			return null;
		}
		groups.push(group);
	}

	return index === contributionTexts.length ? groups : null;
}

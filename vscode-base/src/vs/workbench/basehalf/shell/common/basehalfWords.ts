/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The words of the shell (D150, docs/specs/commands-and-menus.md): the base has names for the parts of its
// window, and BaseHalf has its own for the parts it keeps. This module imports nothing, so that the base's
// services that read it load nothing with it.

export interface IBaseHalfWord {
	/** The base's words, as its strings hold them. */
	readonly base: string;
	/** BaseHalf's words for the same. */
	readonly basehalf: string;
}

/**
 * The base's words for the parts of the window and BaseHalf's. A longer entry is read before a shorter one
 * that it holds, so a whole name goes before the name of the part in it.
 */
export const BASEHALF_WORDS: readonly IBaseHalfWord[] = [
	// The two commands that show and hide a part, by the names the product has for them.
	{ base: 'Toggle Primary Side Bar Visibility', basehalf: 'Toggle Sidebar' },
	{ base: 'Toggle Secondary Side Bar Visibility', basehalf: 'Toggle Agent Area' },
	// Both parts in one phrase, as the descriptions of some settings name them.
	{ base: 'Primary and Secondary Side Bars', basehalf: 'Sidebar and Agent Area' },
	// The part at the left.
	{ base: 'Primary Side Bar', basehalf: 'Sidebar' },
	{ base: 'primary side bar', basehalf: 'sidebar' },
	{ base: 'Side Bar', basehalf: 'Sidebar' },
	{ base: 'side bar', basehalf: 'sidebar' },
	// The part at the right.
	{ base: 'Secondary Side Bar', basehalf: 'Agent Area' },
	{ base: 'secondary side bar', basehalf: 'Agent Area' }
];

const WORDS = new Map<string, string>(BASEHALF_WORDS.map(word => [word.base, word.basehalf]));
const BASE_WORDS = new RegExp(
	[...WORDS.keys()].sort((a, b) => b.length - a.length).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
	'g'
);

/** The text in BaseHalf's words: every name of the base's for a part of the window by BaseHalf's name for it. */
export function toBaseHalfWords(text: string): string {
	// Every entry holds "ide ": most texts name no part.
	if (!text.includes('ide ')) {
		return text;
	}
	return text.replace(BASE_WORDS, word => WORDS.get(word) ?? word);
}

/** Whether the text holds a name of the base's for a part of the window. */
export function hasBaseWords(text: string): boolean {
	return toBaseHalfWords(text) !== text;
}

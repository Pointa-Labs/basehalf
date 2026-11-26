/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports nothing.
//
// What the menu of blocks in a note holds, how letters rank its rows, and which
// side of its line it opens on (the menu of blocks in a note, rules 1, 15, and 17).

export type BaseHalfNoteMenuGroup = 'basic' | 'files' | 'more';

export interface IBaseHalfNoteMenuEntry {
	/** The row's key in the editor's own list; {@link BASEHALF_NOTE_MENU_LINK_KEY} is BaseHalf's. */
	readonly key: string;
	readonly group: BaseHalfNoteMenuGroup;
	/** What typed at the start of a line makes the block or opens its list. */
	readonly form?: string;
}

/** The row that opens the list of files to link, the list `[[` opens. */
export const BASEHALF_NOTE_MENU_LINK_KEY = 'link_to_file';

/** The rows of the menu, in their order. */
export const BASEHALF_NOTE_MENU_ENTRIES: readonly IBaseHalfNoteMenuEntry[] = [
	{ key: 'paragraph', group: 'basic' },
	{ key: 'heading', group: 'basic', form: '#' },
	{ key: 'heading_2', group: 'basic', form: '##' },
	{ key: 'heading_3', group: 'basic', form: '###' },
	{ key: 'bullet_list', group: 'basic', form: '-' },
	{ key: 'numbered_list', group: 'basic', form: '1.' },
	{ key: 'check_list', group: 'basic', form: '[ ]' },
	{ key: 'toggle_list', group: 'basic' },
	{ key: 'quote', group: 'basic', form: '>' },
	{ key: 'code_block', group: 'basic', form: '```' },
	{ key: 'table', group: 'basic' },
	{ key: 'divider', group: 'basic', form: '---' },
	{ key: 'image', group: 'files' },
	{ key: 'video', group: 'files' },
	{ key: 'audio', group: 'files' },
	{ key: 'file', group: 'files' },
	{ key: BASEHALF_NOTE_MENU_LINK_KEY, group: 'files', form: '[[' },
	{ key: 'toggle_heading', group: 'more' },
	{ key: 'toggle_heading_2', group: 'more' },
	{ key: 'toggle_heading_3', group: 'more' },
	{ key: 'heading_4', group: 'more', form: '####' },
	{ key: 'heading_5', group: 'more', form: '#####' },
	{ key: 'heading_6', group: 'more', form: '######' },
	{ key: 'emoji', group: 'more', form: ':' },
];

/** How far the menu stands from its line. */
export const BASEHALF_NOTE_MENU_GAP = 4;
/** How far the menu stays inside the view. */
export const BASEHALF_NOTE_MENU_MARGIN = 8;
/** How tall the menu is at most: all of its first group, the name of the next, and half of its first row, which shows that the list goes on. */
export const BASEHALF_NOTE_MENU_MAX_HEIGHT = 428;
/** The room under its line in which the menu opens there, whatever room is above: eight rows. */
const ENOUGH_ROOM_BELOW = 240;

/** Which side of its line the menu opens on, in a view of the height `viewHeight` (rule 17). */
export function baseHalfNoteMenuSide(line: { readonly top: number; readonly bottom: number }, viewHeight: number): 'bottom' | 'top' {
	const below = viewHeight - line.bottom - BASEHALF_NOTE_MENU_GAP - BASEHALF_NOTE_MENU_MARGIN;
	const above = line.top - BASEHALF_NOTE_MENU_GAP - BASEHALF_NOTE_MENU_MARGIN;
	return below >= ENOUGH_ROOM_BELOW || below >= above ? 'bottom' : 'top';
}

/**
 * How well letters match a row, best first (rule 15), or none: a title that
 * starts with them, a word for the row that is them, a word of the title that
 * starts with them, a word for the row that starts with them, and last any
 * title or word that holds them.
 */
function rankOf(row: { readonly title: string; readonly aliases?: readonly string[] }, letters: string): number | undefined {
	const title = row.title.toLowerCase();
	const words = (row.aliases ?? []).map(word => word.toLowerCase());
	if (title.startsWith(letters)) {
		return 0;
	}
	if (words.includes(letters)) {
		return 1;
	}
	if (title.split(/[\s-]+/).some(word => word.startsWith(letters))) {
		return 2;
	}
	if (words.some(word => word.startsWith(letters))) {
		return 3;
	}
	return title.includes(letters) || words.some(word => word.includes(letters)) ? 4 : undefined;
}

/** The rows that `query` finds, best first; rows of one rank keep their order, and an empty query finds all of them in order. */
export function rankBaseHalfNoteMenuRows<T extends { readonly title: string; readonly aliases?: readonly string[] }>(rows: readonly T[], query: string): T[] {
	const letters = query.trim().toLowerCase();
	if (!letters) {
		return [...rows];
	}
	const ranked: { readonly row: T; readonly rank: number }[] = [];
	for (const row of rows) {
		const rank = rankOf(row, letters);
		if (rank !== undefined) {
			ranked.push({ row, rank });
		}
	}
	return ranked.sort((a, b) => a.rank - b.rank).map(({ row }) => row);
}

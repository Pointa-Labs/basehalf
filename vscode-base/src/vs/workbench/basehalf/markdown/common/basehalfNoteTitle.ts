/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { baseHalfMarkdownBlocks, baseHalfMarkdownInlineAtoms } from './basehalfNoteInline.js';
import { splitBaseHalfMarkdownFrontmatter } from './basehalfMarkdownProjection.js';

// A note's title names its file (docs/specs/note-title.md): what the title of
// a note is, and the name of a file that a title gives.

/** How much of a note's body is read for its title: a title is the body's first block. */
const TITLE_READ_LENGTH = 8192;

/** The longest name a title gives, in bytes of UTF-8, before the extension and a number. */
const TITLE_NAME_MAX_BYTES = 200;

/**
 * The title of a note: the first block of its body when that block is a
 * heading, read as the card shows it, without the marks of formats and with
 * a line break as a space. `undefined` for a note that begins with anything
 * else, and for a first heading that shows no character.
 */
export function baseHalfNoteTitle(content: string): string | undefined {
	const text = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
	const body = splitBaseHalfMarkdownFrontmatter(text).body.trimStart();
	// A heading that the cut leaves whole: the first block ends at the first empty line.
	const end = body.search(/\r?\n[ \t]*\r?\n/);
	const head = end === -1 || end > TITLE_READ_LENGTH ? body.slice(0, TITLE_READ_LENGTH) : body.slice(0, end);
	const first = baseHalfMarkdownBlocks(head)[0];
	if (!first || first.type !== 'heading') {
		return undefined;
	}
	const atoms = baseHalfMarkdownInlineAtoms(first.text, { place: 'heading' });
	const shown = atoms ? atoms.map(atom => atom.text).join('') : first.text;
	const title = shown.replace(/\s+/g, ' ').trim();
	return title.length > 0 ? title : undefined;
}

/**
 * The name a title gives a file, without an extension: the title's
 * characters, with what a file name cannot hold on any system as a space,
 * no dot at the beginning, no dot or space at the end, and at most 200 bytes
 * of UTF-8. `undefined` when nothing is left.
 */
export function baseHalfNoteTitleName(title: string): string | undefined {
	let name = title
		.replace(/[\/\\:*?"<>|\u0000-\u001F\u007F]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.replace(/[. ]+$/, '')
		.trim();
	name = cutToUtf8Bytes(name, TITLE_NAME_MAX_BYTES).replace(/[. ]+$/, '');
	return name.length > 0 ? name : undefined;
}

/** `name` with the number `count` after it, as a moved item that keeps both names gets one: `Plan 2`. */
export function baseHalfNoteTitleNameNumbered(name: string, count: number): string {
	return `${name} ${count}`;
}

function cutToUtf8Bytes(text: string, limit: number): string {
	let bytes = 0;
	let end = 0;
	for (const character of text) {
		const code = character.codePointAt(0)!;
		const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
		if (bytes + size > limit) {
			break;
		}
		bytes += size;
		end += character.length;
	}
	return text.slice(0, end);
}

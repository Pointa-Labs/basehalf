/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The links of a note into the store of its files (files in notes, rules 18
// to 20): how a link's destination is read, what makes it a link into the
// store, and finding a note's links. It imports nothing: Rich's webview reads
// it too.

/** A link into the store, read from its destination. */
export interface IBaseHalfNoteStoreLink {
	/** The decoded path, relative to the note. */
	readonly path: string;
	/** The part before `.bh`: a `../` for each folder between the home and the note, rarely folder names. */
	readonly route: string;
	/** The note's folder in the store. */
	readonly folder: string;
	readonly file: string;
}

/**
 * The path a link's destination names, read as every place reads it (rule
 * 20): `<…>` unwrapped and backslash escapes removed, `?` and `#` end the
 * path, which is percent-decoded once (a malformed escape stays as written)
 * and normalized to NFC. Nothing for a destination with a scheme, a leading
 * `#`, or a leading `/`, which is no file of the note.
 */
export function baseHalfNoteLinkPath(destination: string): string | undefined {
	let value = destination.trim();
	if (value.startsWith('<') && value.endsWith('>')) {
		value = value.slice(1, -1);
	}
	value = value.replace(/\\([!-/:-@[-`{-~])/g, '$1');
	if (!value || value.startsWith('#') || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
		return undefined;
	}
	const path = value.split(/[?#]/, 1)[0];
	return path ? decodeOnce(path).normalize('NFC') : undefined;
}

function decodeOnce(path: string): string {
	return path.replace(/(?:%[0-9a-f]{2})+/gi, run => {
		try {
			return decodeURIComponent(run);
		} catch {
			return run;
		}
	});
}

/** The link into the store that `destination` is: its decoded path ends in `.bh/attachments/<folder>/<file>`. */
export function baseHalfNoteStoreLink(destination: string): IBaseHalfNoteStoreLink | undefined {
	const path = baseHalfNoteLinkPath(destination);
	if (!path) {
		return undefined;
	}
	const segments = path.split('/');
	const at = segments.length - 4;
	if (at < 0 || segments[at] !== '.bh' || segments[at + 1] !== 'attachments') {
		return undefined;
	}
	const folder = segments[at + 2];
	const file = segments[at + 3];
	if (!isSegment(folder) || !isSegment(file)) {
		return undefined;
	}
	return { path, route: segments.slice(0, at).map(segment => `${segment}/`).join(''), folder, file };
}

function isSegment(segment: string): boolean {
	return segment !== '' && segment !== '.' && segment !== '..';
}

/**
 * The destinations of a note's links and pictures, of its reference
 * definitions, and of the `src` and `href` of its HTML, outside code blocks
 * and code spans, in their order.
 */
export function baseHalfNoteLinkDestinations(markdown: string): string[] {
	const text = withoutCode(markdown);
	const found: { readonly at: number; readonly destination: string }[] = [];
	for (const match of text.matchAll(/\]\(\s*(<[^>\n]*>|[^\s)]+)/g)) {
		found.push({ at: match.index ?? 0, destination: match[1] });
	}
	for (const match of text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm)) {
		found.push({ at: match.index ?? 0, destination: match[1] });
	}
	for (const match of text.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)) {
		found.push({ at: match.index ?? 0, destination: match[1] ?? match[2] ?? match[3] ?? '' });
	}
	return found.sort((a, b) => a.at - b.at).map(item => item.destination);
}

/** The links into the store of a note's Markdown, in their order. */
export function baseHalfNoteStoreLinks(markdown: string): IBaseHalfNoteStoreLink[] {
	const links: IBaseHalfNoteStoreLink[] = [];
	for (const destination of baseHalfNoteLinkDestinations(markdown)) {
		const link = baseHalfNoteStoreLink(destination);
		if (link) {
			links.push(link);
		}
	}
	return links;
}

/** A note's Markdown with its fenced code blocks and code spans blanked, so that no link is found in code. */
function withoutCode(markdown: string): string {
	const kept: string[] = [];
	let fence: { readonly marker: string; readonly length: number } | undefined;
	for (const line of markdown.split(/\r\n?|\n/)) {
		const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (opening && !fence) {
			fence = { marker: opening[1][0], length: opening[1].length };
			kept.push('');
			continue;
		}
		if (fence) {
			const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
			if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
				fence = undefined;
			}
			kept.push('');
			continue;
		}
		kept.push(line.replace(/(`+)[\s\S]*?\1/g, ''));
	}
	return kept.join('\n');
}

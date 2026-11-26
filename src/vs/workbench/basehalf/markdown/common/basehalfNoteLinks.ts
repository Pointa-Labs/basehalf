/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { lexer, type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import { posix } from '../../../../base/common/path.js';
import { dirname, extUri, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { splitBaseHalfMarkdownFrontmatter } from './basehalfMarkdownProjection.js';
import { baseHalfHeadingSlug, decodeBaseHalfSmallCharacterReferences } from './basehalfNoteMarkdownText.js';

// Where a link of a note goes (note formats, rules 53, 55, and 56): one
// reading of an address for the card, Preview, the card's editor, and Rich.

export type BaseHalfNoteLinkTarget =
	/** A web page or a mail, opened by the system at the address as written. */
	| { readonly kind: 'web'; readonly address: string }
	/** A file or a folder of the workspace, and the heading a note is opened at. */
	| { readonly kind: 'file'; readonly uri: URI; readonly heading?: string }
	/** A heading of the note the link is in. */
	| { readonly kind: 'heading'; readonly heading: string }
	/** Nowhere: an address of another kind, or outside the workspace's folders. */
	| { readonly kind: 'none' };

const nowhere: BaseHalfNoteLinkTarget = Object.freeze({ kind: 'none' });

const webSchemes: ReadonlySet<string> = new Set(['http', 'https', 'mailto']);

function decodeOnce(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/**
 * Where the link `href` of the note `note` goes. `#slug` names a heading of
 * the note; `http:`, `https:`, and `mailto:` are the web's; any other scheme
 * but `file:` goes nowhere. Of a path, `?` and `#` end it and it is decoded
 * once: `my%20file.md` is `my file.md`. A path that starts with `/` is a path
 * on the disk, any other is read from the note's folder, and `.` and `..`
 * are resolved after decoding. An address outside every one of `folders`
 * goes nowhere.
 */
export function resolveBaseHalfNoteLink(note: URI, folders: readonly URI[], href: string): BaseHalfNoteLinkTarget {
	const address = href.trim();
	if (address === '') {
		return nowhere;
	}
	if (address.startsWith('#')) {
		const heading = decodeOnce(address.slice(1));
		return heading ? { kind: 'heading', heading } : nowhere;
	}
	const scheme = /^([a-z][a-z0-9+.-]+):/i.exec(address)?.[1].toLowerCase();
	let uri: URI;
	let heading: string | undefined;
	if (scheme !== undefined) {
		if (webSchemes.has(scheme)) {
			return { kind: 'web', address };
		}
		if (scheme !== 'file') {
			return nowhere;
		}
		try {
			const parsed = URI.parse(address);
			uri = parsed.with({ query: null, fragment: null });
			heading = parsed.fragment || undefined;
		} catch {
			return nowhere;
		}
	} else {
		const end = address.search(/[?#]/);
		const path = decodeOnce(end < 0 ? address : address.slice(0, end));
		const hash = address.indexOf('#');
		heading = hash < 0 ? undefined : decodeOnce(address.slice(hash + 1)) || undefined;
		if (path === '') {
			return heading ? { kind: 'heading', heading } : nowhere;
		}
		uri = path.startsWith('/') ? note.with({ path: posix.normalize(path), query: null, fragment: null }) : joinPath(dirname(note), path);
	}
	if (!folders.some(folder => extUri.isEqualOrParent(uri, folder))) {
		return nowhere;
	}
	if (heading && extUri.isEqual(uri, note)) {
		return { kind: 'heading', heading };
	}
	return heading ? { kind: 'file', uri, heading } : { kind: 'file', uri };
}

/**
 * The address a drawn link of `note` gets (note formats, rule 55): a path as
 * the absolute address of what it names, decoded once, and `#slug` as the
 * note's own address at the heading, so that the renderer neither reads it
 * from another folder nor encodes it again; any other address as it is.
 */
export function baseHalfNoteLinkHref(note: URI, href: string): string {
	const address = href.trim();
	if (address === '' || /^[a-z][a-z0-9+.-]+:/i.test(address)) {
		return href;
	}
	const end = address.search(/[?#]/);
	const path = decodeOnce(end < 0 ? address : address.slice(0, end));
	const hash = address.indexOf('#');
	const fragment = hash < 0 ? '' : decodeOnce(address.slice(hash + 1));
	if (path === '' && fragment === '') {
		return href;
	}
	const uri = path === '' ? note : path.startsWith('/') ? note.with({ path: posix.normalize(path) }) : joinPath(dirname(note), path);
	return uri.with({ query: '', fragment }).toString();
}

/**
 * The line of the file `content`, counted from 1, of the heading that a
 * link names by `heading` (rule 56): the first heading whose slug it is, by
 * the slugs of the note's headings in order, each of the text it shows. None
 * when no heading has it.
 */
export function baseHalfNoteHeadingLine(content: string, heading: string): number | undefined {
	const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
	const wanted = heading.toLowerCase();
	const seen = new Map<string, number>();
	let line = 1 + (frontmatter.match(/\n/g)?.length ?? 0);
	for (const token of lexer(body, { gfm: true })) {
		if (token.type === 'heading' && baseHalfHeadingSlug(shownText((token as Tokens.Heading).tokens).replace(/\s+/g, ' ').trim(), seen) === wanted) {
			return line;
		}
		line += token.raw.match(/\n/g)?.length ?? 0;
	}
	return undefined;
}

/** The text that inline tokens show: the text of marks and links, without their marks and addresses. */
function shownText(tokens: readonly Token[]): string {
	let text = '';
	for (const token of tokens) {
		const children = (token as { readonly tokens?: readonly Token[] }).tokens;
		if (children) {
			text += shownText(children);
		} else if (token.type === 'text' || token.type === 'escape' || token.type === 'codespan') {
			text += decodeBaseHalfSmallCharacterReferences((token as Tokens.Text).text);
		} else if (token.type === 'image') {
			text += (token as Tokens.Image).text;
		} else if (token.type === 'br') {
			text += ' ';
		}
	}
	return text;
}

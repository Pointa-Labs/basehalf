/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { segmentBaseHalfMarkdownTopLevelBody } from './basehalfMarkdownProjection.js';

/**
 * A Markdown card is a projection of the stored document, not a summary.
 * Preserve the source text exactly here. File-card hydration uses an
 * all-or-nothing size gate, and an active editor applies that same gate before
 * rebuilding its resting fallback. Neither path may normalize, truncate, or
 * decorate source.
 */
export function baseHalfCanvasMarkdownPreviewSource(raw: string): string {
	return raw;
}

/**
 * The card's editor builds every block of its note when it opens, so opening
 * it takes longer for a longer note. At 64 KiB it opens in about 120 ms; see
 * the Note size rules of note rendering.
 */
export const BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES = 64 * 1024;

/**
 * The resting projection builds a note in parts, but it still reads the file
 * and finds the blocks of the whole note when it draws it.
 */
export const BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES = 1024 * 1024;

/** The length, in characters, at which a part of a note is ended. */
export const BASEHALF_CANVAS_NOTE_PART_LENGTH = 2000;

/** The Markdown renderer of the base cuts its text after this many characters. */
const RENDERER_MAX_LENGTH = 100_000;

/** A part that is still inside an HTML element is ended after this many characters anyway. */
const OPEN_HTML_PART_LENGTH = 50_000;

/** A block longer than this is not shown in a part. */
const BLOCK_MAX_LENGTH = 90_000;

const VOID_HTML_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function fitsUtf8Bytes(source: string, maxBytes: number): boolean {
	let bytes = 0;
	for (let index = 0; index < source.length; index++) {
		const codeUnit = source.charCodeAt(index);
		if (codeUnit <= 0x7F) {
			bytes += 1;
		} else if (codeUnit <= 0x7FF) {
			bytes += 2;
		} else if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF
			&& index + 1 < source.length
			&& source.charCodeAt(index + 1) >= 0xDC00
			&& source.charCodeAt(index + 1) <= 0xDFFF) {
			bytes += 4;
			index++;
		} else {
			// BMP characters and lone surrogate code units both encode to three
			// bytes; TextEncoder replaces the latter with U+FFFD.
			bytes += 3;
		}
		if (bytes > maxBytes) {
			return false;
		}
	}
	return true;
}

/**
 * Apply the Canvas inline boundary to the current source, not JavaScript's
 * UTF-16 code-unit length. File stat sizes and file-service read limits are
 * byte based, so a live TextModel must use the same UTF-8 measurement. Stop as
 * soon as the limit is exceeded instead of allocating an encoded copy of a
 * potentially very large document.
 */
export function baseHalfCanvasMarkdownSourceFitsInline(source: string): boolean {
	return fitsUtf8Bytes(source, BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES);
}

/** The same UTF-8 measurement for the size of a note that its card shows. */
export function baseHalfCanvasMarkdownSourceFitsShown(source: string): boolean {
	return fitsUtf8Bytes(source, BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES);
}

/**
 * Inline editing is only a valid transition when the Canvas already owns the
 * complete stored projection that remains underneath the editor, and that
 * projection is small enough for the editor. The file size is a second,
 * defensive boundary against stale preview metadata.
 */
export function baseHalfCanvasMarkdownEditTarget(
	fileSize: number | undefined,
	markdownPreview: string | undefined
): 'inline' | 'richDetail' {
	return markdownPreview !== undefined
		&& (fileSize === undefined || fileSize <= BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES)
		&& baseHalfCanvasMarkdownSourceFitsInline(markdownPreview)
		? 'inline'
		: 'richDetail';
}

/**
 * The definitions of the reference links of a note, outside code blocks. A
 * part of the note is rendered with them, so that a link whose definition is
 * in another part still resolves.
 */
export function collectBaseHalfCanvasMarkdownReferenceDefinitions(markdown: string): string {
	const definitions: string[] = [];
	const lines = markdown.split(/\r\n?|\n/);
	let fence: { readonly marker: '`' | '~'; readonly length: number } | undefined;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1][0] as '`' | '~';
			if (!fence) {
				fence = { marker, length: fenceMatch[1].length };
			} else if (fence.marker === marker
				&& fenceMatch[1].length >= fence.length
				&& fenceMatch[2].trim().length === 0) {
				fence = undefined;
			}
			continue;
		}
		if (fence || !/^\s{0,3}\[[^\]\n]+\]:/.test(line)) {
			continue;
		}
		definitions.push(line);
		const title = lines[index + 1];
		if (title && /^\s{1,3}(?:["'(])/.test(title)) {
			definitions.push(title);
			index++;
		}
	}
	return definitions.join('\n');
}

export interface IBaseHalfCanvasNoteParts {
	/** Runs of whole top-level blocks. Joined, they are the body of the note. */
	readonly parts: readonly string[];
	/** The definitions of the note's reference links, rendered before every part. */
	readonly definitions: string;
}

/**
 * The source a part is rendered from. The definitions go before the part:
 * they show nothing there, and after it a block that runs to the end of its
 * input, such as an unclosed code block, would take them in.
 */
export function baseHalfCanvasNotePartSource(plan: IBaseHalfCanvasNoteParts, index: number): string {
	return plan.definitions ? `${plan.definitions}\n\n${plan.parts[index]}` : plan.parts[index];
}

/**
 * How many HTML elements are open after a block, given how many were open
 * before it. Only a block that starts with a tag opens or closes elements
 * across blocks; tags inside a paragraph close within it.
 */
function openHtmlElementsAfter(block: string, open: number): number {
	if (!/^ {0,3}</.test(block)) {
		return open;
	}
	const tags = block.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(?<close>\/?)(?<name>[A-Za-z][A-Za-z0-9-]*)\b[^<>]*?(?<selfClose>\/?)>/g);
	for (const tag of tags) {
		const name = tag.groups?.name?.toLowerCase() ?? '';
		if (VOID_HTML_ELEMENTS.has(name) || tag.groups?.selfClose) {
			continue;
		}
		open = tag.groups?.close ? Math.max(0, open - 1) : open + 1;
	}
	return open;
}

/**
 * Divides the body of a note into the parts its card builds one after the
 * other. A part ends only between two top-level blocks, after about
 * `partLength` characters, and not while an HTML element that a block opened
 * is still open, unless that has gone on for 50,000 characters. Built one
 * after the other, the parts show what the body shows when it is built whole.
 *
 * Returns undefined for a note with a block that no part can hold: the
 * renderer of the base would cut it.
 */
export function planBaseHalfCanvasNoteParts(body: string, partLength = BASEHALF_CANVAS_NOTE_PART_LENGTH): IBaseHalfCanvasNoteParts | undefined {
	const definitions = collectBaseHalfCanvasMarkdownReferenceDefinitions(body);
	const maxLength = Math.min(BLOCK_MAX_LENGTH, RENDERER_MAX_LENGTH - (definitions ? definitions.length + 2 : 0));
	const parts: string[] = [];
	let part = '';
	let open = 0;
	for (const segment of segmentBaseHalfMarkdownTopLevelBody(body)) {
		if (segment.raw.length > maxLength) {
			return undefined;
		}
		if (part.length + segment.raw.length > maxLength) {
			parts.push(part);
			part = '';
			open = 0;
		}
		part += segment.raw;
		open = openHtmlElementsAfter(segment.source, open);
		if (part.length >= partLength && (open === 0 || part.length >= OPEN_HTML_PART_LENGTH)) {
			parts.push(part);
			part = '';
			open = 0;
		}
	}
	if (part) {
		parts.push(part);
	}
	return { parts, definitions };
}

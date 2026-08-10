/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

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

export const BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES = 8192;

/**
 * Apply the Canvas inline boundary to the current source, not JavaScript's
 * UTF-16 code-unit length. File stat sizes and file-service read limits are
 * byte based, so a live TextModel must use the same UTF-8 measurement. Stop as
 * soon as the limit is exceeded instead of allocating an encoded copy of a
 * potentially very large document.
 */
export function baseHalfCanvasMarkdownSourceFitsInline(source: string): boolean {
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
		if (bytes > BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES) {
			return false;
		}
	}
	return true;
}

/**
 * Inline editing is only a valid transition when the Canvas already owns the
 * complete stored projection that remains underneath the editor. The file
 * size is a second, defensive boundary against stale preview metadata.
 */
export function baseHalfCanvasMarkdownEditTarget(
	fileSize: number | undefined,
	hasCompleteMarkdownPreview: boolean
): 'inline' | 'richDetail' {
	return hasCompleteMarkdownPreview
		&& (fileSize === undefined || fileSize <= BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES)
		? 'inline'
		: 'richDetail';
}

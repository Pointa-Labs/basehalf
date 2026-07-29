/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

const BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_BLOCKS = 200;
const BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_CHARACTERS = 4096;
const ELLIPSIS = '...';

/**
 * Preserve enough Markdown source for the card's own bounds to determine how
 * much is visible. The limits here are only a guard against excessive DOM work,
 * not a fixed visual line clamp.
 */
export function baseHalfCanvasMarkdownPreviewSource(raw: string): string {
	const lines = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
		.split('\n')
		.map(line => line.trimEnd())
		.filter(line => line.trim().length > 0);
	const previewLines = lines.slice(0, BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_BLOCKS);
	const preview = previewLines.join('\n');
	const blockSuffix = lines.length > previewLines.length ? `\n${ELLIPSIS}` : '';
	const maximumContentLength = BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_CHARACTERS - blockSuffix.length;

	if (preview.length > maximumContentLength) {
		return `${preview.slice(0, BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_CHARACTERS - ELLIPSIS.length)}${ELLIPSIS}`;
	}
	return `${preview}${blockSuffix}`;
}

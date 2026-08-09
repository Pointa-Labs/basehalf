/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

const BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_BLOCKS = 16;
const BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_CHARACTERS = 4096;
const ELLIPSIS = '...';

/**
 * Keep the static card preview bounded independently from canvas zoom. One
 * block is reserved for the truncation marker when source content exceeds the
 * budget.
 */
export function baseHalfCanvasMarkdownPreviewSource(raw: string): string {
	const lines = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
		.split('\n')
		.map(line => line.trimEnd());
	const contentLineCount = lines.reduce((count, line) => count + (line.trim().length > 0 ? 1 : 0), 0);
	const truncatedByBlockCount = contentLineCount > BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_BLOCKS;
	const contentBlockLimit = truncatedByBlockCount
		? BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_BLOCKS - 1
		: BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_BLOCKS;
	const previewLines: string[] = [];
	let includedContentLines = 0;
	for (const line of lines) {
		if (line.trim().length > 0) {
			if (includedContentLines >= contentBlockLimit) {
				break;
			}
			includedContentLines++;
		}
		previewLines.push(line);
	}
	while (previewLines.at(-1)?.trim().length === 0) {
		previewLines.pop();
	}
	const preview = previewLines.join('\n');
	const blockSuffix = truncatedByBlockCount ? `\n\n${ELLIPSIS}` : '';
	const maximumContentLength = BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_CHARACTERS - blockSuffix.length;

	if (preview.length > maximumContentLength) {
		return `${preview.slice(0, BASEHALF_CANVAS_MARKDOWN_PREVIEW_MAX_CHARACTERS - ELLIPSIS.length)}${ELLIPSIS}`;
	}
	return `${preview}${blockSuffix}`;
}

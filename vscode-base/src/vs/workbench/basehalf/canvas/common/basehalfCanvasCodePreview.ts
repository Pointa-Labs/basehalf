/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageIdCodec, ITokenizationSupport } from '../../../../editor/common/languages.js';
import { LineTokens } from '../../../../editor/common/tokens/lineTokens.js';
import { IBaseHalfCanvasCodePreview } from './basehalfCanvasCardPreview.js';

/** A line that long is a minified file: what is past it is far beyond any card's edge. */
const CODE_PREVIEW_LINE_LENGTH_LIMIT = 400;

/** The height of a line of a card's text: 12 px at a line height of 1.5. */
const CODE_PREVIEW_LINE_HEIGHT = 18;

/** A run of a line in one color, with the class of the editor's token stylesheet. */
export interface IBaseHalfCodePreviewPiece {
	readonly text: string;
	readonly className: string;
}

/**
 * The lines of a code file that its card can show, from the head the card read
 * (note rendering, rule 33): nothing is trimmed or skipped, as in the editor. A
 * head that a read cut off ends inside a line, perhaps inside a character, so
 * that line goes. Blank lines at the end show nothing.
 */
export function baseHalfCodePreviewLines(head: string, wholeFile: boolean): readonly string[] {
	const lines = head.replace(/\r\n?/g, '\n').split('\n');
	if (!wholeFile) {
		lines.pop();
	}
	while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
		lines.pop();
	}
	return lines.map(line => line.length > CODE_PREVIEW_LINE_LENGTH_LIMIT ? line.slice(0, CODE_PREVIEW_LINE_LENGTH_LIMIT) : line);
}

/** How many lines a card of this height can show, part of the last one included. */
export function baseHalfCodePreviewLinesFor(height: number): number {
	return Math.ceil(height / CODE_PREVIEW_LINE_HEIGHT) + 1;
}

/** The colored runs of the first `count` lines, as the editor colors them. */
export function baseHalfTokenizeCodePreview(
	lines: readonly string[],
	count: number,
	support: ITokenizationSupport,
	languageIdCodec: ILanguageIdCodec
): readonly (readonly IBaseHalfCodePreviewPiece[])[] {
	const result: IBaseHalfCodePreviewPiece[][] = [];
	let state = support.getInitialState();
	for (const line of lines.slice(0, count)) {
		const tokenized = support.tokenizeEncoded(line, true, state);
		LineTokens.convertToEndOffset(tokenized.tokens, line.length);
		const tokens = new LineTokens(tokenized.tokens, line, languageIdCodec).inflate();
		const pieces: IBaseHalfCodePreviewPiece[] = [];
		let start = 0;
		for (let index = 0, tokenCount = tokens.getCount(); index < tokenCount; index++) {
			const end = tokens.getEndOffset(index);
			const className = tokens.getClassName(index);
			const last = pieces[pieces.length - 1];
			if (last?.className === className) {
				pieces[pieces.length - 1] = { text: last.text + line.substring(start, end), className };
			} else if (end > start) {
				pieces.push({ text: line.substring(start, end), className });
			}
			start = end;
		}
		result.push(pieces);
		state = tokenized.endState;
	}
	return result;
}

/**
 * Keeps the colored lines of the previews that were drawn, so that a card that
 * is drawn again does not color them again. A preview goes with its card.
 */
export class BaseHalfCodePreviewTokens {
	private readonly tokenized = new WeakMap<IBaseHalfCanvasCodePreview, readonly (readonly IBaseHalfCodePreviewPiece[])[]>();

	constructor(
		private readonly languageIdCodec: ILanguageIdCodec,
		private readonly supportOf: (languageId: string) => ITokenizationSupport | null,
	) { }

	/** The first `count` lines of the preview in colors; nothing without a grammar for its language. */
	linesOf(preview: IBaseHalfCanvasCodePreview, count: number): readonly (readonly IBaseHalfCodePreviewPiece[])[] | undefined {
		if (!preview.languageId) {
			return undefined;
		}
		const wanted = Math.min(count, preview.lines.length);
		const known = this.tokenized.get(preview);
		if (known && known.length >= wanted) {
			return known;
		}
		const support = this.supportOf(preview.languageId);
		if (!support) {
			return undefined;
		}
		const lines = baseHalfTokenizeCodePreview(preview.lines, wanted, support, this.languageIdCodec);
		this.tokenized.set(preview, lines);
		return lines;
	}
}

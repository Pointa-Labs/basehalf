/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The lines a selection in a note is on (the selection agents can see). The
// rich Markdown webview imports this module, so it imports nothing.

/** Selected text longer than this many characters is cut in the record. */
export const BASEHALF_AGENT_SELECTION_TEXT_LIMIT = 10_000;

/** The first and last line of a block of a note's file, from 1. */
export interface IBaseHalfLineRange {
	readonly start: number;
	readonly end: number;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'' };

/**
 * A line of Markdown as close to the text it shows as a line can be read on
 * its own: a link or an image by its text, no HTML tags, entities decoded, no
 * marks and no white space.
 */
function shownText(line: string): string {
	return line
		.replace(/^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
		.replace(/<[^>]*>/g, '')
		.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => ENTITIES[name])
		.replace(/[\s*_`~[\]()#>|\\!<]/g, '');
}

/**
 * The lines of a selection. `first` and `last` are the lines of the blocks
 * that hold its two ends. The first line of the selected text is looked for,
 * as text that is shown, in the first block's lines, and its last line in the
 * last block's lines from there. One that is on exactly one line narrows that
 * end; otherwise the end stays at the block's edge, which holds the
 * selection whatever the Markdown.
 */
export function baseHalfSelectionLines(lineAt: (line: number) => string, first: IBaseHalfLineRange, last: IBaseHalfLineRange, selectedText: string): { readonly firstLine: number; readonly lastLine: number } {
	const shown = selectedText.split(/\r?\n/).map(shownText).filter(line => line.length > 0);
	const onlyLineWith = (probe: string | undefined, from: number, to: number): number | undefined => {
		if (!probe) {
			return undefined;
		}
		let found: number | undefined;
		for (let line = from; line <= to; line++) {
			if (shownText(lineAt(line)).includes(probe)) {
				if (found !== undefined) {
					return undefined;
				}
				found = line;
			}
		}
		return found;
	};
	const firstLine = onlyLineWith(shown[0], first.start, first.end) ?? first.start;
	const lastLine = onlyLineWith(shown[shown.length - 1], Math.max(firstLine, last.start), last.end) ?? last.end;
	return { firstLine, lastLine: Math.max(firstLine, lastLine) };
}

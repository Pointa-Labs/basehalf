/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlAttributes, type MarkdownActionHandler, type MarkdownRenderOptions } from '../../../../base/browser/markdownRenderer.js';
import { BASEHALF_NOTE_HTML_TAGS, baseHalfNoteMarkedExtension } from '../common/basehalfNoteMarkdownHtml.js';

// How a note is drawn where it is read (note formats, rules 81 and 57; note
// rendering, rules 1 to 6): the card at rest and Preview with the same rules,
// so that each shows what Rich wrote as Rich shows it.

let decoder: HTMLSpanElement | undefined;

/**
 * Decodes character references once, as the page does. The window takes
 * HTML from its sanitizer alone; given text without a tag, the sanitizer
 * hands back that text as the page reads it.
 */
function decodeAsThePageDoes(text: string): string {
	if (!text.includes('&')) {
		return text;
	}
	decoder ??= document.createElement('span');
	safeSetInnerHtml(decoder, text.replace(/</g, '&lt;'));
	return decoder.textContent ?? '';
}

/**
 * The options of the base renderer for a note: a single line break as a line
 * break; the note's extension, which shows a Markdown picture of a sound or a
 * video as that element, other HTML as written, and each link's address as
 * Rich reads it; the elements a note shows, a sound among them; and of the
 * attributes the base renderer keeps, also whether a toggle is open.
 */
export function baseHalfNoteRenderOptions(actionHandler?: MarkdownActionHandler): MarkdownRenderOptions {
	return {
		...(actionHandler ? { actionHandler } : {}),
		fillInIncompleteTokens: false,
		markedOptions: { gfm: true, breaks: true },
		markedExtensions: [baseHalfNoteMarkedExtension({ decodeCharacterReferences: decodeAsThePageDoes })],
		sanitizerConfig: {
			replaceWithPlaintext: true,
			allowedTags: { override: BASEHALF_NOTE_HTML_TAGS },
			allowedAttributes: {
				override: [
					...allowedMarkdownHtmlAttributes,
					{ attributeName: 'open', shouldKeep: element => element.tagName === 'DETAILS' },
				],
			},
		},
	};
}

/**
 * Takes the titles off a rendered note's links and pictures (rule 57): the
 * base renderer gives a link its address as a title, which would show the
 * whole path of a file as a system tooltip.
 */
export function removeBaseHalfNoteLinkTitles(element: HTMLElement): void {
	// The links and pictures are drawn by the note's renderer, not built here.
	// eslint-disable-next-line no-restricted-syntax
	for (const titled of Array.from(element.querySelectorAll('a[title], img[title]'))) {
		titled.removeAttribute('title');
	}
}

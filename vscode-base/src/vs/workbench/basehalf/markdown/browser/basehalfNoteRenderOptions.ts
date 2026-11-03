/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfNoteRendering.css';
import { $ } from '../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlAttributes, type MarkdownActionHandler, type MarkdownRenderOptions } from '../../../../base/browser/markdownRenderer.js';
import { URI } from '../../../../base/common/uri.js';
import { baseHalfNoteLinkHref } from '../common/basehalfNoteLinks.js';
import { BASEHALF_NOTE_FILE_ICON_PATH, BASEHALF_NOTE_FILE_LINK_TITLE, BASEHALF_NOTE_HTML_TAGS, baseHalfNoteMarkedExtension } from '../common/basehalfNoteMarkdownHtml.js';

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

export interface IBaseHalfNoteRenderOptions {
	/** The note drawn: a link's path is the absolute address of what it names from the note's folder. */
	readonly note?: URI;
	/** What a click on a link does: the note's link router. */
	readonly actionHandler?: MarkdownActionHandler;
}

/**
 * The options of the base renderer for a note: a single line break as a line
 * break; the note's extension, which shows a Markdown picture of a sound or a
 * video as that element, other HTML as written, and each link to the address
 * of what it names, read once; the elements a note shows, a sound among
 * them; and of the attributes the base renderer keeps, also whether a toggle
 * is open.
 */
export function baseHalfNoteRenderOptions(options: IBaseHalfNoteRenderOptions = {}): MarkdownRenderOptions {
	const { note, actionHandler } = options;
	return {
		...(actionHandler ? { actionHandler } : {}),
		fillInIncompleteTokens: false,
		markedOptions: { gfm: true, breaks: true },
		markedExtensions: [baseHalfNoteMarkedExtension({
			decodeCharacterReferences: decodeAsThePageDoes,
			...(note ? { resolveLink: (href: string) => baseHalfNoteLinkHref(note, href) } : {}),
		})],
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
 * Finishes a rendered note. A paragraph that Rich shows as a file block is
 * drawn as Rich draws one, the file's icon and its name in a box, and stays
 * the link it is, so that a click opens the file (note formats, rule 81).
 * The titles come off the note's links and pictures (rule 57): the base
 * renderer gives a link its address as a title, which would show the whole
 * path of a file as a system tooltip.
 */
export function finishBaseHalfNoteRendering(element: HTMLElement): void {
	// The links and pictures are drawn by the note's renderer, not built here.
	// eslint-disable-next-line no-restricted-syntax
	for (const link of Array.from(element.querySelectorAll(`a[title="${BASEHALF_NOTE_FILE_LINK_TITLE}"]`))) {
		link.classList.add('bh-md-file');
		link.prepend($.SVG('svg', { class: 'bh-md-file-icon', viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, $.SVG('path', { d: BASEHALF_NOTE_FILE_ICON_PATH })));
	}
	// eslint-disable-next-line no-restricted-syntax
	for (const titled of Array.from(element.querySelectorAll('a[title], img[title]'))) {
		titled.removeAttribute('title');
	}
}

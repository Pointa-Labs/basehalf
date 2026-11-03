/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { baseHalfNoteMediaKind } from '../common/basehalfNoteMediaKind.js';
import { baseHalfNotePaletteAlias, BaseHalfNotePaletteColor, BaseHalfNotePaletteRole, parseBaseHalfNoteSpanStyle } from '../common/basehalfNotePalette.js';
import type { BaseHalfNoteReadMode } from '../common/basehalfNoteStructure.js';

// This module is compiled into the rich editor's webview, whose type check
// follows every import, so it imports only the plain modules of the note's
// formats. It works on a fragment of any document, such as a template's,
// and creates its nodes in that document.
//
// Rich reads a note as its card does (note formats, rule 25): the card's
// reader writes the note's HTML, and the rich editor reads blocks from it.
// The HTML of the card and the HTML the editor reads differ in a few places,
// which this module mends before the editor reads it (design B1, steps 2 and
// 3): where the editor would read a format the card does not show, or not
// read one it shows, or read the page's address of a picture in place of
// the note's.

const textNode = 3;
const elementNode = 1;

/** The elements under `root`, in the order of the document. */
function elementsOf(root: ParentNode): Element[] {
	const elements: Element[] = [];
	const visit = (parent: ParentNode) => {
		for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
			elements.push(child);
			visit(child);
		}
	};
	visit(root);
	return elements;
}

/** The text nodes under `root`, in the order of the document. */
function textNodesOf(root: Node): Text[] {
	const texts: Text[] = [];
	const visit = (parent: Node) => {
		for (let child = parent.firstChild; child; child = child.nextSibling) {
			if (child.nodeType === textNode) {
				texts.push(child as Text);
			} else {
				visit(child);
			}
		}
	};
	visit(root);
	return texts;
}

function isTag(node: Node | null | undefined, ...names: string[]): boolean {
	return node?.nodeType === elementNode && names.includes((node as Element).tagName.toLowerCase());
}

function inCode(node: Node): boolean {
	return !!node.parentElement?.closest('pre, code');
}

interface IStyledElement extends Element {
	readonly style: CSSStyleDeclaration;
}

function isStyled(element: Element): element is IStyledElement {
	return typeof (element as Partial<IStyledElement>).style?.getPropertyValue === 'function';
}

/** Puts the children of `element` in its place. */
function unwrap(element: Element): void {
	element.replaceWith(...Array.from(element.childNodes));
}

// --- Tidy: the card's HTML as the editor reads it (design B1, step 2)

const mediaTags = ['img', 'video', 'audio', 'figure'];

// White space that stands between inline content, which a page shows as a
// space; any other is between blocks, where a page shows nothing.
const blockTags: ReadonlySet<string> = new Set([
	'address', 'article', 'aside', 'audio', 'blockquote', 'caption', 'col', 'colgroup', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
	'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav',
	'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'video'
]);

function isInline(node: Node | null): boolean {
	if (!node) {
		return false;
	}
	return node.nodeType === textNode || (node.nodeType === elementNode && !blockTags.has((node as Element).tagName.toLowerCase()));
}

const asciiWhiteSpace = /^[ \t\n\f\r]*$/;

/** A text node of white space alone, which a page shows as no more than a space between words. */
function isBlankText(node: Node): boolean {
	return node.nodeType === textNode && asciiWhiteSpace.test((node as Text).data);
}

/**
 * A paragraph that holds a picture, a video, a sound, or a figure alone is
 * that block: the card's reader writes a Markdown picture in a paragraph of
 * its own, which the editor would read as a paragraph around it.
 */
function unwrapLoneMedia(fragment: DocumentFragment): void {
	for (const paragraph of elementsOf(fragment)) {
		if (!isTag(paragraph, 'p')) {
			continue;
		}
		const shown = Array.from(paragraph.childNodes).filter(child => !isBlankText(child));
		if (shown.length === 1 && isTag(shown[0], ...mediaTags)) {
			paragraph.replaceWith(shown[0]);
		}
	}
}

/** The card's reader ends the text of code with a line break, which a page does not show and the editor would keep. */
function removeFinalCodeLineBreaks(fragment: DocumentFragment): void {
	for (const code of elementsOf(fragment)) {
		if (!isTag(code, 'code') || !isTag(code.parentElement, 'pre')) {
			continue;
		}
		const texts = textNodesOf(code);
		const last = texts[texts.length - 1];
		if (last?.data.endsWith('\n')) {
			last.data = last.data.slice(0, -1);
			if (last.data === '') {
				last.remove();
			}
		}
	}
}

/**
 * White space with a line break between blocks, which the card's reader
 * writes between the elements it writes, and which the editor would read as
 * text. Code keeps its white space, and white space between inline content
 * is a space on the card.
 */
function removeWhiteSpaceBetweenBlocks(fragment: DocumentFragment): void {
	for (const text of textNodesOf(fragment)) {
		if (!text.data.includes('\n') || !asciiWhiteSpace.test(text.data) || inCode(text)) {
			continue;
		}
		if (!isInline(text.previousSibling) || !isInline(text.nextSibling)) {
			text.remove();
		}
	}
}

const leadingLineBreak = /^[ \t\f\r]*\n[ \t\n\f\r]*/;
const trailingLineBreak = /[ \t\n\f\r]*\n[ \t\f\r]*$/;

/**
 * White space with a line break at the start or the end of text beside a
 * block shows nothing on the card; the card's reader writes it where a
 * paragraph follows a block of HTML or code in a tight list item. The editor
 * would make one space of every run of white space in a text that holds a
 * line break, of a tab in it too. In an inline element it is a space.
 */
function removeLineBreaksBesideBlocks(fragment: DocumentFragment): void {
	for (const text of textNodesOf(fragment)) {
		const parent = text.parentNode;
		if (!text.data.includes('\n') || inCode(text) || (parent?.nodeType === elementNode && !isBlock(parent))) {
			continue;
		}
		if (!text.previousSibling || isBlock(text.previousSibling)) {
			text.data = text.data.replace(leadingLineBreak, '');
		}
		if (!text.nextSibling || isBlock(text.nextSibling)) {
			text.data = text.data.replace(trailingLineBreak, '');
		}
		if (text.data === '') {
			text.remove();
		}
	}
}

const leadingAsciiWhiteSpace = /^[ \t\n\f\r]+/;

/**
 * The card's reader writes white space after the box of a check item, which
 * the editor would read as the start of the item's text: a space in the
 * item, or a space and a line break in the first paragraph of a loose item.
 */
function removeSpaceAfterTaskBoxes(fragment: DocumentFragment): void {
	for (const box of elementsOf(fragment)) {
		if (!isTag(box, 'input') || box.getAttribute('type')?.toLowerCase() !== 'checkbox' || box.previousSibling !== null) {
			continue;
		}
		const parent = box.parentElement;
		const item = isTag(parent, 'p') ? parent?.parentElement : parent;
		const inItem = isTag(item, 'li') && (item === parent || item?.firstElementChild === parent);
		const after = box.nextSibling;
		if (!inItem || after?.nodeType !== textNode) {
			continue;
		}
		const text = after as Text;
		text.data = text.data.replace(leadingAsciiWhiteSpace, '');
		if (text.data === '') {
			text.remove();
		}
	}
}

/** Text and inline elements, which a list item's own text and a cell are made of; a picture, a video, or a sound is a block of the editor's. */
function isInlineText(node: Node): boolean {
	return isInline(node) && !isTag(node, 'img', 'video', 'audio');
}

function showsText(nodes: readonly Node[]): boolean {
	return nodes.some(node => !isBlankText(node));
}

/** Puts `nodes`, children of one element, into a new `<p>` in their place. */
function wrapInParagraph(nodes: readonly Node[]): void {
	const first = nodes[0];
	const paragraph = first.ownerDocument!.createElement('p');
	first.parentNode!.insertBefore(paragraph, first);
	paragraph.append(...nodes);
}

/**
 * The text of a tight list item and of a cell is a paragraph, as the card's
 * reader writes the text of a loose item: the editor keeps the white space of
 * a paragraph as written, and would drop a space after a code span or
 * collapse the spaces in one in a list item's or a cell's text. So is each
 * other run of text in a list item: a paragraph that the card's reader writes
 * without its element after a block of HTML or code, which a tight item can
 * hold.
 */
function wrapTextOfItemsAndCells(fragment: DocumentFragment): void {
	for (const element of elementsOf(fragment)) {
		if (isTag(element, 'li')) {
			let run: Node[] = [];
			const wrapRun = () => {
				if (showsText(run)) {
					wrapInParagraph(run);
				}
				run = [];
			};
			for (const node of Array.from(element.childNodes)) {
				if (isInlineText(node)) {
					run.push(node);
				} else {
					wrapRun();
				}
			}
			wrapRun();
		} else if (isTag(element, 'td', 'th')) {
			const nodes = Array.from(element.childNodes);
			if (nodes.every(isInlineText) && showsText(nodes)) {
				wrapInParagraph(nodes);
			}
		}
	}
}

function isBlock(node: Node): boolean {
	return node.nodeType === elementNode && blockTags.has((node as Element).tagName.toLowerCase());
}

/** Whether no text or inline element follows `node` on its line: its block ends after it, or a block follows it. */
function endsItsLine(node: Node): boolean {
	for (let current: Node | null = node; current && !(current !== node && isBlock(current)); current = current.parentNode) {
		for (let next = current.nextSibling; next; next = next.nextSibling) {
			if (isBlock(next)) {
				return true;
			}
			if (!isBlankText(next)) {
				return false;
			}
		}
	}
	return true;
}

/**
 * A line break that ends a block's text, or the text before a block, shows
 * nothing on the card, where the line ends there anyway; the editor would
 * show an empty line after it. Of several, the last goes, and the others
 * show their empty lines.
 */
function removeLineBreaksThatEndLines(fragment: DocumentFragment): void {
	const ending = elementsOf(fragment).filter(element => isTag(element, 'br') && !inCode(element) && endsItsLine(element));
	for (const lineBreak of ending) {
		lineBreak.remove();
	}
}

/**
 * Mends the HTML that the card's reader writes of a note
 * (`baseHalfNoteMarkdownToHtml` for reading) where the rich editor would read
 * it otherwise than the card shows it (design B1, step 2): the line break
 * that ends code goes; white space with a line break between blocks, and at
 * the edges of text beside a block, goes; a line break that ends a line
 * goes, which the card does not show; a paragraph that holds only a picture,
 * a video, a sound, or a figure is that element; the space after the box of
 * a check item goes; and each run of text of a list item and the text of a
 * cell is a paragraph, whose white space the editor keeps.
 */
export function tidyBaseHalfNoteHtml(fragment: DocumentFragment): void {
	removeFinalCodeLineBreaks(fragment);
	removeWhiteSpaceBetweenBlocks(fragment);
	removeLineBreaksBesideBlocks(fragment);
	removeLineBreaksThatEndLines(fragment);
	unwrapLoneMedia(fragment);
	removeSpaceAfterTaskBoxes(fragment);
	wrapTextOfItemsAndCells(fragment);
}

// --- Repair (design B1, step 3)

export interface IBaseHalfNoteHtmlRepair {
	/**
	 * Whether each `<details>` is open, in the order of the document, for the
	 * reader's block pass (`postProcessBaseHalfNoteBlocks`). A paste stores
	 * every toggle closed (note formats, rule 40), so it passes none on.
	 */
	readonly openFlags: readonly boolean[];
}

/** Whether a fragment holds text a page shows, or a picture, a video, a sound, or a line break. */
function holdsMoreThanWhiteSpace(node: Node): boolean {
	return textNodesOf(node).some(text => !asciiWhiteSpace.test(text.data)) || elementsOf(node as ParentNode).some(element => isTag(element, 'img', 'video', 'audio', 'br', 'input', 'hr'));
}

/**
 * A picture, a video, or a sound among the text of a pasted line is a block of
 * its own, between the line's text before it and after it (note formats, rule
 * 72): the editor holds none in a line of text, and would drop it.
 */
function liftMediaOutOfPastedLines(fragment: DocumentFragment): void {
	for (const line of elementsOf(fragment)) {
		if (!isTag(line, 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6') || inCode(line)) {
			continue;
		}
		// A picture inside a video or a sound is what shows where they cannot play, and goes with them.
		const media = elementsOf(line).filter(element => isTag(element, 'img', 'video', 'audio') && !element.parentElement?.closest('video, audio'));
		for (const element of media) {
			const before = line.ownerDocument.createRange();
			before.setStart(line, 0);
			before.setEndBefore(element);
			const head = line.cloneNode(false) as Element;
			head.append(before.extractContents());
			if (holdsMoreThanWhiteSpace(head)) {
				line.before(head);
			}
			line.before(element);
		}
		if (media.length > 0 && !holdsMoreThanWhiteSpace(line)) {
			line.remove();
		}
	}
}

/**
 * Pasted HTML shows a picture of a video or a sound as that video or sound,
 * by the one list of media files (note formats, rules 26 and 72). A note's
 * Markdown already does through the note's extension, and a hand-written
 * `<img>` of a video stays a picture there, as the card shows it.
 */
function showPastedMediaOfItsKind(fragment: DocumentFragment): void {
	for (const element of elementsOf(fragment)) {
		if (!isTag(element, 'img', 'video')) {
			continue;
		}
		const src = element.getAttribute('src');
		const kind = src === null ? undefined : baseHalfNoteMediaKind(src);
		const tag = element.tagName.toLowerCase();
		if ((kind !== 'video' || tag !== 'img') && (kind !== 'audio')) {
			continue;
		}
		const player = element.ownerDocument.createElement(kind);
		for (const attribute of Array.from(element.attributes)) {
			if (attribute.name !== 'alt' && !(kind === 'audio' && attribute.name === 'width')) {
				player.setAttribute(attribute.name, attribute.value);
			}
		}
		player.setAttribute('controls', '');
		element.replaceWith(player);
	}
}

const wholeWidth = /^[1-9][0-9]{0,4}$/;

/**
 * Every picture, video, and sound keeps the address the note has (note
 * formats, rule 27): the editor reads an element's address from the page,
 * which makes a relative address absolute where it copies the element, as
 * in a list item or a toggle, and `data-url` takes its place. A width that
 * is a whole number of pixels from 1 to 99,999 is the block's width, and no
 * other width is (rule 28). A paste keeps the width of Rich's own HTML alone
 * (rule 72), which carries `data-url` already.
 */
function keepMediaAddresses(fragment: DocumentFragment, mode: BaseHalfNoteReadMode): void {
	for (const element of elementsOf(fragment)) {
		if (!isTag(element, 'img', 'video', 'audio')) {
			continue;
		}
		const fromRich = element.closest('[data-url]') !== null;
		// The editor reads a figure's block from the figure.
		const figure = element.closest('figure');
		const src = element.getAttribute('src');
		if (src !== null) {
			element.setAttribute('data-url', src);
			figure?.setAttribute('data-url', src);
		}
		const width = element.getAttribute('width');
		if (width === null) {
			continue;
		}
		if (wholeWidth.test(width) && !isTag(element, 'audio') && (mode === 'markdown' || fromRich)) {
			element.setAttribute('data-preview-width', width);
			figure?.setAttribute('data-preview-width', width);
		} else {
			element.removeAttribute('width');
			element.removeAttribute('data-preview-width');
		}
	}
}

// The blocks that the card's reader writes in a list item without text.
const childBlockTags = ['ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'details', 'hr', 'figure', 'img', 'video', 'audio'];

/**
 * The blocks a list item holds after its own text are its children, in their
 * order (note formats, rule 31), in the form the editor gives an item and the
 * lists after it: the item with its own text alone, then a group of the
 * children. Left in the item, a list among other blocks would be moved out
 * after the item, a toggle would make the item a toggle, and a check box of a
 * child would make the item a check item. An item without text holds every
 * block in it that the card's reader writes there, a block of Markdown or a
 * picture, a video, or a sound: the editor would read the item as its first
 * block, a list's items as the item's own, and a heading's, a quote's, or
 * code's text as the item's text. Any other element that starts an item, as
 * the `<div>` of an item that another application pasted, holds its text.
 */
function holdChildrenOfListItems(fragment: DocumentFragment): void {
	for (const item of elementsOf(fragment)) {
		if (!isTag(item, 'li')) {
			continue;
		}
		const nodes = Array.from(item.childNodes);
		let end = 0;
		while (end < nodes.length && isInlineText(nodes[end])) {
			end++;
		}
		if (!showsText(nodes.slice(0, end))) {
			if (isTag(nodes[end], 'p')) {
				// An item whose text is a paragraph of its own, as the card's reader writes a loose item.
				end++;
			} else if (!isTag(nodes[end], ...childBlockTags)) {
				continue;
			}
		}
		// White space between them stays: between two inline elements it is a space.
		const children = nodes.slice(end);
		if (!showsText(children)) {
			continue;
		}
		const document = item.ownerDocument;
		const wrapper = document.createElement('div');
		const group = document.createElement('div');
		group.setAttribute('data-node-type', 'blockGroup');
		item.replaceWith(wrapper);
		group.append(...children);
		wrapper.append(item, group);
	}
}

/**
 * A caption is one line of text in the editor, which reads it as the text of
 * its element (note formats, rule 16): a line break in it is a space there,
 * where `<br>` would add nothing and the words on either side of it would
 * run together. The editor makes a space of a line ending in it too.
 */
function spaceLineBreaksOfCaptions(fragment: DocumentFragment): void {
	for (const lineBreak of elementsOf(fragment)) {
		if (isTag(lineBreak, 'br') && lineBreak.closest('figcaption')) {
			lineBreak.replaceWith(lineBreak.ownerDocument.createTextNode(' '));
		}
	}
}

/** The columns of a row, a cell spanning columns counting each. */
function columnsOf(row: Element): number {
	let columns = 0;
	for (const cell of Array.from(row.children)) {
		if (isTag(cell, 'td', 'th')) {
			const span = Number(cell.getAttribute('colspan'));
			columns += Number.isInteger(span) && span > 1 ? Math.min(span, 1000) : 1;
		}
	}
	return columns;
}

/**
 * The alignment of a column is that of each of its cells, which the editor
 * reads from `data-text-alignment` alone (note formats, rule 30): from the
 * `align` that the card's reader writes, and in pasted HTML also from a
 * cell's `text-align`, which the block pass makes its column's (rule 72). A
 * table pasted without a header cell gets an empty header row, so that its
 * rows stay rows (rule 58).
 */
function readColumnAlignments(fragment: DocumentFragment, mode: BaseHalfNoteReadMode): void {
	const elements = elementsOf(fragment);
	for (const cell of elements) {
		if (!isTag(cell, 'td', 'th')) {
			continue;
		}
		const styled = isStyled(cell) ? cell.style.getPropertyValue('text-align') : '';
		const alignment = cell.getAttribute('align') ?? (styled || null);
		if (alignment !== null) {
			cell.setAttribute('data-text-alignment', alignment.trim().toLowerCase());
			cell.removeAttribute('align');
		}
	}
	if (mode === 'markdown') {
		return;
	}
	for (const table of elements) {
		if (!isTag(table, 'table') || elementsOf(table).some(cell => isTag(cell, 'th'))) {
			continue;
		}
		const firstRow = elementsOf(table).find(row => isTag(row, 'tr'));
		if (!firstRow) {
			continue;
		}
		const document = table.ownerDocument;
		const head = document.createElement('thead');
		const row = document.createElement('tr');
		for (let column = columnsOf(firstRow); column > 0; column--) {
			row.append(document.createElement('th'));
		}
		head.append(row);
		table.prepend(head);
	}
}

/** Whether each `<details>` is open, in the order of the document. */
function openFlagsOf(fragment: DocumentFragment): boolean[] {
	return elementsOf(fragment).filter(element => isTag(element, 'details')).map(details => details.hasAttribute('open'));
}

/** The span of the editor's color of text or background, which holds the editor's palette name. */
function colorSpan(document: Document, role: BaseHalfNotePaletteRole, color: BaseHalfNotePaletteColor): HTMLSpanElement {
	const span = document.createElement('span');
	span.setAttribute('data-style-type', role === 'text' ? 'textColor' : 'backgroundColor');
	span.setAttribute('data-value', color);
	return span;
}

/** Wraps the children of `element` in the editor's spans of the colors. */
function wrapChildrenInColors(element: Element, textColor: BaseHalfNotePaletteColor | undefined, backgroundColor: BaseHalfNotePaletteColor | undefined): void {
	let inner = element;
	for (const [role, color] of [['text', textColor], ['background', backgroundColor]] as const) {
		if (!color) {
			continue;
		}
		const span = colorSpan(element.ownerDocument, role, color);
		span.append(...Array.from(inner.childNodes));
		inner.append(span);
		inner = span;
	}
}

/**
 * A span of a palette color in the stored spelling is that color, in the
 * editor's own spans, which hold its palette name (note formats, rule 29);
 * the editor would read the value of any other color as a color of its own.
 * Any other style of a span goes, so that a block holding it shows the loss
 * and stays fixed. In a paste, a color that is one of the palette's aliases
 * is that palette color, and any other color goes (rule 72); the span keeps
 * its other styles, such as a weight.
 */
function readPaletteColors(fragment: DocumentFragment, mode: BaseHalfNoteReadMode): void {
	for (const span of elementsOf(fragment)) {
		if (!isTag(span, 'span') || !span.hasAttribute('style')) {
			continue;
		}
		if (mode === 'markdown') {
			const colors = parseBaseHalfNoteSpanStyle(span.getAttribute('style') ?? '');
			span.removeAttribute('style');
			if (colors) {
				wrapChildrenInColors(span, colors.textColor, colors.backgroundColor);
			}
			continue;
		}
		if (!isStyled(span)) {
			continue;
		}
		const textColor = baseHalfNotePaletteAlias('text', span.style.getPropertyValue('color'));
		const backgroundColor = baseHalfNotePaletteAlias('background', span.style.getPropertyValue('background-color'));
		for (const property of ['color', 'background-color', 'background']) {
			span.style.removeProperty(property);
		}
		if ((span.getAttribute('style') ?? '').trim() === '') {
			span.removeAttribute('style');
		}
		wrapChildrenInColors(span, textColor, backgroundColor);
	}
}

/** Whether an element underlines what it holds, as the editor reads underline: `<u>`, or a `text-decoration` with `underline`. */
function underlines(element: Element): boolean {
	return isTag(element, 'u') || (isStyled(element) && /\bunderline\b/i.test(element.style.getPropertyValue('text-decoration')));
}

function removeUnderline(element: Element): void {
	if (isTag(element, 'u')) {
		unwrap(element);
		return;
	}
	if (!isStyled(element)) {
		return;
	}
	const decoration = element.style.getPropertyValue('text-decoration').replace(/\bunderline\b/gi, '').replace(/\s+/g, ' ').trim();
	if (decoration === '' || decoration === 'none') {
		element.style.removeProperty('text-decoration');
	} else {
		element.style.setProperty('text-decoration', decoration);
	}
	if ((element.getAttribute('style') ?? '').trim() === '') {
		element.removeAttribute('style');
	}
}

/** Whether a fragment holds anything a page shows. */
function showsAnything(node: Node): boolean {
	return textNodesOf(node).some(text => text.data !== '') || elementsOf(node as ParentNode).some(element => isTag(element, 'img', 'video', 'audio', 'br', 'input', 'hr'));
}

/**
 * Takes `target` out of the underline of `ancestor`: what the ancestor holds
 * before and after the target stays underlined in copies of it, and the
 * target keeps every other element around it.
 */
function liftOutOfUnderline(ancestor: Element, target: Element): void {
	const document = ancestor.ownerDocument;
	const before = document.createRange();
	before.setStart(ancestor, 0);
	before.setEndBefore(target);
	const after = document.createRange();
	after.setStartAfter(target);
	after.setEnd(ancestor, ancestor.childNodes.length);
	const head = before.extractContents();
	const tail = after.extractContents();
	if (showsAnything(head)) {
		const copy = ancestor.cloneNode(false) as Element;
		copy.append(head);
		ancestor.before(copy);
	}
	if (showsAnything(tail)) {
		const copy = ancestor.cloneNode(false) as Element;
		copy.append(tail);
		ancestor.after(copy);
	}
	removeUnderline(ancestor);
}

/**
 * A link is underlined where it is drawn, so a page that is copied often
 * underlines a link's text; a paste drops an underline over the whole text
 * of a link and keeps one over a part of it (note formats, rule 72).
 */
function removeUnderlineOfWholeLinks(fragment: DocumentFragment): void {
	for (const link of elementsOf(fragment)) {
		if (!isTag(link, 'a')) {
			continue;
		}
		const texts = textNodesOf(link).filter(text => text.data.trim() !== '');
		const underlined = (text: Text) => {
			for (let element = text.parentElement; element; element = element.parentElement) {
				if (underlines(element)) {
					return true;
				}
			}
			return false;
		};
		if (texts.length === 0 || !texts.every(underlined)) {
			continue;
		}
		for (const element of elementsOf(link).reverse()) {
			if (underlines(element)) {
				removeUnderline(element);
			}
		}
		if (underlines(link)) {
			removeUnderline(link);
		}
		const ancestors: Element[] = [];
		for (let element = link.parentElement; element; element = element.parentElement) {
			ancestors.push(element);
		}
		for (const ancestor of ancestors) {
			if (underlines(ancestor)) {
				liftOutOfUnderline(ancestor, link);
			}
		}
	}
}

/**
 * Mends HTML before the rich editor reads blocks from it (design B1, step 3),
 * in place, for a note's Markdown as `tidyBaseHalfNoteHtml` left it
 * (`markdown`), or for HTML pasted or dropped from another application
 * (`paste`, `drop`):
 *
 * - a. (`paste`, `drop`) a picture of a video or a sound is that video or
 *   sound, and a video of a sound is that sound;
 * - b. every picture, video, and sound, and its figure, keeps its address as
 *   written in `data-url`; a width that is a whole number of pixels from 1 to
 *   99,999 is the block's width, and any other width goes; a paste keeps the
 *   width of Rich's own HTML alone; a line break in a caption is a space, as
 *   in its one line;
 * - c. and d. the blocks a list item holds after its own text are its
 *   children, in their order, a toggle and a check item among them, and an
 *   item without text holds every block in it;
 * - e. the alignment of a cell is its column's; (`paste`, `drop`) a table
 *   without a header cell gets an empty header row;
 * - f. whether each `<details>` is open is returned, in the order of the
 *   document;
 * - g. a span of a palette color is that color in the editor's spans, and
 *   any other style of a span goes; (`paste`, `drop`) an alias of a palette
 *   color is that color, and any other color goes;
 * - h. (`paste`, `drop`) an underline over the whole text of a link goes.
 */
export function repairBaseHalfNoteHtml(fragment: DocumentFragment, mode: BaseHalfNoteReadMode): IBaseHalfNoteHtmlRepair {
	if (mode !== 'markdown') {
		liftMediaOutOfPastedLines(fragment);
		showPastedMediaOfItsKind(fragment);
	}
	keepMediaAddresses(fragment, mode);
	spaceLineBreaksOfCaptions(fragment);
	holdChildrenOfListItems(fragment);
	readColumnAlignments(fragment, mode);
	const openFlags = openFlagsOf(fragment);
	readPaletteColors(fragment, mode);
	if (mode !== 'markdown') {
		removeUnderlineOfWholeLinks(fragment);
	}
	return { openFlags };
}

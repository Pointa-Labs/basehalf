/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Where the comments of a book stand in its sections (comments, "Finding the
// passage"): a comment's quote is found in the text of each section as the
// reader opens it, and the passage is drawn by the section's overlay.

import { baseHalfCommentContext, findBaseHalfCommentQuote } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentAnchor.js';
import { isBaseHalfHighlight, type BaseHalfCommentColor, type IBaseHalfComment } from '../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';

const BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'DT', 'DD', 'FIGCAPTION', 'BR']);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

interface ISegment {
	readonly start: number;
	readonly length: number;
	/** Null for a line break between two blocks, which the document holds no character for. */
	readonly node: Text | null;
}

/**
 * The text of a section as a quote reads it, with a line break between
 * blocks, and the text node of each of its characters.
 */
export class SectionText {
	readonly text: string;
	private readonly segments: ISegment[] = [];

	constructor(doc: Document) {
		let text = '';
		let lastBlock: Element | null | undefined;
		const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.nodeType === Node.ELEMENT_NODE) {
				const element = node as Element;
				if (element.tagName === 'BR') {
					this.segments.push({ start: text.length, length: 1, node: null });
					text += '\n';
				}
				continue;
			}
			const textNode = node as Text;
			if (!textNode.data || hasAncestor(textNode, SKIPPED)) {
				continue;
			}
			const block = blockOf(textNode);
			if (lastBlock !== undefined && block !== lastBlock && text && !text.endsWith('\n')) {
				this.segments.push({ start: text.length, length: 1, node: null });
				text += '\n';
			}
			lastBlock = block;
			this.segments.push({ start: text.length, length: textNode.data.length, node: textNode });
			text += textNode.data;
		}
		this.text = text;
	}

	/** The range of the characters from `start` to before `end`. */
	range(doc: Document, start: number, end: number): Range | undefined {
		const from = this.point(start, false);
		const to = this.point(end, true);
		if (!from || !to) {
			return undefined;
		}
		const range = doc.createRange();
		range.setStart(from.node, from.offset);
		range.setEnd(to.node, to.offset);
		return range;
	}

	/** The place in the text of a boundary of a range, when it is in a text node. */
	offsetOf(node: Node, offset: number): number | undefined {
		for (const segment of this.segments) {
			if (segment.node === node) {
				return segment.start + Math.min(offset, segment.length);
			}
		}
		return undefined;
	}

	private point(index: number, isEnd: boolean): { readonly node: Text; readonly offset: number } | undefined {
		for (let position = 0; position < this.segments.length; position++) {
			const segment = this.segments[position];
			const inside = isEnd ? index > segment.start && index <= segment.start + segment.length : index >= segment.start && index < segment.start + segment.length;
			if (!inside) {
				continue;
			}
			if (segment.node) {
				return { node: segment.node, offset: index - segment.start };
			}
			// A line break between blocks: the end of the text before it, or the start of the text after it.
			const neighbour = isEnd ? this.segments.slice(0, position).reverse().find(candidate => candidate.node) : this.segments.slice(position + 1).find(candidate => candidate.node);
			return neighbour?.node ? { node: neighbour.node, offset: isEnd ? neighbour.length : 0 } : undefined;
		}
		return undefined;
	}
}

function hasAncestor(node: Node, tags: ReadonlySet<string>): boolean {
	for (let parent = node.parentElement; parent; parent = parent.parentElement) {
		if (tags.has(parent.tagName)) {
			return true;
		}
	}
	return false;
}

function blockOf(node: Node): Element | null {
	for (let parent = node.parentElement; parent; parent = parent.parentElement) {
		if (BLOCKS.has(parent.tagName.toUpperCase())) {
			return parent;
		}
	}
	return null;
}

/** Finds a comment's passage in a section, as a range of the section's document. */
export function findInSection(doc: Document, text: SectionText, comment: IBaseHalfComment): Range | undefined {
	if (!comment.quote) {
		return undefined;
	}
	const match = findBaseHalfCommentQuote(text.text, comment.quote, comment.before, comment.after);
	return match ? text.range(doc, match.start, match.end) : undefined;
}

/** The text around a passage that a new comment keeps. */
export function contextInSection(text: SectionText, range: Range): { readonly before?: string; readonly after?: string } {
	const start = text.offsetOf(range.startContainer, range.startOffset);
	const end = text.offsetOf(range.endContainer, range.endOffset);
	return start === undefined || end === undefined ? {} : baseHalfCommentContext(text.text, start, end);
}

const SVG = 'http://www.w3.org/2000/svg';

/** The colors of comments, as the reader's stylesheet has them: the overlay of a section stands where that stylesheet does not reach. */
const COLORS: Record<BaseHalfCommentColor, string> = {
	yellow: '#e8b923',
	green: '#3fae6a',
	blue: '#3b8fe6',
	pink: '#e2558c',
	purple: '#8d63da'
};

/**
 * How the overlay of a section draws a comment: its passage tinted in its
 * color, under its text on a light page and over it on a dark one, and a
 * mark just after its end when it has words (comments, rules 6 and 7).
 */
export function drawComment(rects: DOMRectList | readonly DOMRect[], options: { readonly comment?: IBaseHalfComment; readonly dark?: boolean } = {}): SVGElement {
	const color = COLORS[options.comment?.color ?? 'yellow'];
	const group = document.createElementNS(SVG, 'g');
	const tints = document.createElementNS(SVG, 'g');
	tints.setAttribute('fill', color);
	tints.style.opacity = options.dark ? '0.34' : '0.42';
	tints.style.mixBlendMode = options.dark ? 'normal' : 'multiply';
	group.append(tints);
	const list = Array.from(rects as ArrayLike<DOMRect>);
	for (const { left, top, height, width } of list) {
		const rect = document.createElementNS(SVG, 'rect');
		rect.setAttribute('x', String(left));
		rect.setAttribute('y', String(top));
		rect.setAttribute('height', String(height));
		rect.setAttribute('width', String(width));
		tints.append(rect);
	}
	const last = list[list.length - 1];
	if (last && options.comment && !isBaseHalfHighlight(options.comment)) {
		const mark = document.createElementNS(SVG, 'rect');
		mark.setAttribute('x', String(last.right + 3));
		mark.setAttribute('y', String(last.top + Math.max(0, (last.height - 12) / 2) - 2));
		mark.setAttribute('width', '12');
		mark.setAttribute('height', '12');
		mark.setAttribute('rx', '2');
		mark.setAttribute('fill', color);
		group.append(mark);
	}
	return group;
}

/** Where the mark of a comment stands after its passage, in the coordinates of the section's document. */
export function markBox(rects: DOMRectList | readonly DOMRect[]): DOMRect | undefined {
	const list = Array.from(rects as ArrayLike<DOMRect>);
	const last = list[list.length - 1];
	return last ? new DOMRect(last.right + 3, last.top + Math.max(0, (last.height - 12) / 2) - 2, 12, 12) : undefined;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../base/browser/dom.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { baseHalfCanvasNotePartSource, BASEHALF_CANVAS_NOTE_PART_LENGTH, IBaseHalfCanvasNoteParts, planBaseHalfCanvasNoteParts } from '../common/basehalfCanvasPreview.js';
import { splitBaseHalfMarkdownFrontmatter } from '../common/basehalfMarkdownProjection.js';
import { renderBaseHalfCanvasStoredMarkdown } from './cardDetail/basehalfCanvasMarkdownInlineEditor.js';

/** The class of the element that holds one built part. It takes no box of its own. */
export const BASEHALF_CANVAS_NOTE_PART_CLASS = 'bh-md-part';

/** How far the built parts reach below what the note shows, in heights of the note's box. */
const BUILT_AHEAD = 2;

const notesInParts = new WeakMap<HTMLElement, BaseHalfCanvasNoteInParts>();

/**
 * The resting projection of a note, built one part after the other: as far as
 * the box of the note shows, and two of its heights further. A part is never
 * taken down again, so what has been shown keeps its place.
 */
class BaseHalfCanvasNoteInParts extends Disposable {
	private built = 0;
	private readonly watching = this._register(new MutableDisposable());

	constructor(
		private readonly container: HTMLElement,
		private readonly resource: URI,
		private readonly plan: IBaseHalfCanvasNoteParts,
		private readonly onOpenLink: ((href: string) => void) | undefined
	) {
		super();
		if (!this.complete) {
			this.buildNext();
		}
		if (!this.complete) {
			// A box is measured after its layout and before its frame is shown, so
			// the parts a taller box needs are built before anyone sees it short.
			const observer = new (getWindow(container).ResizeObserver)(() => this.buildTo(container.scrollTop));
			observer.observe(container);
			const scroll = addDisposableListener(container, 'scroll', () => this.buildTo(container.scrollTop));
			this.watching.value = toDisposable(() => {
				observer.disconnect();
				scroll.dispose();
			});
		}
	}

	get complete(): boolean {
		return this.built >= this.plan.parts.length;
	}

	/** Builds the parts that a box scrolled to `top` shows and the two heights below it. */
	buildTo(top: number): void {
		while (!this.complete) {
			const height = this.container.clientHeight;
			if (this.container.scrollHeight - (top + height) >= height * BUILT_AHEAD) {
				return;
			}
			this.buildNext();
		}
	}

	buildAll(): void {
		while (!this.complete) {
			this.buildNext();
		}
	}

	private buildNext(): void {
		const part = append(this.container, $(`.${BASEHALF_CANVAS_NOTE_PART_CLASS}`));
		this._register(renderBaseHalfCanvasStoredMarkdown(part, this.resource, baseHalfCanvasNotePartSource(this.plan, this.built), this.onOpenLink));
		this.built++;
		if (this.complete) {
			this.watching.clear();
		}
	}
}

/**
 * Renders the body of a stored note into its resting projection in parts
 * (note rendering, rules 28 to 30). Returns undefined for a note that cannot
 * be shown in parts; its card shows the label of a note that is too large.
 */
export function renderBaseHalfCanvasNoteInParts(
	container: HTMLElement,
	resource: URI,
	documentSource: string,
	onOpenLink?: (href: string) => void,
	partLength = BASEHALF_CANVAS_NOTE_PART_LENGTH
): IDisposable | undefined {
	const { body } = splitBaseHalfMarkdownFrontmatter(documentSource);
	const plan = planBaseHalfCanvasNoteParts(body, partLength);
	if (!plan) {
		return undefined;
	}
	const note = new BaseHalfCanvasNoteInParts(container, resource, plan, onOpenLink);
	notesInParts.set(container, note);
	return toDisposable(() => {
		if (notesInParts.get(container) === note) {
			notesInParts.delete(container);
		}
		note.dispose();
	});
}

/**
 * Builds the parts of a note in parts that its box shows when it is scrolled
 * to `top`, and two of its heights below. Anything else is left alone.
 */
export function buildBaseHalfCanvasNotePartsTo(container: HTMLElement, top: number): void {
	notesInParts.get(container)?.buildTo(Math.max(0, top));
}

/** Builds every part of a note in parts. Anything else is left alone. */
export function buildAllBaseHalfCanvasNoteParts(container: HTMLElement): void {
	notesInParts.get(container)?.buildAll();
}

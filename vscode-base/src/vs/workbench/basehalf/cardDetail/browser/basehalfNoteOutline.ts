/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports only its sibling in common/.

import {
	BASEHALF_NOTE_OUTLINE_MIN_MARGIN,
	BASEHALF_NOTE_OUTLINE_PANEL_LEFT,
	BASEHALF_NOTE_OUTLINE_ROW_HEIGHT,
	BASEHALF_NOTE_OUTLINE_SCROLL_GAP,
	BASEHALF_NOTE_OUTLINE_TICK_END,
	BASEHALF_NOTE_OUTLINE_TICK_HEIGHT,
	baseHalfNoteOutlineColumn,
	baseHalfNoteOutlineCurrent,
	baseHalfNoteOutlineIndent,
	baseHalfNoteOutlinePanelHeight,
	baseHalfNoteOutlinePanelTop,
	baseHalfNoteOutlineTickLength,
} from '../common/basehalfNoteOutlineLayout.js';

/**
 * The classes of the outline. Its look is a style rule of the place it is
 * drawn in: in the workbench `media/basehalfNoteOutline.css`, in the rich
 * editor's page its `editor.css`.
 */
export const BASEHALF_NOTE_OUTLINE_CLASS = 'basehalf-note-outline';

/** How far the column of ticks reaches beyond them, so that the pointer finds it: left, right, above, and below. */
const COLUMN_SLACK = 8;

export interface IBaseHalfNoteOutlineHeading {
	readonly element: HTMLElement;
	readonly level: number;
	readonly name: string;
}

/**
 * The headings that a page shows, in their order: every heading element in it
 * that has text (zoom and outline of a note, rule 9). A line of the front
 * matter or of a code block is drawn as text, so it is none.
 */
export function baseHalfNoteOutlineHeadings(root: ParentNode | null | undefined): IBaseHalfNoteOutlineHeading[] {
	const headings: IBaseHalfNoteOutlineHeading[] = [];
	for (const element of root?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []) {
		const name = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (name) {
			headings.push({ element, level: Number(element.tagName.slice(1)), name });
		}
	}
	return headings;
}

export interface IBaseHalfNoteOutlineOptions {
	/** The element that scrolls. The outline is put into it, so that a wheel over it scrolls the note. */
	readonly view: HTMLElement;
	/** The note's text: the margin to its left shows the outline. */
	readonly text: () => HTMLElement | null | undefined;
	/** The headings of the page as it is now. */
	readonly headings: () => readonly IBaseHalfNoteOutlineHeading[];
	/** The name of the panel for a screen reader. */
	readonly label: string;
	/** With reduced motion the outline comes and goes in one frame, and a click scrolls at once (rule 20). */
	readonly reducedMotion: () => boolean;
}

/**
 * The outline of a note's headings in the margin to the left of its text:
 * nothing at rest, ticks while the pointer is in the margin, and the panel of
 * their names while the pointer is over the ticks (zoom and outline of a
 * note, rules 10 to 20).
 */
export class BaseHalfNoteOutline {
	private readonly root: HTMLElement;
	private readonly column: HTMLElement;
	private readonly panel: HTMLElement;
	private readonly list: HTMLElement;
	private ticks: HTMLElement[] = [];
	private rows: HTMLElement[] = [];
	private headings: readonly IBaseHalfNoteOutlineHeading[] = [];
	private current = -1;
	private inMargin = false;
	private overOutline = false;
	private open = false;
	private pendingFrame: number | undefined;
	private observedText: HTMLElement | undefined;
	/** The headings are read again in the next frame: the page changed. */
	private headingsChanged = true;
	private readonly resizeObserver: ResizeObserver;
	private readonly mutationObserver: MutationObserver;
	private readonly listeners: (() => void)[] = [];
	private readonly window: Window;

	constructor(private readonly options: IBaseHalfNoteOutlineOptions) {
		const view = options.view;
		const document = view.ownerDocument;
		// The view is in a page, whose window draws it.
		this.window = document.defaultView as Window;

		// The outline lies in the view's flow before the page, takes no height,
		// and sticks to the top of the view, so that it stays in view and a
		// wheel over it scrolls the note.
		this.root = document.createElement('div');
		this.root.className = BASEHALF_NOTE_OUTLINE_CLASS;
		this.column = document.createElement('div');
		this.column.className = `${BASEHALF_NOTE_OUTLINE_CLASS}-ticks`;
		this.column.setAttribute('aria-hidden', 'true');
		this.panel = document.createElement('div');
		this.panel.className = `${BASEHALF_NOTE_OUTLINE_CLASS}-panel`;
		this.panel.setAttribute('role', 'navigation');
		this.panel.setAttribute('aria-label', options.label);
		this.list = document.createElement('div');
		this.list.className = `${BASEHALF_NOTE_OUTLINE_CLASS}-list`;
		this.panel.append(this.list);
		this.root.append(this.column, this.panel);
		view.prepend(this.root);

		this.listen(view, 'pointermove', event => this.onPointerMove(event as PointerEvent), { passive: true });
		this.listen(view, 'pointerleave', () => this.setInMargin(false), { passive: true });
		this.listen(view, 'scroll', () => this.schedule(), { passive: true });
		for (const element of [this.column, this.panel]) {
			this.listen(element, 'pointerenter', () => this.setOverOutline(true));
			this.listen(element, 'pointerleave', event => {
				const next = (event as PointerEvent).relatedTarget;
				this.setOverOutline(next instanceof Node && (this.column.contains(next) || this.panel.contains(next)));
			});
			// A press here moves neither the keyboard nor the caret, and reaches nothing under it (rule 17).
			this.listen(element, 'mousedown', event => {
				event.preventDefault();
				event.stopPropagation();
			});
			this.listen(element, 'pointerdown', event => event.stopPropagation());
		}
		this.listen(this.list, 'click', event => {
			const row = (event.target as Element | null)?.closest?.(`.${BASEHALF_NOTE_OUTLINE_CLASS}-item`);
			const index = row ? this.rows.indexOf(row as HTMLElement) : -1;
			if (index >= 0) {
				event.preventDefault();
				event.stopPropagation();
				this.reveal(index);
			}
		});
		const pageWindow = this.window as unknown as { ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver };
		this.resizeObserver = new pageWindow.ResizeObserver(() => this.schedule());
		this.resizeObserver.observe(view);
		// Whatever changes the text, typing, a change from outside, or the
		// editor drawing the note at first, the outline follows it (rule 18).
		this.mutationObserver = new pageWindow.MutationObserver(() => this.refresh());
		this.schedule();
	}

	/** Reads the headings of the page again in the next frame: after the page changed (rule 18). */
	refresh(): void {
		this.headingsChanged = true;
		this.schedule();
	}

	private readHeadings(): void {
		this.headingsChanged = false;
		const headings = this.options.headings();
		if (!sameHeadings(headings, this.headings)) {
			this.headings = headings;
			this.render();
		} else {
			this.headings = headings;
		}
	}

	dispose(): void {
		if (this.pendingFrame !== undefined) {
			this.window.cancelAnimationFrame(this.pendingFrame);
			this.pendingFrame = undefined;
		}
		this.resizeObserver.disconnect();
		this.mutationObserver.disconnect();
		for (const remove of this.listeners.splice(0)) {
			remove();
		}
		this.root.remove();
	}

	private listen(target: EventTarget, type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void {
		target.addEventListener(type, listener, options);
		this.listeners.push(() => target.removeEventListener(type, listener, options));
	}

	private render(): void {
		const document = this.root.ownerDocument;
		const highest = Math.min(...this.headings.map(heading => heading.level));
		this.ticks = this.headings.map(heading => {
			const tick = document.createElement('span');
			tick.className = `${BASEHALF_NOTE_OUTLINE_CLASS}-tick`;
			const length = baseHalfNoteOutlineTickLength(heading.level, highest);
			tick.style.width = `${length}px`;
			tick.style.left = `${BASEHALF_NOTE_OUTLINE_TICK_END - BASEHALF_NOTE_OUTLINE_PANEL_LEFT - length}px`;
			return tick;
		});
		this.rows = this.headings.map(heading => {
			const row = document.createElement('button');
			row.type = 'button';
			row.tabIndex = -1;
			row.className = `${BASEHALF_NOTE_OUTLINE_CLASS}-item`;
			row.style.paddingInlineStart = `${8 + baseHalfNoteOutlineIndent(heading.level, highest)}px`;
			const name = document.createElement('span');
			name.textContent = heading.name;
			row.append(name);
			return row;
		});
		this.column.replaceChildren(...this.ticks);
		this.list.replaceChildren(...this.rows);
		this.current = -1;
	}

	private onPointerMove(event: PointerEvent): void {
		const text = this.options.text();
		if (!text) {
			this.setInMargin(false);
			return;
		}
		const view = this.options.view.getBoundingClientRect();
		const left = view.left + this.options.view.clientLeft;
		this.setInMargin(event.clientX >= left && event.clientX < text.getBoundingClientRect().left);
	}

	private setInMargin(inMargin: boolean): void {
		if (this.inMargin !== inMargin) {
			this.inMargin = inMargin;
			this.schedule();
		}
	}

	private setOverOutline(over: boolean): void {
		if (this.overOutline !== over) {
			this.overOutline = over;
			this.schedule();
		}
	}

	private schedule(): void {
		if (this.pendingFrame === undefined) {
			this.pendingFrame = this.window.requestAnimationFrame(() => {
				this.pendingFrame = undefined;
				this.layout();
			});
		}
	}

	/** Puts the ticks and the panel in place, and marks the current heading. */
	private layout(): void {
		const view = this.options.view;
		const text = this.options.text();
		if (text && text !== this.observedText) {
			if (this.observedText) {
				this.resizeObserver.unobserve(this.observedText);
			}
			this.observedText = text;
			this.resizeObserver.observe(text);
			this.mutationObserver.disconnect();
			this.mutationObserver.observe(text, { childList: true, subtree: true, characterData: true });
			this.headingsChanged = true;
		}
		if (this.headingsChanged) {
			this.readHeadings();
		}
		const viewBox = view.getBoundingClientRect();
		const viewTop = viewBox.top + view.clientTop;
		const viewLeft = viewBox.left + view.clientLeft;
		const height = view.clientHeight;
		const margin = text ? text.getBoundingClientRect().left - viewLeft : 0;
		const available = this.headings.length > 0 && height > 0 && margin >= BASEHALF_NOTE_OUTLINE_MIN_MARGIN;
		this.root.classList.toggle('reduced-motion', this.options.reducedMotion());
		if (!available) {
			this.column.classList.remove('shown');
			this.setOpen(false);
			return;
		}

		const tops = this.headings.map(heading => heading.element.getBoundingClientRect().top - viewTop);
		const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 1;
		const current = baseHalfNoteOutlineCurrent(tops, height, atEnd);
		const column = baseHalfNoteOutlineColumn(this.headings.length, height, current);

		// The outline is placed from the view's edges; it sticks where the view's padding lets it.
		const rootBox = this.root.getBoundingClientRect();
		const offsetLeft = rootBox.left - viewLeft;
		const offsetTop = rootBox.top - viewTop;
		this.column.style.left = `${BASEHALF_NOTE_OUTLINE_PANEL_LEFT - offsetLeft}px`;
		this.column.style.top = `${column.top - COLUMN_SLACK - offsetTop}px`;
		this.column.style.height = `${(column.last - column.first) * column.pitch + BASEHALF_NOTE_OUTLINE_TICK_HEIGHT + 2 * COLUMN_SLACK}px`;
		this.ticks.forEach((tick, index) => {
			const shown = index >= column.first && index <= column.last;
			tick.hidden = !shown;
			if (shown) {
				tick.style.top = `${COLUMN_SLACK + (index - column.first) * column.pitch}px`;
			}
		});

		const panelHeight = baseHalfNoteOutlinePanelHeight(this.rows.length, height);
		this.panel.style.left = `${BASEHALF_NOTE_OUTLINE_PANEL_LEFT - offsetLeft}px`;
		this.panel.style.top = `${baseHalfNoteOutlinePanelTop(column.top, panelHeight, height) - offsetTop}px`;
		this.panel.style.maxHeight = `${panelHeight}px`;

		if (current !== this.current) {
			this.ticks[this.current]?.classList.remove('current');
			this.rows[this.current]?.classList.remove('current');
			this.current = current;
			this.ticks[current]?.classList.add('current');
			this.rows[current]?.classList.add('current');
		}
		this.column.classList.toggle('shown', this.inMargin || this.overOutline);
		this.setOpen(this.overOutline);
	}

	private setOpen(open: boolean): void {
		if (this.open === open) {
			return;
		}
		this.open = open;
		this.panel.classList.toggle('open', open);
		if (open) {
			// The current heading's row is in view when the panel opens (rule 15).
			const row = this.rows[this.current];
			if (row) {
				const room = this.list.clientHeight;
				if (row.offsetTop < this.list.scrollTop || row.offsetTop + BASEHALF_NOTE_OUTLINE_ROW_HEIGHT > this.list.scrollTop + room) {
					this.list.scrollTop = Math.max(0, row.offsetTop - (room - BASEHALF_NOTE_OUTLINE_ROW_HEIGHT) / 2);
				}
			}
		}
	}

	/** Scrolls the view until the heading stands 24 pixels below its top (rule 17). */
	private reveal(index: number): void {
		const heading = this.headings[index];
		const view = this.options.view;
		if (!heading?.element.isConnected) {
			return;
		}
		const viewTop = view.getBoundingClientRect().top + view.clientTop;
		const top = view.scrollTop + heading.element.getBoundingClientRect().top - viewTop - BASEHALF_NOTE_OUTLINE_SCROLL_GAP;
		view.scrollTo({ top: Math.max(0, top), behavior: this.options.reducedMotion() ? 'auto' : 'smooth' });
	}
}

function sameHeadings(a: readonly IBaseHalfNoteOutlineHeading[], b: readonly IBaseHalfNoteOutlineHeading[]): boolean {
	return a.length === b.length && a.every((heading, index) => heading.element === b[index].element && heading.level === b[index].level && heading.name === b[index].name);
}

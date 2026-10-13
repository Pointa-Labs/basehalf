/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports nothing.

/** The class of the bar. Its look is a style rule of the place it is installed in. */
export const BASEHALF_SIDEWAYS_SCROLLBAR_CLASS = 'basehalf-sideways-scrollbar';

/** How long the bar stays after the last movement of its box, in milliseconds. */
export const BASEHALF_SIDEWAYS_SCROLLBAR_SHOWN_MS = 800;

/** The height of the bar and its distance from the edges of its box, in the pixels of the box. */
const THICKNESS = 6;
const INSET = 2;
const SHORTEST = 24;

export interface IBaseHalfSidewaysScrollbarOptions {
	/** The boxes that scroll sideways and show the bar. */
	readonly boxSelector: string;
	/**
	 * The element the bar is put into for a box: an ancestor of the box that
	 * moves with it and is positioned, so that the bar is placed inside it.
	 */
	readonly container: (box: HTMLElement) => HTMLElement | null | undefined;
	/** The element whose lower edge the bar follows. The box itself when there is none. */
	readonly anchor?: (box: HTMLElement) => HTMLElement | null | undefined;
	/**
	 * Calls back once the bar has been shown for its time, unless it is
	 * disposed first. Tests replace it.
	 */
	readonly afterShownTime?: (callback: () => void) => { dispose(): void };
}

/** Where the bar of a box stands, in the pixels of the box: from its left edge, and how long. */
export function baseHalfSidewaysScrollbarSpan(box: { readonly scrollLeft: number; readonly scrollWidth: number; readonly clientWidth: number }): { readonly offset: number; readonly length: number } | undefined {
	const range = box.scrollWidth - box.clientWidth;
	const track = box.clientWidth - 2 * INSET;
	if (range < 1 || track <= SHORTEST) {
		return undefined;
	}
	const length = Math.max(SHORTEST, track * box.clientWidth / box.scrollWidth);
	const position = Math.min(1, Math.max(0, box.scrollLeft / range));
	return { offset: INSET + (track - length) * position, length };
}

// A position that is put back is no scroll of the user: its box shows no bar for it.
const restored = new WeakSet<HTMLElement>();

/** Puts a box back at a sideways position it had, without showing its bar. */
export function restoreBaseHalfSidewaysScroll(box: HTMLElement, position: number): void {
	const before = box.scrollLeft;
	box.scrollLeft = position;
	if (box.scrollLeft !== before) {
		restored.add(box);
	}
}

/**
 * Shows one bar inside the lower edge of a box while the box is scrolled
 * sideways, by whatever scrolls it. The bar lies over the box and takes no
 * space and no press. It has one look and is hidden while nothing scrolls.
 */
export function installBaseHalfSidewaysScrollbar(host: HTMLElement, options: IBaseHalfSidewaysScrollbarOptions): { dispose(): void } {
	const targetWindow = host.ownerDocument.defaultView;
	if (!targetWindow) {
		return { dispose: () => { } };
	}
	const afterShownTime = options.afterShownTime ?? (callback => {
		const timer = targetWindow.setTimeout(callback, BASEHALF_SIDEWAYS_SCROLLBAR_SHOWN_MS);
		return { dispose: () => targetWindow.clearTimeout(timer) };
	});
	const bar = host.ownerDocument.createElement('div');
	bar.className = BASEHALF_SIDEWAYS_SCROLLBAR_CLASS;
	bar.setAttribute('aria-hidden', 'true');
	let hiding: { dispose(): void } | undefined;

	const hide = (): void => {
		bar.classList.remove('shown');
		hiding?.dispose();
		hiding = undefined;
	};

	const show = (box: HTMLElement): void => {
		const container = options.container(box);
		const span = baseHalfSidewaysScrollbarSpan(box);
		if (!container || !span) {
			hide();
			return;
		}
		if (bar.parentElement !== container) {
			container.appendChild(bar);
		}
		// The box may be drawn at another size than it is laid out in, as a card
		// is on a zoomed canvas. The bar is placed in the pixels of the layout.
		const boxRect = box.getBoundingClientRect();
		const scale = box.offsetWidth > 0 && boxRect.width > 0 ? boxRect.width / box.offsetWidth : 1;
		const containerRect = container.getBoundingClientRect();
		const lowerEdge = (options.anchor?.(box) ?? box).getBoundingClientRect().bottom;
		const left = (boxRect.left - containerRect.left) / scale - container.clientLeft + container.scrollLeft + box.clientLeft + span.offset;
		const top = (lowerEdge - containerRect.top) / scale - container.clientTop + container.scrollTop - THICKNESS - INSET;
		bar.style.width = `${span.length}px`;
		bar.style.height = `${THICKNESS}px`;
		bar.style.transform = `translate(${left}px, ${top}px)`;
		bar.classList.add('shown');
		hiding?.dispose();
		hiding = afterShownTime(hide);
	};

	const onScroll = (event: Event): void => {
		const box = event.target as Partial<HTMLElement> | null;
		if (!box || box.nodeType !== 1 || typeof box.matches !== 'function' || !box.matches(options.boxSelector)) {
			return;
		}
		if (restored.delete(box as HTMLElement)) {
			return;
		}
		show(box as HTMLElement);
	};

	// A scroll event does not bubble. It is seen on its way down.
	host.addEventListener('scroll', onScroll, { capture: true, passive: true });
	return {
		dispose: () => {
			host.removeEventListener('scroll', onScroll, { capture: true });
			hiding?.dispose();
			bar.remove();
		}
	};
}

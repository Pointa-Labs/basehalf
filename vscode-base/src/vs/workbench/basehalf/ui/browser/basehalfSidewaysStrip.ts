/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

/**
 * A strip that scrolls only sideways, as the tabs of the Agent Area and the
 * tiles of a generation card's inputs: a wheel that turns up and down over
 * `target` moves the strip sideways, as VS Code's editor tabs move. The
 * strip's scroll bar, where it has one, shows only while it scrolls
 * (architecture invariants, "Product shell", D127), so a wheel that turns one
 * way would not reach what the strip cuts off.
 */
export function baseHalfMoveStripWithWheel(target: HTMLElement, strip: () => HTMLElement | undefined): IDisposable {
	return addDisposableListener(target, 'wheel', (event: WheelEvent) => {
		const element = strip();
		if (element && Math.abs(event.deltaY) > Math.abs(event.deltaX) && element.scrollWidth > element.clientWidth) {
			element.scrollLeft += event.deltaY;
			event.preventDefault();
		}
	}, { passive: false });
}

/**
 * Moves a strip sideways by as little as shows the whole of `element`, one
 * of the elements in it, and to the element's start when the strip is
 * narrower than the element.
 */
export function baseHalfRevealInStrip(strip: HTMLElement, element: HTMLElement): void {
	const view = strip.getBoundingClientRect();
	const box = element.getBoundingClientRect();
	if (box.left < view.left || box.width > view.width) {
		strip.scrollLeft += box.left - view.left;
	} else if (box.right > view.right) {
		strip.scrollLeft += box.right - view.right;
	}
}

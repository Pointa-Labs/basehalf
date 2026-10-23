/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { BASEHALF_HOVER_ATTRIBUTE } from '../common/basehalfHover.js';

/** BaseHalf's hovers are one group: moving from one to the next shows it without the delay, as along a toolbar. */
const HOVER_GROUP = 'basehalf-hover';

/** Gives `element` its hover, or takes it away with `undefined` (architecture invariants, "Product shell"). */
export function setBaseHalfHover(element: Element, text: string | undefined): void {
	if (text) {
		element.setAttribute(BASEHALF_HOVER_ATTRIBUTE, text);
	} else {
		element.removeAttribute(BASEHALF_HOVER_ATTRIBUTE);
	}
}

/**
 * Shows the workbench's hover, after its delay, for each element under `root`
 * that has {@link BASEHALF_HOVER_ATTRIBUTE}, as `setupDelayedHover` shows it
 * for one element; the hover goes when the pointer leaves the element. An
 * element drawn later, as by the canvas's scene, has its hover without
 * anything more. It listens on the way down, so that an element that keeps
 * its pointer events to itself still has its hover.
 */
export function setupBaseHalfHovers(root: HTMLElement, hoverService: IHoverService): IDisposable {
	return addDisposableListener(root, EventType.MOUSE_OVER, event => {
		const start = event.target as Element | null;
		const target = typeof start?.closest === 'function' ? start.closest(`[${BASEHALF_HOVER_ATTRIBUTE}]`) : null;
		const content = target?.getAttribute(BASEHALF_HOVER_ATTRIBUTE);
		if (isHTMLElement(target) && content) {
			hoverService.showDelayedHover({ target, content }, { groupId: HOVER_GROUP });
		}
	}, true);
}

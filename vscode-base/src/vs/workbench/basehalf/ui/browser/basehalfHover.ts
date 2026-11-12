/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import type { IHoverWidget } from '../../../../base/browser/ui/hover/hover.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { BASEHALF_HOVER_ATTRIBUTE } from '../common/basehalfHover.js';

/** BaseHalf's hovers are one group: moving from one to the next shows it without the delay, as along a toolbar. */
const HOVER_GROUP = 'basehalf-hover';

/** The hover that the workbench shows, or waits to show, for an element with {@link BASEHALF_HOVER_ATTRIBUTE}. */
const hoversOfElements = new WeakMap<Element, IHoverWidget>();

/**
 * Gives `element` its hover, or takes it away with `undefined` (architecture
 * invariants, "Product shell"). A hover that the element shows or waits to
 * show with another text goes, so that it never names what the element did
 * before, as Play that becomes Pause; the pointer that comes onto the element
 * again shows the new text.
 */
export function setBaseHalfHover(element: Element, text: string | undefined): void {
	if ((element.getAttribute(BASEHALF_HOVER_ATTRIBUTE) ?? undefined) === (text || undefined)) {
		return;
	}
	hoversOfElements.get(element)?.dispose();
	hoversOfElements.delete(element);
	if (text) {
		element.setAttribute(BASEHALF_HOVER_ATTRIBUTE, text);
	} else {
		element.removeAttribute(BASEHALF_HOVER_ATTRIBUTE);
	}
}

/**
 * What a button says it does changed, as Play becomes Pause, where the hover
 * service draws its hover itself (`setupDelayedHover`): the hover that the
 * pointer on the button shows, or waits to show, names what it did before,
 * and goes (architecture invariants, "Product shell"). The pointer that comes
 * onto the button again shows the new name.
 */
export function hideBaseHalfHoverOfRenamedButton(button: Element, hoverService: IHoverService): void {
	if (button.matches(':hover')) {
		hoverService.hideHover(true);
	}
}

/**
 * Shows the workbench's hover, after its delay, for each element under `root`
 * that has {@link BASEHALF_HOVER_ATTRIBUTE}, as `setupDelayedHover` shows it
 * for one element; the hover goes when the pointer leaves the element, and
 * when {@link setBaseHalfHover} gives the element another text. An element
 * drawn later, as by the canvas's scene, has its hover without anything
 * more. It listens on the way down, so that an element that keeps its pointer
 * events to itself still has its hover.
 */
export function setupBaseHalfHovers(root: HTMLElement, hoverService: IHoverService): IDisposable {
	return addDisposableListener(root, EventType.MOUSE_OVER, event => {
		const start = event.target as Element | null;
		const target = typeof start?.closest === 'function' ? start.closest(`[${BASEHALF_HOVER_ATTRIBUTE}]`) : null;
		const content = target?.getAttribute(BASEHALF_HOVER_ATTRIBUTE);
		if (isHTMLElement(target) && content) {
			const hover = hoverService.showDelayedHover({ target, content }, { groupId: HOVER_GROUP });
			if (hover) {
				hoversOfElements.set(target, hover);
			}
		}
	}, true);
}

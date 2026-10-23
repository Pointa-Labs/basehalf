/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../../base/common/async.js';

/** The name of the element that grows or shrinks: the card before, Card Detail after, or the other way round. */
const TRANSITION_NAME = 'basehalf-card-detail';
/** The card's name, above its box: it stays where it is while the box grows or shrinks. */
const CAPTION_TRANSITION_NAME = 'basehalf-card-detail-caption';

/** A card on screen: its box, and its name above the box. */
export interface IBaseHalfCardDetailTransitionCard {
	readonly box: HTMLElement;
	readonly caption?: HTMLElement;
}

/** How long the canvas stays on screen at most while Card Detail is drawn (opening and closing Card Detail). */
export const BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS = 250;
/** How long closing waits at most for the canvas to draw the cards of notes again. */
export const BASEHALF_CARD_DETAIL_CARDS_WAIT_MS = 150;

export interface IBaseHalfCardDetailTransitionStep {
	readonly direction: 'open' | 'close';
	/** Card Detail itself. */
	readonly detail: HTMLElement;
	/** Its card, when it is on screen: what Card Detail grows out of or goes back into. Asked before `draw` and after. */
	readonly card: () => IBaseHalfCardDetailTransitionCard | undefined;
	/** Draws the state navigation is in now: Card Detail shown, or gone. */
	readonly draw: () => void;
	/** Resolves once what `draw` drew can be seen: Card Detail drawn, or the cards drawn again. */
	readonly ready: () => Promise<unknown>;
	/** How long the transition waits at most for `ready`. */
	readonly wait: number;
	/** Card Detail appears and goes in one frame, still never empty. */
	readonly reducedMotion: boolean;
	/** The transition is over: the window shows the live state again. */
	readonly finished?: () => void;
	/** What failed while drawing. */
	readonly onError: (error: unknown) => void;
}

/**
 * Card Detail grows out of its card and goes back into it (opening and
 * closing Card Detail). It is a view transition of the window: the window
 * keeps showing what it showed until the new state is drawn and ready, then
 * the browser moves and grows the element named for the transition from the
 * old place to the new one while the rest fades across. Navigation has
 * already changed when it starts; the transition delays only the frames.
 */
export class BaseHalfCardDetailTransition {

	private waiting = 0;

	/**
	 * A transition has started and not drawn yet. A drawing now would come
	 * before the browser has kept what the window shows: the transition draws
	 * the state navigation is in when it draws.
	 */
	get drawing(): boolean {
		return this.waiting > 0;
	}

	/** Runs `step` and returns true, or returns false when the window cannot run it: the caller draws at once. */
	run(step: IBaseHalfCardDetailTransitionStep): boolean {
		const targetDocument = step.detail.ownerDocument;
		if (typeof targetDocument.startViewTransition !== 'function' || targetDocument.visibilityState !== 'visible') {
			return false;
		}
		const named: HTMLElement[] = [];
		const nameOne = (element: HTMLElement | undefined, transitionName: string) => {
			if (element) {
				element.style.setProperty('view-transition-name', transitionName);
				named.push(element);
			}
		};
		// The card's box; its name keeps a name of its own, so that it is not
		// part of the box's picture.
		const nameCard = () => {
			const card = step.card();
			nameOne(card?.box, TRANSITION_NAME);
			nameOne(card?.caption, CAPTION_TRANSITION_NAME);
		};
		const nameDetail = () => nameOne(step.detail, TRANSITION_NAME);
		const unname = () => {
			for (const element of named.splice(0)) {
				element.style.removeProperty('view-transition-name');
			}
		};
		if (step.direction === 'open') {
			nameCard();
		} else {
			nameDetail();
		}
		this.waiting++;
		let drew = false;
		const draw = () => {
			if (drew) {
				return;
			}
			drew = true;
			this.waiting--;
			// The name moves from what was to what is: one element at a time has it.
			unname();
			step.draw();
		};
		let transition: ViewTransition;
		try {
			transition = targetDocument.startViewTransition({
				update: async () => {
					draw();
					await raceTimeout(step.ready(), step.wait);
					if (step.direction === 'open') {
						nameDetail();
					} else {
						nameCard();
					}
				},
				types: [`${TRANSITION_NAME}-${step.direction}`, ...(step.reducedMotion ? ['basehalf-reduced-motion'] : [])]
			});
		} catch (error) {
			draw();
			unname();
			step.finished?.();
			step.onError(error);
			return true;
		}
		// A transition that the browser skips, as when another one starts, still draws.
		transition.ready.catch(() => undefined);
		transition.updateCallbackDone.catch(error => {
			draw();
			step.onError(error);
		});
		void transition.finished.catch(() => undefined).finally(() => {
			unname();
			step.finished?.();
		});
		return true;
	}
}

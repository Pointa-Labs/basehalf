/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../../base/common/async.js';

/** The name of Card Detail while it fades in or out: the one element with a picture of its own. */
const TRANSITION_NAME = 'basehalf-card-detail';

/** How long the canvas stays on screen at most while Card Detail is drawn (opening and closing Card Detail). */
export const BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS = 250;

export interface IBaseHalfCardDetailTransitionStep {
	readonly direction: 'open' | 'close';
	/** Card Detail itself. */
	readonly detail: HTMLElement;
	/** Draws the state navigation is in now: Card Detail shown, or gone. */
	readonly draw: () => void;
	/** Resolves once what `draw` drew can be seen. */
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
 * Card Detail fades in and out where it is, over the canvas area (opening and
 * closing Card Detail). It is a view transition of the window: the window
 * keeps showing what it showed until the new state is drawn and ready. Card
 * Detail alone has the transition's name, and it is shown on one side only,
 * so its picture fades and scales inside its own box while the rest of the
 * window fades across in place. Nothing of the canvas moves: a card's
 * picture, which may reach past the canvas, is never part of the motion.
 * Navigation has already changed when it starts; the transition delays only
 * the frames.
 */
export class BaseHalfCardDetailTransition {

	private waiting = 0;
	private active = 0;
	private runs = 0;

	/**
	 * A transition has started and not drawn yet. A drawing now would come
	 * before the browser has kept what the window shows: the transition draws
	 * the state navigation is in when it draws.
	 */
	get drawing(): boolean {
		return this.waiting > 0;
	}

	/** A transition runs: from its start until its animation has ended, also once it has drawn. */
	get running(): boolean {
		return this.active > 0;
	}

	/** Runs `step` and returns true, or returns false when the window cannot run it: the caller draws at once. */
	run(step: IBaseHalfCardDetailTransitionStep): boolean {
		const targetDocument = step.detail.ownerDocument;
		if (typeof targetDocument.startViewTransition !== 'function' || targetDocument.visibilityState !== 'visible') {
			return false;
		}
		const run = ++this.runs;
		// Hidden on the other side of the transition, Card Detail has no picture there.
		step.detail.style.setProperty('view-transition-name', TRANSITION_NAME);
		const unname = () => {
			// A transition that a newer one ended leaves the name to the newer one.
			if (run === this.runs) {
				step.detail.style.removeProperty('view-transition-name');
			}
		};
		this.waiting++;
		this.active++;
		let drew = false;
		const draw = () => {
			if (drew) {
				return;
			}
			drew = true;
			this.waiting--;
			step.draw();
		};
		let transition: ViewTransition;
		try {
			transition = targetDocument.startViewTransition({
				update: async () => {
					draw();
					await raceTimeout(step.ready(), step.wait);
				},
				types: [`${TRANSITION_NAME}-${step.direction}`, ...(step.reducedMotion ? ['basehalf-reduced-motion'] : [])]
			});
		} catch (error) {
			draw();
			unname();
			this.active--;
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
			this.active--;
			step.finished?.();
		});
		return true;
	}
}

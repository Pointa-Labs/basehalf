/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS, BaseHalfCardDetailTransition, IBaseHalfCardDetailTransitionStep } from '../../browser/view/basehalfCanvasCardDetailTransition.js';

suite('BaseHalfCardDetailTransition', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	interface ITransitionFixture {
		readonly detail: HTMLElement;
		/** What the browser was asked for, and how to end each. */
		readonly started: { readonly types: readonly string[]; readonly update: () => Promise<void>; readonly finish: () => void }[];
		/** The names of the elements of the document that have one. */
		readonly names: () => Record<string, string>;
	}

	/** A document of the test's own, whose view transitions the test runs by hand. */
	function createDocument(options: { readonly support?: boolean; readonly visibility?: DocumentVisibilityState } = {}): ITransitionFixture {
		const document = mainWindow.document.implementation.createHTMLDocument('transition');
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => options.visibility ?? 'visible' });
		const started: { types: readonly string[]; update: () => Promise<void>; finish: () => void }[] = [];
		if (options.support === false) {
			Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
		} else {
			Object.defineProperty(document, 'startViewTransition', {
				configurable: true,
				value: (init: { update: () => Promise<void>; types?: string[] }) => {
					const finished = new DeferredPromise<void>();
					started.push({ types: init.types ?? [], update: init.update, finish: () => finished.complete() });
					return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: finished.p, skipTransition: () => undefined };
				}
			});
		}
		const detail = document.body.appendChild(document.createElement('div'));
		detail.className = 'detail';
		// A card on the canvas under Card Detail, which is never part of the motion.
		const card = document.body.appendChild(document.createElement('div'));
		card.className = 'card';
		const names = () => Object.fromEntries([detail, card]
			.filter(element => element.style.getPropertyValue('view-transition-name'))
			.map(element => [element.className, element.style.getPropertyValue('view-transition-name')]));
		return { detail, started, names };
	}

	function step(fixture: ITransitionFixture, direction: 'open' | 'close', drawn: Promise<unknown>, log: string[], overrides: Partial<IBaseHalfCardDetailTransitionStep> = {}): IBaseHalfCardDetailTransitionStep {
		return {
			direction,
			detail: fixture.detail,
			draw: () => log.push(`draw with ${JSON.stringify(fixture.names())}`),
			ready: () => drawn,
			wait: BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS,
			reducedMotion: false,
			onError: error => log.push(`error ${error}`),
			...overrides
		};
	}

	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	test('opening names Card Detail alone, draws once the browser has kept the window, waits for it to be drawn, and takes the name away at the end', async () => {
		const fixture = createDocument();
		const transition = new BaseHalfCardDetailTransition();
		const log: string[] = [];
		const drawn = new DeferredPromise<void>();
		let updated = false;
		const ran = transition.run(step(fixture, 'open', drawn.p, log, { finished: () => log.push('finished') }));
		const before = { names: fixture.names(), drawing: transition.drawing, log: [...log] };
		const update = fixture.started[0].update().then(() => updated = true);
		await settle();
		const drawing = { names: fixture.names(), drawing: transition.drawing, log: [...log], updated };
		drawn.complete();
		await update;
		const animating = transition.running;
		fixture.started[0].finish();
		await settle();
		assert.deepStrictEqual({ ran, types: fixture.started[0].types, before, drawing, animating, end: { names: fixture.names(), running: transition.running, log } }, {
			ran: true,
			types: ['basehalf-card-detail-open'],
			before: { names: { detail: 'basehalf-card-detail' }, drawing: true, log: [] },
			// The picture of the new side is kept once Card Detail is drawn.
			drawing: { names: { detail: 'basehalf-card-detail' }, drawing: false, log: ['draw with {"detail":"basehalf-card-detail"}'], updated: false },
			// It has drawn, and its animation still runs.
			animating: true,
			end: { names: {}, running: false, log: ['draw with {"detail":"basehalf-card-detail"}', 'finished'] }
		});
	});

	test('closing names Card Detail alone as well, with reduced motion as the type that stops the motion', async () => {
		const fixture = createDocument();
		const log: string[] = [];
		new BaseHalfCardDetailTransition().run(step(fixture, 'close', Promise.resolve(), log, { reducedMotion: true }));
		const before = fixture.names();
		await fixture.started[0].update();
		assert.deepStrictEqual({ types: fixture.started[0].types, before, after: fixture.names(), log }, {
			types: ['basehalf-card-detail-close', 'basehalf-reduced-motion'],
			before: { detail: 'basehalf-card-detail' },
			after: { detail: 'basehalf-card-detail' },
			log: ['draw with {"detail":"basehalf-card-detail"}']
		});
		fixture.started[0].finish();
	});

	test('a Card Detail that is not drawn in time fades in as it is: the transition waits at most its wait', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const fixture = createDocument();
		const log: string[] = [];
		new BaseHalfCardDetailTransition().run(step(fixture, 'open', new DeferredPromise<void>().p, log));
		const start = Date.now();
		await fixture.started[0].update();
		assert.deepStrictEqual({ waited: Date.now() - start, names: fixture.names() }, { waited: BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS, names: { detail: 'basehalf-card-detail' } });
		fixture.started[0].finish();
	}));

	test('a transition that a newer one ended leaves the name to the newer one', async () => {
		const fixture = createDocument();
		const transition = new BaseHalfCardDetailTransition();
		const log: string[] = [];
		transition.run(step(fixture, 'open', Promise.resolve(), log, { finished: () => log.push('open finished') }));
		await fixture.started[0].update();
		transition.run(step(fixture, 'close', Promise.resolve(), log, { finished: () => log.push('close finished') }));
		// The browser ends the first when the second starts.
		fixture.started[0].finish();
		await settle();
		const whileClosing = fixture.names();
		await fixture.started[1].update();
		fixture.started[1].finish();
		await settle();
		assert.deepStrictEqual({ whileClosing, end: fixture.names(), log }, {
			whileClosing: { detail: 'basehalf-card-detail' },
			end: {},
			log: ['draw with {"detail":"basehalf-card-detail"}', 'open finished', 'draw with {"detail":"basehalf-card-detail"}', 'close finished']
		});
	});

	test('without the browser\'s support, in a window that is not shown, and when the browser refuses, Card Detail is drawn at once', () => {
		const log: string[] = [];
		const unsupported = createDocument({ support: false });
		const hidden = createDocument({ visibility: 'hidden' });
		const refusing = createDocument();
		Object.defineProperty(refusing.detail.ownerDocument, 'startViewTransition', { configurable: true, value: () => { throw new Error('refused'); } });
		const transition = new BaseHalfCardDetailTransition();
		const ran = [
			transition.run(step(unsupported, 'open', Promise.resolve(), log)),
			transition.run(step(hidden, 'open', Promise.resolve(), log)),
			transition.run(step(refusing, 'open', Promise.resolve(), log, { finished: () => log.push('finished') }))
		];
		assert.deepStrictEqual({ ran, log, drawing: transition.drawing, names: [unsupported.names(), hidden.names(), refusing.names()] }, {
			// The caller draws for the first two; the third drew, and said what failed.
			ran: [false, false, true],
			log: ['draw with {"detail":"basehalf-card-detail"}', 'finished', 'error Error: refused'],
			drawing: false,
			names: [{}, {}, {}]
		});
	});
});

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
		readonly card: HTMLElement;
		readonly caption: HTMLElement;
		/** What the browser was asked for. */
		readonly started: { readonly types: readonly string[]; readonly update: () => Promise<void> }[];
		readonly finish: () => void;
		readonly names: () => Record<string, string>;
	}

	/** A document of the test's own, whose view transitions the test runs by hand. */
	function createDocument(options: { readonly support?: boolean; readonly visibility?: DocumentVisibilityState } = {}): ITransitionFixture {
		const document = mainWindow.document.implementation.createHTMLDocument('transition');
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => options.visibility ?? 'visible' });
		const started: { types: readonly string[]; update: () => Promise<void> }[] = [];
		const finished = new DeferredPromise<void>();
		if (options.support === false) {
			Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
		} else {
			Object.defineProperty(document, 'startViewTransition', {
				configurable: true,
				value: (init: { update: () => Promise<void>; types?: string[] }) => {
					started.push({ types: init.types ?? [], update: init.update });
					return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: finished.p, skipTransition: () => undefined };
				}
			});
		}
		const detail = document.body.appendChild(document.createElement('div'));
		detail.className = 'detail';
		const card = document.body.appendChild(document.createElement('div'));
		card.className = 'card';
		const caption = card.appendChild(document.createElement('div'));
		caption.className = 'caption';
		const names = () => Object.fromEntries([detail, card, caption]
			.filter(element => element.style.getPropertyValue('view-transition-name'))
			.map(element => [element.className, element.style.getPropertyValue('view-transition-name')]));
		return { detail, card, caption, started, finish: () => finished.complete(), names };
	}

	function step(fixture: ITransitionFixture, direction: 'open' | 'close', drawn: Promise<unknown>, log: string[], overrides: Partial<IBaseHalfCardDetailTransitionStep> = {}): IBaseHalfCardDetailTransitionStep {
		return {
			direction,
			detail: fixture.detail,
			card: () => ({ box: fixture.card, caption: fixture.caption }),
			draw: () => log.push(`draw with ${JSON.stringify(fixture.names())}`),
			ready: () => drawn,
			wait: BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS,
			reducedMotion: false,
			onError: error => log.push(`error ${error}`),
			...overrides
		};
	}

	test('opening names the card and its name before, draws once the browser has kept the window, and names Card Detail once it is drawn', async () => {
		const fixture = createDocument();
		const transition = new BaseHalfCardDetailTransition();
		const log: string[] = [];
		const drawn = new DeferredPromise<void>();
		const ran = transition.run(step(fixture, 'open', drawn.p, log, { finished: () => log.push('finished') }));
		const before = { names: fixture.names(), drawing: transition.drawing, log: [...log] };
		const update = fixture.started[0].update();
		const drawing = { names: fixture.names(), drawing: transition.drawing, log: [...log] };
		drawn.complete();
		await update;
		const after = fixture.names();
		fixture.finish();
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.deepStrictEqual({ ran, types: fixture.started[0].types, before, drawing, after, end: { names: fixture.names(), log } }, {
			ran: true,
			types: ['basehalf-card-detail-open'],
			before: { names: { card: 'basehalf-card-detail', caption: 'basehalf-card-detail-caption' }, drawing: true, log: [] },
			drawing: { names: {}, drawing: false, log: ['draw with {}'] },
			after: { detail: 'basehalf-card-detail' },
			end: { names: {}, log: ['draw with {}', 'finished'] }
		});
	});

	test('closing names Card Detail before and the card and its name after, with reduced motion as the type that stops the motion', async () => {
		const fixture = createDocument();
		const log: string[] = [];
		new BaseHalfCardDetailTransition().run(step(fixture, 'close', Promise.resolve(), log, { reducedMotion: true }));
		const before = fixture.names();
		await fixture.started[0].update();
		assert.deepStrictEqual({ types: fixture.started[0].types, before, after: fixture.names(), log }, {
			types: ['basehalf-card-detail-close', 'basehalf-reduced-motion'],
			before: { detail: 'basehalf-card-detail' },
			after: { card: 'basehalf-card-detail', caption: 'basehalf-card-detail-caption' },
			log: ['draw with {}']
		});
		fixture.finish();
	});

	test('a Card Detail that is not drawn in time grows in as it is: the transition waits at most its wait', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const fixture = createDocument();
		const log: string[] = [];
		new BaseHalfCardDetailTransition().run(step(fixture, 'open', new DeferredPromise<void>().p, log));
		const start = Date.now();
		await fixture.started[0].update();
		assert.deepStrictEqual({ waited: Date.now() - start, names: fixture.names() }, { waited: BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS, names: { detail: 'basehalf-card-detail' } });
		fixture.finish();
	}));

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
			transition.run(step(refusing, 'open', Promise.resolve(), log))
		];
		assert.deepStrictEqual({ ran, log, drawing: transition.drawing, names: [unsupported.names(), hidden.names(), refusing.names()] }, {
			// The caller draws for the first two; the third drew, and said what failed.
			ran: [false, false, true],
			log: ['draw with {}', 'error Error: refused'],
			drawing: false,
			names: [{}, {}, {}]
		});
	});
});

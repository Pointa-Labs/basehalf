/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BaseHalfCanvasCardListenerStores } from '../../common/basehalfCanvasCardListeners.js';

suite('BaseHalfCanvasCardListenerStores', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	/** A card element with one listener; `live` says whether that listener would still fire. */
	function card(stores: BaseHalfCanvasCardListenerStores, path: string, inDocument: boolean) {
		const element = { isConnected: inDocument };
		const state = { element, live: true };
		stores.replace(path, element).add(toDisposable(() => state.live = false));
		return state;
	}

	test('a replaced element keeps its listeners until the scene swaps it', () => {
		const stores = disposables.add(new BaseHalfCanvasCardListenerStores());
		const onScreen = card(stores, 'a.md', true);
		const replacement = card(stores, 'a.md', false);
		const whileOldIsOnScreen = [onScreen.live, replacement.live];

		onScreen.element.isConnected = false;
		replacement.element.isConnected = true;
		stores.didMount('a.md', replacement.element);

		assert.deepStrictEqual({ whileOldIsOnScreen, afterSwap: [onScreen.live, replacement.live] }, {
			whileOldIsOnScreen: [true, true],
			afterSwap: [false, true]
		});
	});

	test('an element replaced before it reached the document is released at once, and a late report for it changes nothing', () => {
		const stores = disposables.add(new BaseHalfCanvasCardListenerStores());
		const onScreen = card(stores, 'a.md', true);
		const neverMounted = card(stores, 'a.md', false);
		const newest = card(stores, 'a.md', false);
		const afterReplace = [onScreen.live, neverMounted.live, newest.live];

		stores.didMount('a.md', neverMounted.element);
		const afterLateReport = [onScreen.live, neverMounted.live, newest.live];
		stores.didMount('a.md', newest.element);

		assert.deepStrictEqual({ afterReplace, afterLateReport, afterSwap: [onScreen.live, neverMounted.live, newest.live] }, {
			afterReplace: [true, false, true],
			afterLateReport: [true, false, true],
			afterSwap: [false, false, true]
		});
	});

	test('removing a card, resetting, and disposing release every store, kept ones included', () => {
		const stores = disposables.add(new BaseHalfCanvasCardListenerStores());
		const removedOld = card(stores, 'removed.md', true);
		const removedNew = card(stores, 'removed.md', false);
		const stays = card(stores, 'stays.md', true);

		stores.retain(new Set(['stays.md']));
		const afterRemove = [removedOld.live, removedNew.live, stays.live];
		const staysNew = card(stores, 'stays.md', false);
		stores.clear();
		const afterReset = [stays.live, staysNew.live];
		const last = card(stores, 'last.md', true);
		stores.dispose();

		assert.deepStrictEqual({ afterRemove, afterReset, afterDispose: last.live }, {
			afterRemove: [false, false, true],
			afterReset: [false, false],
			afterDispose: false
		});
	});
});

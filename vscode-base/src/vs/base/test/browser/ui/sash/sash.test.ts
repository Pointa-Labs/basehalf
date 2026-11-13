/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// BaseHalf: a sash shows its hover when the pointer moves on it, not when the
// browser reports an enter alone (onMouseMove), and lets go of it when the
// pointer moves where its window's document does not see it (releaseSashHover).

import * as assert from 'assert';
import { mainWindow } from '../../../../browser/window.js';
import { Orientation, releaseSashHover, Sash, setGlobalHoverDelay } from '../../../../browser/ui/sash/sash.js';
import { timeout } from '../../../../common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('Sash', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let container: HTMLElement;

	setup(() => {
		container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		setGlobalHoverDelay(20);
	});

	teardown(() => {
		setGlobalHoverDelay(300);
		container.remove();
	});

	/** A sash, by its element. */
	function sash(): HTMLElement {
		store.add(new Sash(container, { getVerticalSashLeft: () => 100 }, { orientation: Orientation.VERTICAL }));
		return container.lastElementChild as HTMLElement;
	}

	test('a sash the pointer moved on and left into a webview does not show its hover line', async () => {
		const entered = sash();
		entered.dispatchEvent(new MouseEvent('mouseenter'));
		entered.dispatchEvent(new MouseEvent('mousemove'));
		// The pointer went on into a webview, which reports its moves.
		releaseSashHover(mainWindow);
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), false);
	});

	test('a sash whose hover line shows lets go of it, and shows it again when the pointer moves on it', async () => {
		const entered = sash();
		entered.dispatchEvent(new MouseEvent('mouseenter'));
		entered.dispatchEvent(new MouseEvent('mousemove'));
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), true);
		releaseSashHover(mainWindow);
		assert.strictEqual(entered.classList.contains('hover'), false);
		// Back from the webview onto the sash: the window heard no leave, so it reports moves and no enter.
		entered.dispatchEvent(new MouseEvent('mousemove'));
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), true);
	});

	test('a sash the browser reports entered, with no move on it, does not show its hover line', async () => {
		const entered = sash();
		// Card Detail closed under a pointer in its reader: the window reports an enter where it last saw the
		// pointer, on the sash it crossed into the reader.
		entered.dispatchEvent(new MouseEvent('mouseenter'));
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), false);
		entered.dispatchEvent(new MouseEvent('mousemove'));
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), true);
	});
});

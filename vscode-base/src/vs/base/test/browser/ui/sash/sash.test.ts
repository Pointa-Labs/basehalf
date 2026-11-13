/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// BaseHalf: a sash lets go of its hover when the pointer moves where its
// window's document does not see it (releaseSashHover).

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

	test('a sash the pointer left into a webview does not show its hover line', async () => {
		const entered = sash();
		entered.dispatchEvent(new MouseEvent('mouseenter'));
		// The pointer went on into a webview, which reports its moves.
		releaseSashHover(mainWindow);
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), false);
	});

	test('a sash whose hover line shows lets go of it, and a sash the pointer is still over keeps it until then', async () => {
		const entered = sash();
		entered.dispatchEvent(new MouseEvent('mouseenter'));
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), true);
		releaseSashHover(mainWindow);
		assert.strictEqual(entered.classList.contains('hover'), false);
		// Entered again, it shows its line again.
		entered.dispatchEvent(new MouseEvent('mouseenter'));
		await timeout(60);
		assert.strictEqual(entered.classList.contains('hover'), true);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfMediaKeyAction, baseHalfMediaPressKeepsKeyboard } from '../../browser/basehalfMediaKeys.js';

/**
 * The keys of a video's and a sound's player and editor (editing media, "The
 * keyboard"), which Card Detail and the editor of a note's media share (D114).
 */
suite('BaseHalfMediaKeys', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function setUp() {
		const within = mainWindow.document.createElement('div');
		within.innerHTML = '<div class="media" tabindex="-1"></div><button type="button">Play</button><div role="slider" tabindex="0"></div><input type="text">';
		mainWindow.document.body.appendChild(within);
		const [media, button, slider, field] = [...within.children] as HTMLElement[];
		const key = (target: HTMLElement, init: KeyboardEventInit) => {
			let action: ReturnType<typeof baseHalfMediaKeyAction>;
			const listener = (event: KeyboardEvent) => { action = baseHalfMediaKeyAction(event, within); };
			within.addEventListener('keydown', listener);
			target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
			within.removeEventListener('keydown', listener);
			return action;
		};
		return { within, media, button, slider, field, key, dispose: () => within.remove() };
	}

	test('Space plays, the arrows move the playhead a second or with Shift a frame, Home and End to the ends', () => {
		const { media, key, dispose } = setUp();
		assert.deepStrictEqual([
			key(media, { key: ' ' }),
			key(media, { key: 'ArrowLeft' }),
			key(media, { key: 'ArrowRight', shiftKey: true }),
			key(media, { key: 'Home' }),
			key(media, { key: 'End' }),
		], [
			'play',
			{ kind: 'step', by: 'second', direction: -1 },
			{ kind: 'step', by: 'frame', direction: 1 },
			{ kind: 'jump', to: 'start' },
			{ kind: 'jump', to: 'end' },
		]);
		dispose();
	});

	test('a control or a field that takes a key itself keeps it, and a key with a modifier or held does nothing', () => {
		const { media, button, slider, field, key, dispose } = setUp();
		assert.deepStrictEqual([
			key(button, { key: ' ' }),
			key(button, { key: 'ArrowLeft' }),
			key(slider, { key: 'ArrowRight' }),
			key(field, { key: 'Home' }),
			key(media, { key: ' ', repeat: true }),
			key(media, { key: ' ', shiftKey: true }),
			key(media, { key: 'ArrowLeft', metaKey: true }),
			key(media, { key: 'End', shiftKey: true }),
			key(media, { key: 'a' }),
		], [
			undefined,
			{ kind: 'step', by: 'second', direction: -1 },
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		]);
		dispose();
	});

	test('a press of a button or a handle leaves the keyboard where it was; a field of text takes it', () => {
		const { within, media, button, slider, field, dispose } = setUp();
		assert.deepStrictEqual([media, button, slider, field].map(target => baseHalfMediaPressKeepsKeyboard(target, within)), [false, true, true, false]);
		dispose();
	});
});

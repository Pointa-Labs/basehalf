/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { playBaseHalfCanvasMediaOneAtATime, releaseBaseHalfCanvasCardMedia } from '../../browser/basehalfCanvasCardMedia.js';

suite('BaseHalfCanvasCardMedia', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('stops and unloads detached transports', () => {
		const calls: string[] = [];
		const media = {
			pause: () => calls.push('pause'),
			removeAttribute: (name: string) => calls.push(`remove:${name}`),
			load: () => calls.push('load')
		} as unknown as HTMLMediaElement;

		releaseBaseHalfCanvasCardMedia(media);

		assert.deepStrictEqual(calls, ['pause', 'remove:src', 'load']);
	});

	test('one video or sound in the canvas plays at a time, on cards and in notes alike', () => {
		const root = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(root);
		const paused: string[] = [];
		const medium = (name: string, tag: 'video' | 'audio') => {
			const element = root.appendChild(mainWindow.document.createElement(tag));
			let playing = false;
			Object.defineProperty(element, 'paused', { configurable: true, get: () => !playing });
			element.play = () => {
				playing = true;
				element.dispatchEvent(new Event('play'));
				return Promise.resolve();
			};
			element.pause = () => {
				paused.push(name);
				if (playing) {
					playing = false;
					element.dispatchEvent(new Event('pause'));
				}
			};
			return element;
		};
		try {
			store.add(playBaseHalfCanvasMediaOneAtATime(root));
			const card = medium('card video', 'video');
			const sound = medium('sound card', 'audio');
			const note = medium('video in a note', 'video');
			for (const media of [card, sound, note, card]) {
				media.play();
			}
			assert.deepStrictEqual({ paused, playing: [card, sound, note].map(media => !media.paused) }, {
				paused: ['card video', 'sound card', 'video in a note'],
				playing: [true, false, false]
			});
		} finally {
			root.remove();
		}
	});
});

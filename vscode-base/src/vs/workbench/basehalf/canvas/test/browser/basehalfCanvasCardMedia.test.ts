/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS, playBaseHalfCanvasMediaOneAtATime, playBaseHalfCanvasSoundInTurn, registerBaseHalfCanvasMediaPause, releaseBaseHalfCanvasCardMedia, whenBaseHalfCanvasMediaDrawn } from '../../browser/basehalfCanvasCardMedia.js';

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

	test('says once when the picture can be drawn: the first frame of a video, an image that loaded, or a failure', () => {
		const owner = store.add(new DisposableStore());
		const drawn: string[] = [];
		const video = mainWindow.document.createElement('video');
		let readyState = 0;
		Object.defineProperty(video, 'readyState', { configurable: true, get: () => readyState });
		whenBaseHalfCanvasMediaDrawn(video, owner, () => drawn.push('video'));
		const before = [...drawn];
		video.dispatchEvent(new Event('loadedmetadata'));
		const metadata = [...drawn];
		readyState = 2;
		video.dispatchEvent(new Event('loadeddata'));
		video.dispatchEvent(new Event('seeked'));
		const image = mainWindow.document.createElement('img');
		whenBaseHalfCanvasMediaDrawn(image, owner, () => drawn.push('image'));
		image.dispatchEvent(new Event('error'));
		// A video that has its frame already says so at once.
		const shown = mainWindow.document.createElement('video');
		Object.defineProperty(shown, 'readyState', { configurable: true, get: () => 4 });
		whenBaseHalfCanvasMediaDrawn(shown, owner, () => drawn.push('shown'));
		assert.deepStrictEqual({ before, metadata, drawn }, { before: [], metadata: [], drawn: ['video', 'image', 'shown'] });
	});

	test('a picture that never says it can be drawn is taken as drawn after a while', () => runWithFakedTimers({}, async () => {
		const owner = store.add(new DisposableStore());
		const drawn: number[] = [];
		const video = mainWindow.document.createElement('video');
		Object.defineProperty(video, 'readyState', { configurable: true, get: () => 1 });
		whenBaseHalfCanvasMediaDrawn(video, owner, () => drawn.push(Date.now()));
		const start = Date.now();
		await new Promise(resolve => setTimeout(resolve, BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS + 10));
		assert.deepStrictEqual(drawn.map(time => time - start >= BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS), [true]);
	}));

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
			// A player whose sound goes down before it pauses pauses its own way when another starts.
			const own: string[] = [];
			const registration = registerBaseHalfCanvasMediaPause(card, () => own.push('card video, its sound down first'));
			note.play();
			registration.dispose();
			card.play();
			sound.play();
			assert.deepStrictEqual({ own, paused: paused.slice(3) }, {
				own: ['card video, its sound down first'],
				paused: ['video in a note', 'card video']
			});
		} finally {
			root.remove();
		}
	});

	test('a sound that plays in turn, such as a voice\'s sample, stops for a video or a sound that starts with its sound or whose sound comes on, not for one that plays without sound, as the preview under the pointer does (D78)', () => {
		const root = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(root);
		const medium = (tag: 'video' | 'audio', muted: boolean) => {
			const element = root.appendChild(mainWindow.document.createElement(tag));
			const state = { playing: false, muted };
			Object.defineProperty(element, 'paused', { configurable: true, get: () => !state.playing });
			Object.defineProperty(element, 'muted', { configurable: true, get: () => state.muted });
			element.play = () => {
				state.playing = true;
				element.dispatchEvent(new Event('play'));
				return Promise.resolve();
			};
			element.pause = () => {
				state.playing = false;
			};
			return { element, state };
		};
		try {
			store.add(playBaseHalfCanvasMediaOneAtATime(root));
			const stopped: string[] = [];
			const first = store.add(playBaseHalfCanvasSoundInTurn(() => stopped.push('first sample')));
			// The preview of a video under the pointer plays without sound: the sample goes on.
			const preview = medium('video', true);
			preview.element.play();
			const whilePreview = [...stopped];
			// Its sound turned on while it plays stops the sample.
			preview.state.muted = false;
			preview.element.dispatchEvent(new Event('volumechange'));
			const soundOn = [...stopped];
			first.dispose();
			store.add(playBaseHalfCanvasSoundInTurn(() => stopped.push('second sample')));
			// A video that does not play gives no sound when its sound is turned on.
			const still = medium('video', true);
			still.state.muted = false;
			still.element.dispatchEvent(new Event('volumechange'));
			const stillSoundOn = [...stopped];
			// A sound card that starts with its sound stops the sample at once.
			medium('audio', false).element.play();
			assert.deepStrictEqual({ whilePreview, soundOn, stillSoundOn, stopped }, {
				whilePreview: [],
				soundOn: ['first sample'],
				stillSoundOn: ['first sample'],
				stopped: ['first sample', 'second sample']
			});
		} finally {
			root.remove();
		}
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_CANVAS_VIDEO_CONTROLS_FADE_MS, createBaseHalfCanvasCardVideoPlayer, formatBaseHalfCanvasVideoTime, IBaseHalfCanvasCardVideoPlayer, layoutBaseHalfCanvasCardVideoPlayers } from '../../browser/basehalfCanvasCardVideoPlayer.js';

suite('BaseHalfCanvasCardVideoPlayer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IPlayerFixture {
		readonly player: IBaseHalfCanvasCardVideoPlayer;
		readonly container: HTMLElement;
		/** What reached the card: the events that left the player. */
		readonly reachedCard: string[];
		/** What the video was asked to do. */
		readonly media: string[];
		readonly opened: number[];
		readonly time: { value: number };
		readonly control: (name: 'sound' | 'play' | 'open') => HTMLButtonElement;
		readonly slider: () => HTMLElement;
	}

	const frames: HTMLElement[] = [];
	// Each player shows a video of its own unless a test names one: a player
	// starts where the last player of its video stopped.
	let players = 0;
	teardown(() => {
		for (const frame of frames.splice(0)) {
			frame.remove();
		}
	});

	/** A player in a card of the given width on screen, with a video of ten seconds that plays when asked; with `detail`, the player of Card Detail; with `sound`, of a sound. */
	function createPlayer(width = 320, source: string | URI = `/workspace/clip-${++players}.mp4`, detail = false, sound = false): IPlayerFixture {
		const frame = mainWindow.document.createElement('div');
		frame.className = 'monaco-workbench';
		mainWindow.document.body.appendChild(frame);
		frames.push(frame);
		const container = mainWindow.document.createElement('div');
		container.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px; height: ${Math.round(width * 9 / 16)}px;`;
		frame.appendChild(container);
		const reachedCard: string[] = [];
		for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown']) {
			container.addEventListener(type, event => reachedCard.push(`${type}:${(event.target as HTMLElement).className.split(' ')[0]}`));
		}
		const opened: number[] = [];
		const player = store.add(createBaseHalfCanvasCardVideoPlayer(container, null, {
			source: typeof source === 'string' ? URI.file(source) : source,
			videoClasses: ['card-video'],
			open: () => opened.push(opened.length + 1),
			onError: () => { /* the test video is never loaded */ },
			detail,
			sound,
			// No audio graph: the sound starts and stops at once (basehalfCanvasVideoSound.test.ts has the fades).
			soundGraph: () => undefined
		}));
		const media: string[] = [];
		const video = player.video;
		let paused = true;
		const time = { value: 0 };
		Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
		Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
		Object.defineProperty(video, 'duration', { configurable: true, get: () => 10 });
		Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time.value, set: (value: number) => { time.value = value; } });
		video.play = () => {
			media.push(video.muted ? 'play muted' : 'play');
			if (paused) {
				paused = false;
				video.dispatchEvent(new Event('play'));
			}
			return Promise.resolve();
		};
		video.pause = () => {
			media.push('pause');
			if (!paused) {
				paused = true;
				video.dispatchEvent(new Event('pause'));
			}
		};
		const control = (name: 'sound' | 'play' | 'open') => player.element.querySelector<HTMLButtonElement>(`.basehalf-canvas-video-player-button.${name}`)!;
		const slider = () => player.element.querySelector<HTMLElement>('.basehalf-canvas-video-player-slider')!;
		return { player, container, reachedCard, media, opened, time, control, slider };
	}

	const point = (target: Element, type: 'pointerenter' | 'pointerleave') => target.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }));

	test('the picture is the card\'s: it takes no pointer, a click on it reaches the card and plays nothing, and a double click, which opens the card, pauses it', () => {
		const { player, reachedCard, media } = createPlayer();
		// The pointer that clicks plays the video.
		point(player.element, 'pointerenter');
		player.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		player.element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		assert.deepStrictEqual({
			picturePointer: player.video.style.pointerEvents,
			videoClasses: [...player.video.classList],
			pictureIsDraggable: !player.element.classList.contains('nodrag'),
			controls: [...player.element.querySelectorAll('.nodrag')].map(element => element.className),
			reachedCard,
			media
		}, {
			picturePointer: 'none',
			videoClasses: ['basehalf-canvas-video-player-video', 'card-video'],
			pictureIsDraggable: true,
			controls: ['basehalf-canvas-video-player-top nodrag nopan', 'basehalf-canvas-video-player-bar nodrag nopan'],
			reachedCard: ['click:basehalf-canvas-video-player', 'dblclick:basehalf-canvas-video-player'],
			media: ['play muted', 'pause']
		});
	});

	test('the pointer plays the video without sound and leaving pauses it, also on a selected card', () => {
		const { player, media } = createPlayer();
		point(player.element, 'pointerenter');
		point(player.element, 'pointerleave');
		player.setSelected(true);
		point(player.element, 'pointerenter');
		point(player.element, 'pointerleave');
		assert.deepStrictEqual(media, ['play muted', 'pause', 'play muted', 'pause']);
	});

	test('the controls show while the pointer is on the card or the card is selected, and not on a narrow card', () => {
		const { player } = createPlayer();
		const state = () => `${player.element.dataset.controls} ${player.element.querySelector<HTMLElement>('.basehalf-canvas-video-player-button.play')!.tabIndex}`;
		const seen = [state()];
		point(player.element, 'pointerenter');
		seen.push(state());
		point(player.element, 'pointerleave');
		seen.push(state());
		player.setSelected(true);
		seen.push(state());
		player.setSelected(false);
		seen.push(state());
		const narrow = createPlayer(120);
		point(narrow.player.element, 'pointerenter');
		narrow.player.setSelected(true);
		assert.deepStrictEqual({ seen, narrow: narrow.player.element.dataset.controls, narrowPlays: narrow.media }, {
			seen: ['hidden -1', 'shown 0', 'hidden -1', 'shown 0', 'hidden -1'],
			narrow: 'hidden',
			narrowPlays: ['play muted']
		});
	});

	test('the controls of a selected card follow the canvas zoom: narrow on screen hides them, wide again shows them', async () => {
		const { player, container } = createPlayer();
		const resting = createPlayer();
		player.setSelected(true);
		const nextFrame = () => new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		const seen = [player.element.dataset.controls];
		// The zoom draws the card of 320 at 128 screen pixels, then at 320 again, as the canvas scales its cards.
		container.style.transformOrigin = '0 0';
		for (const scale of [0.4, 1]) {
			container.style.transform = `scale(${scale})`;
			layoutBaseHalfCanvasCardVideoPlayers();
			layoutBaseHalfCanvasCardVideoPlayers();
			await nextFrame();
			seen.push(player.element.dataset.controls);
		}
		assert.deepStrictEqual({ seen, resting: resting.player.element.dataset.controls }, { seen: ['shown', 'hidden', 'shown'], resting: 'hidden' });
	});

	test('a press on the controls is theirs: play and pause, sound, and Open, which pauses the video, and nothing reaches the card', () => {
		const { player, reachedCard, media, opened, control } = createPlayer();
		player.setSelected(true);
		for (const type of ['pointerdown', 'mousedown']) {
			control('play').dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
		}
		control('play').click();
		const playing = control('play').getAttribute('aria-label');
		control('play').click();
		const paused = control('play').getAttribute('aria-label');
		control('sound').click();
		const sound = control('sound').getAttribute('aria-label');
		point(player.element, 'pointerenter');
		control('open').click();
		control('open').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		assert.deepStrictEqual({ media, playing, paused, sound, muted: player.video.muted, opened, reachedCard }, {
			media: ['play muted', 'pause', 'play', 'pause'],
			playing: 'Pause',
			paused: 'Play',
			sound: 'Mute',
			muted: false,
			opened: [1],
			reachedCard: []
		});
	});

	test('the position slider moves the video, by the pointer and by the keyboard, and not the card', () => {
		const { player, reachedCard, time, slider } = createPlayer();
		player.setSelected(true);
		const bounds = slider().getBoundingClientRect();
		assert.ok(bounds.width > 0, 'the slider has a width on screen');
		const at = (fraction: number) => bounds.left + bounds.width * fraction;
		const seen: number[] = [];
		slider().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: at(0.25) }));
		seen.push(time.value);
		slider().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: at(0.5) }));
		seen.push(time.value);
		slider().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: at(0.5) }));
		slider().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: at(0.9) }));
		seen.push(time.value);
		for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft', 'End', 'Home']) {
			slider().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
			seen.push(time.value);
		}
		time.value = 4.45;
		player.video.dispatchEvent(new Event('timeupdate'));
		assert.deepStrictEqual({
			seen: seen.map(value => Math.round(value * 100) / 100),
			valueText: slider().getAttribute('aria-valuetext'),
			reachedCard
		}, {
			seen: [2.5, 5, 5, 6, 5, 4, 10, 0],
			valueText: '4.4s of 10.0s',
			reachedCard: []
		});
	});

	test('while a part stands for the file, the position slider spans the part: its middle is the part\'s middle, End its last frame, Home its first, and its time counts from the part (D102)', () => {
		const { player, time, slider } = createPlayer();
		player.setSelected(true);
		// A part from 2 s to 6 s that plays once, as Card Detail views an edited video; its last frame starts at 5.9 s.
		player.setPlayRange({ start: 2, end: 6, lastFrame: 5.9 });
		const bounds = slider().getBoundingClientRect();
		const at = (fraction: number) => bounds.left + bounds.width * fraction;
		const seen: number[] = [];
		slider().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: at(0.5) }));
		seen.push(time.value);
		slider().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: at(1) }));
		seen.push(time.value);
		slider().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: at(1) }));
		for (const key of ['Home', 'ArrowLeft', 'End', 'ArrowRight']) {
			slider().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
			seen.push(time.value);
		}
		time.value = 4;
		player.video.dispatchEvent(new Event('timeupdate'));
		assert.deepStrictEqual({ seen: seen.map(value => Math.round(value * 1000) / 1000), valueText: slider().getAttribute('aria-valuetext') }, {
			seen: [3.95, 5.9, 2, 2, 5.9, 5.9],
			valueText: '2.0s of 4.0s'
		});
	});

	test('the arrow keys on a control that has the focus are the control\'s, and reach no card', () => {
		const { player, reachedCard, control } = createPlayer();
		player.setSelected(true);
		for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Escape']) {
			control('play').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
		}
		assert.deepStrictEqual(reachedCard, ['keydown:basehalf-canvas-video-player-button']);
	});

	test('a resized card shows or hides the controls of its selected player for its new width', async () => {
		const { player, container } = createPlayer();
		player.setSelected(true);
		const nextFrame = () => new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		const seen = [player.element.dataset.controls];
		for (const width of [140, 320]) {
			container.style.width = `${width}px`;
			await nextFrame();
			await nextFrame();
			seen.push(player.element.dataset.controls);
		}
		assert.deepStrictEqual(seen, ['shown', 'hidden', 'shown']);
	});

	test('a player drawn again for the same video starts where the last one stopped, with its sound', () => {
		const first = createPlayer(320, '/workspace/again.mp4');
		first.time.value = 1.25;
		first.control('sound').click();
		first.player.dispose();
		const second = createPlayer(320, '/workspace/again.mp4');
		const other = createPlayer(320, '/workspace/other.mp4');
		point(second.player.element, 'pointerenter');
		assert.deepStrictEqual({
			start: second.player.video.getAttribute('src')?.split('#')[1],
			sound: second.control('sound').getAttribute('aria-label'),
			plays: second.media,
			otherStart: other.player.video.getAttribute('src')?.split('#')[1]
		}, { start: 't=1.25', sound: 'Mute', plays: ['play'], otherStart: 't=0.001' });
	});

	test('a player loads the version of the file that its source names, and another version by another address', () => {
		const file = URI.file('/workspace/take.mp4');
		const first = createPlayer(320, file.with({ query: 'basehalfCanvasVersion=1-10' }));
		const second = createPlayer(320, file.with({ query: 'basehalfCanvasVersion=2-20' }));
		const address = (fixture: IPlayerFixture) => new URL(fixture.player.video.getAttribute('src') ?? '');
		assert.deepStrictEqual([first, second].map(fixture => [address(fixture).pathname, address(fixture).searchParams.get('basehalfCanvasVersion')]), [['/workspace/take.mp4', '1-10'], ['/workspace/take.mp4', '2-20']]);
	});

	test('the time reads seconds under a minute and minutes from a minute on', () => {
		assert.deepStrictEqual([0, 4.45, 59.99, 65.9, Number.NaN].map(formatBaseHalfCanvasVideoTime), ['0.0s', '4.4s', '59.9s', '1:05', '0.0s']);
	});

	test('disposing the player releases its video and removes it from the card', () => {
		const { player, container } = createPlayer();
		player.dispose();
		assert.deepStrictEqual({ inCard: container.contains(player.element), source: player.video.getAttribute('src') }, { inCard: false, source: null });
	});
	test('in Card Detail the picture is the player\'s: the controls show while it is paused, a click plays and pauses the video with its sound and puts the keyboard on the player itself, not on Play (D100), the pointer plays nothing, and Full Screen stands where Open is', () => {
		const { player, media, control } = createPlayer(640, undefined, true);
		// Card Detail draws its player once it knows the video's shape (D98), and the keyboard can be on it from then on.
		Object.defineProperty(player.video, 'videoWidth', { configurable: true, get: () => 1280 });
		Object.defineProperty(player.video, 'videoHeight', { configurable: true, get: () => 720 });
		player.video.dispatchEvent(new Event('loadedmetadata'));
		const seen = {
			controls: player.element.dataset.controls,
			picturePointer: player.video.style.pointerEvents,
			open: control('open').getAttribute('aria-label'),
			sound: control('sound').getAttribute('aria-label')
		};
		point(player.element, 'pointerenter');
		player.video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		const playing = control('play').getAttribute('aria-label');
		player.video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		point(player.element, 'pointerleave');
		assert.deepStrictEqual({ seen, playing, media, keyboardOnPlayer: mainWindow.document.activeElement === player.element, player: [player.element.tabIndex, player.element.getAttribute('role'), player.element.getAttribute('aria-label')] }, {
			seen: { controls: 'shown', picturePointer: '', open: 'Full Screen', sound: 'Mute' },
			playing: 'Pause',
			media: ['play', 'pause'],
			keyboardOnPlayer: true,
			player: [-1, 'group', 'Video']
		});
	});

	test('in Card Detail the controls fade while the video plays once the pointer rests, come back with a move or a key, go when the pointer leaves, and stay while it is paused; faded, the keyboard still reaches them (D98)', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { player, control } = createPlayer(640, undefined, true);
		const seen: string[] = [];
		const note = () => seen.push(player.element.dataset.controls ?? '');
		const move = () => player.element.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }));
		note();
		move();
		player.video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		note();
		await timeout(BASEHALF_CANVAS_VIDEO_CONTROLS_FADE_MS + 10);
		note();
		const reachable = { play: control('play').tabIndex, hidden: player.element.querySelector('.basehalf-canvas-video-player-bar')!.getAttribute('aria-hidden') };
		move();
		note();
		player.element.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
		note();
		mainWindow.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
		note();
		await timeout(BASEHALF_CANVAS_VIDEO_CONTROLS_FADE_MS + 10);
		note();
		player.video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		note();
		await timeout(BASEHALF_CANVAS_VIDEO_CONTROLS_FADE_MS + 10);
		note();
		assert.deepStrictEqual({ seen, reachable }, {
			seen: ['shown', 'shown', 'faded', 'shown', 'faded', 'shown', 'faded', 'shown', 'shown'],
			reachable: { play: 0, hidden: 'false' }
		});
	}));

	test('on a card the controls neither fade nor wait: they show while the pointer is on it and go when it leaves, also while the video plays (D98)', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { player } = createPlayer(320);
		const seen: string[] = [];
		point(player.element, 'pointerenter');
		seen.push(player.element.dataset.controls ?? '');
		await timeout(BASEHALF_CANVAS_VIDEO_CONTROLS_FADE_MS + 10);
		seen.push(player.element.dataset.controls ?? '');
		point(player.element, 'pointerleave');
		seen.push(player.element.dataset.controls ?? '');
		assert.deepStrictEqual(seen, ['shown', 'shown', 'hidden']);
	}));

	test('Card Detail\'s player has the shape a card\'s player loaded for the same video from its first frame, and one no card loaded waits unseen for its own (D98)', () => {
		const loaded = (player: IBaseHalfCanvasCardVideoPlayer, width: number, height: number) => {
			Object.defineProperty(player.video, 'videoWidth', { configurable: true, get: () => width });
			Object.defineProperty(player.video, 'videoHeight', { configurable: true, get: () => height });
			player.video.dispatchEvent(new Event('loadedmetadata'));
		};
		const shape = (player: IBaseHalfCanvasCardVideoPlayer) => ({ aspect: player.element.style.getPropertyValue('--basehalf-video-aspect'), sizing: player.element.classList.contains('sizing') });
		// A portrait video that its card played: Card Detail draws it as tall as it is at once.
		const card = createPlayer(320, '/workspace/portrait.mp4');
		loaded(card.player, 720, 1280);
		const known = shape(createPlayer(640, '/workspace/portrait.mp4', true).player);
		// A video no card loaded: Card Detail's player is not seen until it has its own shape.
		const unknown = createPlayer(640, '/workspace/unseen.mp4', true).player;
		const before = shape(unknown);
		loaded(unknown, 1080, 1080);
		assert.deepStrictEqual({ known, before, after: shape(unknown) }, {
			known: { aspect: String(720 / 1280), sizing: false },
			before: { aspect: '', sizing: true },
			after: { aspect: '1', sizing: false }
		});
	});

	test('a sound shows the glyph of a sound, has no sound button, plays only by Play and with its sound, and goes on while its card is selected', () => {
		const { player, media, control } = createPlayer(320, '/workspace/take.wav', false, true);
		const seen = {
			sound: player.element.classList.contains('sound'),
			glyph: !!player.element.querySelector('.basehalf-canvas-video-player-picture svg'),
			soundButton: control('sound').parentElement?.hidden,
			open: control('open').getAttribute('aria-label')
		};
		point(player.element, 'pointerenter');
		const underThePointer = [...media];
		control('play').click();
		point(player.element, 'pointerleave');
		player.setSelected(true);
		control('play').click();
		point(player.element, 'pointerleave');
		const whileSelected = [...media];
		player.setSelected(false);
		assert.deepStrictEqual({ seen, underThePointer, whileSelected, media }, {
			seen: { sound: true, glyph: true, soundButton: true, open: 'Open' },
			underThePointer: [],
			// Leaving a card that is not selected pauses it; a selected one plays on.
			whileSelected: ['play', 'pause', 'play'],
			media: ['play', 'pause', 'play', 'pause']
		});
	});

	test('in Card Detail a sound has no Full Screen, and a click on its glyph plays and pauses it and puts the keyboard on the player (D100)', () => {
		const { player, media, control } = createPlayer(640, '/workspace/voice.mp3', true, true);
		const picture = player.element.querySelector<HTMLElement>('.basehalf-canvas-video-player-picture')!;
		picture.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		picture.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		assert.deepStrictEqual({
			fullScreen: control('open').hidden,
			controls: player.element.dataset.controls,
			tabbable: [control('sound'), control('play'), control('open')].map(button => button.tabIndex),
			media,
			keyboardOnPlayer: mainWindow.document.activeElement === player.element,
			label: player.element.getAttribute('aria-label')
		}, { fullScreen: true, controls: 'shown', tabbable: [-1, 0, -1], media: ['play', 'pause'], keyboardOnPlayer: true, label: 'Sound' });
	});

	test('Card Detail starts at the frame its card shows, also when the canvas asks for the file with its version, and leaves the card at the frame where it stopped', () => {
		const card = createPlayer(320, URI.file('/workspace/shot.mp4').with({ query: 'basehalfCanvasVersion=1792728899792-2709245' }));
		card.time.value = 3.2;
		const detail = createPlayer(640, '/workspace/shot.mp4', true);
		const startsAt = new URL(detail.player.video.src).hash;
		detail.time.value = 4.5;
		detail.player.dispose();
		assert.deepStrictEqual({ startsAt, card: card.time.value }, { startsAt: '#t=3.2', card: 4.5 });
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IBaseHalfCanvasCardVideoPlayer, IBaseHalfCanvasVideoPlayRange } from '../../../canvas/browser/basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfMediaChoices } from '../../common/basehalfEditRecord.js';
import { IBaseHalfVideoSample, IBaseHalfVideoTrack } from '../../common/basehalfVideoFile.js';
import { BaseHalfImageCropView } from '../../browser/basehalfImageCropView.js';
import { BaseHalfSoundWaveform } from '../../browser/basehalfSoundWaveform.js';
import { BaseHalfVideoFrameViewer } from '../../browser/basehalfVideoFrameViewer.js';

/**
 * Viewing and editing (editing media, "Viewing and editing", D96): each
 * editor of Card Detail opens to view the file, with none of its controls of
 * editing reachable, and Edit and Done show them and take them away without
 * moving the picture.
 */

/** A video of 5 s at 10 frames a second, whose pictures are never read: it names no codec. */
function videoTrack(): IBaseHalfVideoTrack {
	const samples: IBaseHalfVideoSample[] = Array.from({ length: 50 }, (_, index) => ({ offset: index * 10, size: 10, decodeTime: index * 100, time: index * 100, duration: 100, key: index === 0 }));
	return {
		kind: 'video', format: 'avc1', codec: undefined, description: undefined, timescale: 1000, samples,
		width: 640, height: 360, displayWidth: 640, displayHeight: 360, matrix: undefined
	} as unknown as IBaseHalfVideoTrack;
}

/** A player that records what the viewer asks of it. */
class TestPlayer {
	readonly element: HTMLElement;
	readonly video: HTMLVideoElement;
	readonly ranges: (IBaseHalfCanvasVideoPlayRange | undefined)[] = [];
	readonly seeks: number[] = [];
	currentTime = 0;
	pauses = 0;
	toggles = 0;

	constructor(container: HTMLElement) {
		this.element = mainWindow.document.createElement('div');
		this.element.tabIndex = -1;
		this.video = mainWindow.document.createElement('video');
		this.element.append(this.video);
		container.append(this.element);
	}

	get range(): IBaseHalfCanvasVideoPlayRange | undefined {
		return this.ranges[this.ranges.length - 1];
	}

	setSelected(): void { }
	pause(): void { this.pauses++; }
	togglePlay(): void { this.toggles++; }
	setMuted(): void { }
	focus(): void { this.element.focus(); }
	dispose(): void { this.element.remove(); }
	seek(time: number): void {
		this.seeks.push(time);
		this.currentTime = time;
	}
	setPlayRange(range: IBaseHalfCanvasVideoPlayRange | undefined): void {
		this.ranges.push(range);
	}
}

suite('BaseHalfMediaViewing', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** A place of 1000 × 600 pixels in a workbench, where the editors' own styles lay them out as Card Detail does. */
	function mount(): { readonly disposables: DisposableStore; readonly container: HTMLElement } {
		const disposables = store.add(new DisposableStore());
		const workbench = mainWindow.document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.style.cssText = 'position: fixed; left: 0; top: 0; width: 1000px; height: 600px;';
		const container = mainWindow.document.createElement('div');
		container.style.cssText = 'position: absolute; inset: 0; display: flex; flex-direction: column; container-type: size;';
		workbench.append(container);
		mainWindow.document.body.appendChild(workbench);
		disposables.add(toDisposable(() => workbench.remove()));
		return { disposables, container };
	}

	/** Edit and Done glide the frame viewer's stretch for 250 ms (D101): the test waits for it to end. */
	function glided(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 340));
	}

	function press(target: Element, x: number): void {
		target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: x, clientY: 20, bubbles: true, cancelable: true }));
	}

	function release(target: Element, x: number): void {
		target.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, clientX: x, clientY: 20, bubbles: true, cancelable: true }));
	}

	function pinch(target: Element, x: number): WheelEvent {
		const event = new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: x, clientY: 20, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	suite('the frame viewer of a video', () => {
		const TRIMMED: IBaseHalfMediaChoices = { keep: [{ start: 1, end: 4.5 }] };

		function setUp(choices: IBaseHalfMediaChoices = TRIMMED) {
			const { disposables, container } = mount();
			const player = disposables.add(new TestPlayer(container));
			const viewer = disposables.add(new BaseHalfVideoFrameViewer(container, {
				video: { file: { format: 'mp4', video: videoTrack(), audio: undefined, metadata: [] }, source: { size: 500, read: () => new Promise<Uint8Array>(() => { }) } },
				player: player as unknown as IBaseHalfCanvasCardVideoPlayer,
				stage: container,
				choices
			}));
			const element = viewer.element;
			const strip = element.querySelector('.basehalf-video-frames-strip') as HTMLElement;
			const handles = [...element.querySelectorAll('.basehalf-video-frames-handle')] as HTMLElement[];
			return { viewer, player, element, strip, handles, container };
		}

		test('opens to view the file: the part kept across the strip, no handle in the keyboard\'s order, and the part plays once', () => {
			const { element, strip, handles, player } = setUp();
			assert.ok(element.classList.contains('viewing'));
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['1.000', '4.500']);
			assert.deepStrictEqual(handles.map(handle => [handle.tabIndex, handle.getAttribute('aria-hidden')]), [[-1, 'true'], [-1, 'true']]);
			assert.strictEqual(player.range?.once, true);
		});

		test('while viewing, a press anywhere moves the playhead within the file, and starts no drag', () => {
			const { element, strip, player } = setUp();
			const bounds = strip.getBoundingClientRect();
			press(strip, bounds.left + bounds.width / 2);
			assert.ok(Math.abs(player.seeks[player.seeks.length - 1] - 2.75) < 0.01, `seeked to ${player.seeks[player.seeks.length - 1]}`);
			assert.ok(!element.classList.contains('dragging'));
			release(strip, bounds.left + bounds.width / 2);
		});

		test('Edit shows the whole original with the handles and the part over and over; Done shows the file again, each in a glide of 250 ms (D101)', async () => {
			const { viewer, element, strip, handles, player } = setUp();
			viewer.setEditing(true);
			await glided();
			assert.ok(!element.classList.contains('viewing'));
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['0.000', '5.000']);
			assert.deepStrictEqual(handles.map(handle => [handle.tabIndex, handle.getAttribute('aria-hidden')]), [[0, null], [0, null]]);
			assert.strictEqual(player.range?.once, undefined);
			assert.deepStrictEqual([player.range?.start, player.range?.end], [1, 4.5]);
			viewer.setEditing(false);
			await glided();
			assert.ok(element.classList.contains('viewing'));
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['1.000', '4.500']);
			assert.strictEqual(player.range?.once, true);
		});

		test('the pictures of the part kept stay while Edit shows the whole original, and show again at once with Done (D101)', async () => {
			const { viewer, element } = setUp();
			const sets = () => Array.from(element.querySelectorAll('.basehalf-video-frames-pictures.zoom .basehalf-video-frames-set'));
			await glided();
			const before = sets();
			viewer.setEditing(true);
			await glided();
			const whileEditing = sets();
			viewer.setEditing(false);
			await glided();
			const after = sets();
			assert.deepStrictEqual({
				before: before.map(set => set.classList.contains('pending')),
				kept: whileEditing.length === 1 && whileEditing[0] === before[0],
				again: after.length === 1 && after[0] === before[0]
			}, { before: [false], kept: true, again: true });
		});

		test('a handle\'s keys and I and O change the part only while editing', () => {
			const { viewer, handles, container } = setUp();
			const changes: string[] = [];
			store.add(viewer.onDidChange(change => changes.push(change)));
			handles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
			container.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }));
			assert.deepStrictEqual(changes, []);
			viewer.setEditing(true);
			handles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
			assert.deepStrictEqual(changes, ['trim']);
		});

		test('the keys of the playhead move it a second or a frame, within the file while viewing and the original while editing; a frame pauses', () => {
			const { viewer, player } = setUp();
			const at: number[] = [];
			const move = (...moves: Parameters<BaseHalfVideoFrameViewer['movePlayhead']>[0][]) => {
				for (const each of moves) {
					viewer.movePlayhead(each);
					at.push(Math.round(player.currentTime * 1000) / 1000);
				}
			};
			player.currentTime = 1;
			move({ kind: 'step', by: 'second', direction: 1 }, { kind: 'jump', to: 'end' }, { kind: 'step', by: 'second', direction: 1 }, { kind: 'jump', to: 'start' }, { kind: 'step', by: 'second', direction: -1 });
			const pausedBefore = player.pauses;
			move({ kind: 'step', by: 'frame', direction: 1 });
			const pausedByFrame = player.pauses - pausedBefore;
			viewer.setEditing(true);
			move({ kind: 'jump', to: 'end' }, { kind: 'jump', to: 'start' }, { kind: 'step', by: 'frame', direction: -1 }, { kind: 'step', by: 'second', direction: 1 });
			// The part kept is 1 s to 4.5 s of a video of 5 s at 10 frames a second.
			assert.deepStrictEqual({ at, pausedByFrame }, { at: [2, 4.4, 4.4, 1, 1, 1.1, 4.9, 0, 0, 1], pausedByFrame: 1 });
		});

		test('the keyboard is the player\'s, while viewing and while editing, and Space\'s play and pause are the player\'s (D100)', () => {
			const { viewer, player } = setUp();
			const keyboard: boolean[] = [];
			viewer.focus();
			keyboard.push(mainWindow.document.activeElement === player.element);
			viewer.setEditing(true);
			viewer.focus();
			keyboard.push(mainWindow.document.activeElement === player.element);
			viewer.togglePlay();
			assert.deepStrictEqual({ keyboard, toggles: player.toggles }, { keyboard: [true, true], toggles: 1 });
		});

		test('a pinch over the strip spreads its time only while editing', async () => {
			const { viewer, strip } = setUp({});
			const viewing = pinch(strip, 300);
			assert.strictEqual(viewing.defaultPrevented, false);
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['0.000', '5.000']);
			viewer.setEditing(true);
			const editing = pinch(strip, 300);
			assert.strictEqual(editing.defaultPrevented, true);
			assert.notStrictEqual(strip.dataset.to, '5.000');
			// Done shows the file's length again.
			viewer.setEditing(false);
			await glided();
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['0.000', '5.000']);
		});
	});

	suite('the waveform of a sound', () => {
		function setUp(choices: IBaseHalfMediaChoices = { keep: [{ start: 1, end: 4 }] }) {
			const { disposables, container } = mount();
			const instantiation = disposables.add(new TestInstantiationService());
			// The sound is never decoded here: Play has nothing to play.
			instantiation.stub(IFileService, { readFile: () => Promise.reject(new Error('not here')), onDidFilesChange: Event.None });
			const waveform = disposables.add(instantiation.createInstance(BaseHalfSoundWaveform, container, {
				source: URI.file('/sounds/take.wav'),
				info: { format: 'wav', duration: 5, sampleRate: 48000, channels: 1, step: 1 / 48000 },
				choices
			}));
			const element = waveform.element;
			const strip = element.querySelector('.basehalf-video-frames-strip') as HTMLElement;
			const handles = [...element.querySelectorAll('.basehalf-video-frames-handle')] as HTMLElement[];
			const time = element.querySelector('.basehalf-sound-waveform-time') as HTMLElement;
			const selection = element.querySelector('.basehalf-sound-waveform-selection') as HTMLElement;
			return { waveform, element, strip, handles, time, selection };
		}

		test('opens to view the sound as the file holds it, its time from the first handle, with no handle to reach', () => {
			const { element, strip, handles, time } = setUp();
			assert.ok(element.classList.contains('viewing'));
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['1.000', '4.000']);
			assert.deepStrictEqual(handles.map(handle => handle.tabIndex), [-1, -1]);
			assert.strictEqual(time.textContent, '0.0s / 3.0s');
		});

		test('while viewing a drag moves the playhead and selects nothing; while editing it selects a stretch', () => {
			const { waveform, strip, time, selection } = setUp();
			const bounds = strip.getBoundingClientRect();
			press(strip, bounds.left + bounds.width / 2);
			strip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: bounds.left + bounds.width * 0.75, clientY: 20, bubbles: true }));
			release(strip, bounds.left + bounds.width * 0.75);
			assert.strictEqual(selection.hidden, true);
			assert.strictEqual(time.textContent, '2.2s / 3.0s');
			waveform.setEditing(true);
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['0.000', '5.000']);
			press(strip, bounds.left + bounds.width / 2);
			strip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: bounds.left + bounds.width * 0.7, clientY: 20, bubbles: true }));
			release(strip, bounds.left + bounds.width * 0.7);
			assert.strictEqual(selection.hidden, false);
			// Done drops the selection and shows the file again.
			waveform.setEditing(false);
			assert.strictEqual(selection.hidden, true);
			assert.deepStrictEqual([strip.dataset.from, strip.dataset.to], ['1.000', '4.000']);
		});

		test('the keys of the playhead move it a second, within the file while viewing and the whole sound while editing', () => {
			const { waveform, time } = setUp();
			const shown: (string | null)[] = [];
			for (const move of [{ kind: 'step', by: 'second', direction: 1 }, { kind: 'step', by: 'frame', direction: 1 }, { kind: 'jump', to: 'end' }, { kind: 'step', by: 'second', direction: 1 }, { kind: 'jump', to: 'start' }] as const) {
				waveform.movePlayhead(move);
				shown.push(time.textContent);
			}
			waveform.setEditing(true);
			for (const move of [{ kind: 'jump', to: 'end' }, { kind: 'step', by: 'second', direction: -1 }, { kind: 'jump', to: 'start' }] as const) {
				waveform.movePlayhead(move);
				shown.push(time.textContent);
			}
			// A sound has no frames: Shift moves it a second too. Viewing counts from the first handle, editing from the sound's start.
			assert.deepStrictEqual(shown, ['1.0s / 3.0s', '2.0s / 3.0s', '3.0s / 3.0s', '3.0s / 3.0s', '0.0s / 3.0s', '5.0s / 5.0s', '4.0s / 5.0s', '0.0s / 5.0s']);
		});

		test('the keyboard is the waveform\'s own, while viewing and while editing, not Play\'s (D100)', () => {
			const { waveform, element } = setUp();
			const keyboard: boolean[] = [];
			waveform.focus();
			keyboard.push(mainWindow.document.activeElement === element);
			waveform.setEditing(true);
			waveform.focus();
			keyboard.push(mainWindow.document.activeElement === element);
			assert.deepStrictEqual({ keyboard, tabIndex: element.tabIndex }, { keyboard: [true, true], tabIndex: -1 });
		});
	});

	suite('the crop view of an image', () => {
		function setUp() {
			const { disposables, container } = mount();
			const instantiation = disposables.add(new TestInstantiationService());
			instantiation.stub(IContextMenuService, {});
			instantiation.stub(IHoverService, NullHoverService);
			const crop = disposables.add(instantiation.createInstance(BaseHalfImageCropView, container, {
				source: URI.parse('data:image/gif;base64,R0lGODlhAQABAAAAACw='),
				size: { width: 1600, height: 900 },
				choices: { crop: { x: 800, y: 450, width: 800, height: 450 } }
			}));
			const element = crop.element;
			const view = element.querySelector('.basehalf-image-crop-view') as HTMLElement;
			const frame = element.querySelector('.basehalf-image-crop-frame') as HTMLElement;
			const tools = element.querySelector('.basehalf-image-crop-tools') as HTMLElement;
			const picture = element.querySelector('.basehalf-image-crop-picture') as HTMLElement;
			const corners = [...element.querySelectorAll('.basehalf-image-crop-corner')] as HTMLElement[];
			return { crop, element, view, frame, tools, picture, corners };
		}

		test('opens to view the picture: the frame, its corners, and the tools take no keyboard and no pointer', () => {
			const { element, view, frame, tools, corners } = setUp();
			assert.ok(element.classList.contains('viewing'));
			assert.strictEqual(frame.tabIndex, -1);
			assert.deepStrictEqual(corners.map(corner => corner.tabIndex), [-1, -1, -1, -1]);
			assert.ok(tools.hasAttribute('inert'));
			press(view, 300);
			assert.ok(!element.classList.contains('adjusting'), 'a press on the picture as it fits drags nothing');
			release(view, 300);
		});

		test('Edit lets the frame be dragged and the tools be used, and neither moves the picture', () => {
			const { crop, element, view, frame, tools, picture, corners } = setUp();
			const before = picture.style.transform;
			crop.setEditing(true);
			assert.strictEqual(picture.style.transform, before);
			assert.ok(!element.classList.contains('viewing'));
			assert.strictEqual(frame.tabIndex, 0);
			assert.deepStrictEqual(corners.map(corner => corner.tabIndex), [0, 0, 0, 0]);
			assert.ok(!tools.hasAttribute('inert'));
			press(view, 300);
			assert.ok(element.classList.contains('adjusting'));
			release(view, 300);
			crop.setEditing(false);
			assert.strictEqual(picture.style.transform, before);
			assert.ok(tools.hasAttribute('inert'));
		});

		test('the keyboard is on the picture, while viewing and while editing; Tab takes it on to the frame (D100)', () => {
			const { crop, view, frame } = setUp();
			const keyboard: boolean[] = [];
			crop.focus();
			keyboard.push(mainWindow.document.activeElement === view);
			crop.setEditing(true);
			crop.focus();
			keyboard.push(mainWindow.document.activeElement === view);
			assert.deepStrictEqual({ keyboard, frameInView: view.contains(frame), frameTabIndex: frame.tabIndex }, { keyboard: [true, true], frameInView: true, frameTabIndex: 0 });
		});
	});
});

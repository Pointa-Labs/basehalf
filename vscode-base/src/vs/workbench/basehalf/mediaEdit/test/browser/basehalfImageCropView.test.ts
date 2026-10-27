/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IBaseHalfMediaChoices } from '../../common/basehalfEditRecord.js';
import { BaseHalfImageCropView, IBaseHalfImageCropClock } from '../../browser/basehalfImageCropView.js';

/**
 * The crop of an image as a phone's photo editor has it (editing media, "The
 * crop frame", D97): a corner held in the view's margin brings the picture to
 * it, the frame waits a second before it glides to rest, and a pinch and a
 * swipe while editing zoom and move the picture under the frame.
 */

/** Frames of the screen and timers that run when the test says, 60 frames a second. */
class TestClock implements IBaseHalfImageCropClock {
	time = 0;
	/** Each request of a frame on its own, as the window's are: the same callback may be asked for again while it runs. */
	private readonly frames = new Set<{ readonly callback: () => void }>();
	private readonly timers = new Set<{ readonly at: number; readonly callback: () => void }>();

	frame(callback: () => void): IDisposable {
		const request = { callback };
		this.frames.add(request);
		return toDisposable(() => this.frames.delete(request));
	}

	timeout(callback: () => void, milliseconds: number): IDisposable {
		const timer = { at: this.time + milliseconds, callback };
		this.timers.add(timer);
		return toDisposable(() => this.timers.delete(timer));
	}

	now(): number {
		return this.time;
	}

	/** Moves time on by `milliseconds`, a frame at a time, running the timers that come due and then the frames; `each` sees every frame. */
	advance(milliseconds: number, each?: () => void): void {
		const end = this.time + milliseconds;
		while (this.time < end) {
			this.time = Math.min(end, this.time + 16);
			for (const timer of [...this.timers]) {
				if (timer.at <= this.time && this.timers.delete(timer)) {
					timer.callback();
				}
			}
			const frames = [...this.frames];
			this.frames.clear();
			for (const frame of frames) {
				frame.callback();
			}
			each?.();
		}
	}
}

suite('BaseHalfImageCropView', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** A crop view in a place of 1000 × 600 pixels of a workbench, laid out by its own styles as Card Detail lays it out. */
	function setUp(choices: IBaseHalfMediaChoices, size = { width: 2400, height: 1600 }) {
		const disposables = store.add(new DisposableStore());
		const workbench = mainWindow.document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.style.cssText = 'position: fixed; left: 0; top: 0; width: 1000px; height: 600px;';
		const container = mainWindow.document.createElement('div');
		container.style.cssText = 'position: absolute; inset: 0; display: flex; flex-direction: column; container-type: size;';
		workbench.append(container);
		mainWindow.document.body.appendChild(workbench);
		disposables.add(toDisposable(() => workbench.remove()));
		const instantiation = disposables.add(new TestInstantiationService());
		instantiation.stub(IContextMenuService, {});
		instantiation.stub(IHoverService, NullHoverService);
		const clock = new TestClock();
		const crop = disposables.add(instantiation.createInstance(BaseHalfImageCropView, container, {
			source: URI.parse('data:image/gif;base64,R0lGODlhAQABAAAAACw='),
			size,
			choices,
			clock
		}));
		const changes: string[] = [];
		disposables.add(crop.onDidChange(kind => changes.push(kind)));
		const element = crop.element;
		const view = element.querySelector('.basehalf-image-crop-view') as HTMLElement;
		const frameElement = element.querySelector('.basehalf-image-crop-frame') as HTMLElement;
		const picture = element.querySelector('.basehalf-image-crop-picture') as HTMLElement;
		const corner = (name: string) => element.querySelector(`.basehalf-image-crop-corner.${name}`) as HTMLElement;
		/** The frame on screen, from the view's top left. */
		const frame = () => {
			const left = parseFloat(frameElement.style.left);
			const top = parseFloat(frameElement.style.top);
			const width = parseFloat(frameElement.style.width);
			const height = parseFloat(frameElement.style.height);
			return { left, top, right: left + width, bottom: top + height, width, height };
		};
		const scale = () => {
			const values = /matrix\(([^)]+)\)/.exec(picture.style.transform)![1].split(',').map(Number);
			return Math.hypot(values[0], values[1]);
		};
		const client = (x: number, y: number) => {
			const bounds = view.getBoundingClientRect();
			return { clientX: bounds.left + x, clientY: bounds.top + y };
		};
		const pointer = (type: string, target: Element, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 1, ...client(x, y), bubbles: true, cancelable: true }));
		const wheel = (x: number, y: number, init: WheelEventInit) => {
			const event = new WheelEvent('wheel', { ...client(x, y), bubbles: true, cancelable: true, ...init });
			view.dispatchEvent(event);
			return event;
		};
		return { crop, clock, changes, element, view, picture, corner, frame, scale, pointer, wheel };
	}

	test('a corner held in the margin of the view brings the picture to it around the corner across, and stops at the original\'s edge (D97)', () => {
		// A crop of 1320 × 880 at the bottom right of 2400 × 1600, as a corner dragged in leaves it.
		const { crop, clock, changes, view, corner, frame, scale, pointer } = setUp({ crop: { x: 1740, y: 1160, width: 1320, height: 880 } });
		crop.setEditing(true);
		const atRest = frame();
		const restScale = scale();
		pointer('pointerdown', corner('topLeft'), atRest.left, atRest.top);
		// Into the margin of 24 px: 10 px from the view's top left.
		pointer('pointermove', view, 10, 10);
		const frames: { readonly scale: number; readonly right: number; readonly bottom: number; readonly left: number; readonly top: number }[] = [];
		clock.advance(6000, () => frames.push({ scale: scale(), ...frame() }));
		assert.ok(frames[0].scale < restScale, 'the picture follows in the first frames');
		for (let i = 1; i < frames.length; i++) {
			assert.ok(frames[i].scale <= frames[i - 1].scale + 1e-12, `the picture only grows smaller while the corner is held, frame ${i}`);
			assert.ok(Math.abs(frames[i].right - atRest.right) < 1 && Math.abs(frames[i].bottom - atRest.bottom) < 1, `the corner across keeps its place, frame ${i}`);
			assert.ok(frames[i].left >= 24 - 0.5 && frames[i].top >= 24 - 0.5, `the frame stops at the margin, frame ${i}`);
		}
		const last = frames[frames.length - 1];
		assert.ok(frames.slice(-10).every(f => f.scale === last.scale), 'following stops once the original\'s edge is in reach');
		pointer('pointerup', view, 10, 10);
		assert.deepStrictEqual({ choices: crop.choices, changes }, { choices: {}, changes: ['crop'] }, 'one drag takes the crop back to the whole original');
	});

	test('a corner inside the room moves the frame alone, and the picture follows only while the corner is held in the margin (D97)', () => {
		const { crop, clock, view, corner, frame, scale, pointer } = setUp({ crop: { x: 1740, y: 1160, width: 1320, height: 880 } });
		crop.setEditing(true);
		const atRest = frame();
		const restScale = scale();
		pointer('pointerdown', corner('topLeft'), atRest.left, atRest.top);
		pointer('pointermove', view, atRest.left + 40, atRest.top + 30);
		clock.advance(500);
		assert.strictEqual(scale(), restScale, 'inside the room nothing follows');
		pointer('pointermove', view, 12, atRest.top + 30);
		clock.advance(300);
		const followed = scale();
		assert.ok(followed < restScale);
		pointer('pointermove', view, 60, atRest.top + 30);
		clock.advance(500);
		assert.strictEqual(scale(), followed, 'back inside the room, the picture stops following');
		pointer('pointerup', view, 60, atRest.top + 30);
	});

	test('let go, the frame stays where it was for a second, then glides to rest; a press within the second starts from where it is (D97)', () => {
		const { crop, clock, view, corner, frame, scale, pointer } = setUp({});
		crop.setEditing(true);
		const atRest = frame();
		pointer('pointerdown', corner('topLeft'), atRest.left, atRest.top);
		pointer('pointermove', view, atRest.left + 300, atRest.top + 150);
		pointer('pointerup', view, atRest.left + 300, atRest.top + 150);
		const letGo = frame();
		const letGoScale = scale();
		clock.advance(980);
		assert.deepStrictEqual({ frame: frame(), scale: scale() }, { frame: letGo, scale: letGoScale }, 'the frame waits where it was let go');
		clock.advance(300);
		const rested = frame();
		assert.ok(scale() > letGoScale, 'then the part glides to as large as fits');
		const room = { width: view.clientWidth - 48, height: view.clientHeight - 48 };
		assert.ok(Math.abs((rested.left + rested.right) / 2 - view.clientWidth / 2) < 1 && Math.abs((rested.top + rested.bottom) / 2 - view.clientHeight / 2) < 1, 'at the middle of the view');
		assert.ok(Math.abs(rested.width - room.width) < 1 || Math.abs(rested.height - room.height) < 1, 'as large as fits');
		// A drag let go, and pressed again within the second: no glide comes under the pointer.
		pointer('pointerdown', corner('topLeft'), rested.left, rested.top);
		pointer('pointermove', view, rested.left + 100, rested.top + 60);
		pointer('pointerup', view, rested.left + 100, rested.top + 60);
		clock.advance(500);
		const second = frame();
		pointer('pointerdown', corner('topLeft'), second.left, second.top);
		clock.advance(1500);
		assert.deepStrictEqual(frame(), second, 'a press within the second keeps the frame where it is');
		pointer('pointerup', view, second.left, second.top);
	});

	test('while editing, a pinch zooms the picture under the frame and a swipe moves it, each one change once it rests (D97)', () => {
		const { crop, clock, changes, frame, scale, wheel } = setUp({});
		crop.setEditing(true);
		const atRest = frame();
		const restScale = scale();
		const middle = { x: (atRest.left + atRest.right) / 2, y: (atRest.top + atRest.bottom) / 2 };
		// A pinch in by e^(10 / 100) four times: the part grows smaller by e^0.4 about the pointer.
		for (let i = 0; i < 4; i++) {
			assert.ok(wheel(middle.x, middle.y, { deltaY: -10, ctrlKey: true }).defaultPrevented);
		}
		assert.deepStrictEqual(frame(), atRest, 'the frame keeps its place and size');
		// The transform reads back with six digits.
		assert.ok(Math.abs(scale() / restScale - Math.exp(0.4)) < 1e-4, 'the picture grows under it');
		assert.deepStrictEqual(changes, [], 'no change while the pinch goes on');
		clock.advance(200);
		assert.deepStrictEqual(changes, ['crop'], 'one change once it rests');
		const pinched = crop.choices.crop!;
		assert.ok(Math.abs(pinched.width - 2400 / Math.exp(0.4)) <= 1 && Math.abs(pinched.height - 1600 / Math.exp(0.4)) <= 1);
		// A swipe moves the picture under the frame with the fingers: the part moves the other way.
		for (let i = 0; i < 5; i++) {
			assert.ok(wheel(middle.x, middle.y, { deltaX: -20, deltaY: 0 }).defaultPrevented);
		}
		clock.advance(200);
		assert.deepStrictEqual(frame(), atRest);
		const swiped = crop.choices.crop!;
		assert.deepStrictEqual({ dx: Math.round((pinched.x - swiped.x) * scale()), dy: swiped.y - pinched.y, changes }, { dx: 100, dy: 0, changes: ['crop', 'crop'] });
		// A pinch out takes the part back as far as the picture holds its ratio.
		for (let i = 0; i < 20; i++) {
			wheel(middle.x, middle.y, { deltaY: 40, ctrlKey: true });
		}
		clock.advance(200);
		assert.deepStrictEqual({ choices: crop.choices, frame: frame() }, { choices: {}, frame: atRest });
	});

	test('a drag inside the frame, as a three-finger drag makes it, moves the picture under the still frame with the pointer, as far as the picture covers it, one change at the release (D97)', () => {
		const { crop, clock, changes, element, view, picture, frame, pointer } = setUp({ crop: { x: 1200, y: 800, width: 1200, height: 800 } });
		crop.setEditing(true);
		const frameElement = element.querySelector('.basehalf-image-crop-frame') as HTMLElement;
		const translation = () => {
			const values = /matrix\(([^)]+)\)/.exec(picture.style.transform)![1].split(',').map(Number);
			return { x: values[4], y: values[5] };
		};
		const atRest = frame();
		/** The frame where it rests, within a hundredth of a pixel. */
		const still = () => [frame().left - atRest.left, frame().top - atRest.top, frame().width - atRest.width, frame().height - atRest.height].every(delta => Math.abs(delta) < 0.01);
		const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
		const from = { x: (atRest.left + atRest.right) / 2 + 90, y: (atRest.top + atRest.bottom) / 2 + 50 };
		const before = translation();
		pointer('pointerdown', frameElement, from.x, from.y);
		assert.ok(still() && near(translation(), before), 'nothing moves at the press');
		for (let step = 1; step <= 10; step++) {
			pointer('pointermove', view, from.x - 20 * step, from.y - 10 * step);
			assert.ok(still(), `the frame stays, step ${step}`);
			assert.ok(near(translation(), { x: before.x - 20 * step, y: before.y - 10 * step }), `the picture follows the pointer exactly, step ${step}: ${JSON.stringify({ before, moved: translation() })}`);
		}
		const held = translation();
		pointer('pointerup', view, from.x - 200, from.y - 100);
		assert.deepStrictEqual(changes, ['crop'], 'one change at the release');
		assert.ok(still() && near(translation(), held), 'nothing moves at the release');
		clock.advance(1500);
		assert.ok(still() && near(translation(), held), 'the frame was at rest: nothing glides after');
		// Far to the left: the picture stops where its right edge meets the frame's.
		pointer('pointerdown', frameElement, from.x, from.y);
		pointer('pointermove', view, from.x - 2000, from.y);
		pointer('pointerup', view, from.x - 2000, from.y);
		assert.ok(still());
		assert.deepStrictEqual({ right: crop.choices.crop!.x + crop.choices.crop!.width / 2, changes }, { right: 2400, changes: ['crop', 'crop'] });
	});

	test('while editing, a swipe over the whole picture moves nothing, and a double click changes nothing (D97)', () => {
		const { crop, clock, changes, element, view, picture, frame, wheel } = setUp({});
		crop.setEditing(true);
		const before = picture.style.transform;
		const atRest = frame();
		assert.strictEqual(wheel(200, 200, { deltaX: 30, deltaY: 30 }).defaultPrevented, false);
		view.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 200, bubbles: true, cancelable: true }));
		clock.advance(500);
		assert.deepStrictEqual({ transform: picture.style.transform, frame: frame(), changes, zoomed: element.classList.contains('zoomed') }, { transform: before, frame: atRest, changes: [], zoomed: false });
	});

	test('Edit takes a zoom of the view back to as it fits, in a glide, and while editing the rest of the original shows (D97)', () => {
		const { crop, clock, element, frame, scale, wheel } = setUp({ crop: { x: 1200, y: 800, width: 1200, height: 800 } });
		// The dimming's own transition plays in the window's time, not the test's.
		(element.querySelector('.basehalf-image-crop-frame') as HTMLElement).style.transition = 'none';
		const restScale = scale();
		// While viewing, a pinch zooms the view.
		for (let i = 0; i < 3; i++) {
			wheel(300, 200, { deltaY: -40, ctrlKey: true });
		}
		const zoomed = scale();
		assert.ok(zoomed > restScale && element.classList.contains('zoomed'));
		crop.setEditing(true);
		const scales: number[] = [];
		clock.advance(320, () => scales.push(scale()));
		assert.ok(!element.classList.contains('zoomed'));
		assert.ok(scales.filter(value => value < zoomed - 1e-9 && value > restScale + 1e-9).length >= 5, 'the picture glides through the frames between');
		assert.ok(Math.abs(scale() - restScale) < 1e-9, 'and comes to rest as it fits');
		const atRest = frame();
		assert.ok(atRest.width > 0 && !element.classList.contains('viewing'));
		const shadow = mainWindow.getComputedStyle(element.querySelector('.basehalf-image-crop-frame')!).boxShadow;
		assert.ok(/rgba\(0, 0, 0, 0\.6/.test(shadow), `the rest of the original shows dimmed while editing: ${shadow}`);
	});
});

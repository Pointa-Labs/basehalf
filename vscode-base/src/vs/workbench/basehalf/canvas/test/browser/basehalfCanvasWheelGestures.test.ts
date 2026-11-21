/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { installBaseHalfCanvasWheelGestures } from '../../browser/basehalfCanvasWheelGestures.js';

suite('BaseHalfCanvasWheelGestures', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	interface ITestCard {
		readonly card: HTMLElement;
		readonly caption: HTMLElement;
		readonly note: HTMLElement;
		readonly text: HTMLElement;
	}

	let host: HTMLElement;
	let renderer: HTMLElement;
	let pane: HTMLElement;
	let editor: HTMLElement;
	/** The newest element of each card, by the card's path. */
	let cards: Map<string, HTMLElement>;
	/** The note that each card element holds. */
	let notes: Map<HTMLElement, HTMLElement>;
	/** What reached the canvas, which listens above its pane as the events bubble: `[target, deltaX, deltaY]`. */
	let panned: [string, number, number][];
	/** What the canvas was asked to zoom by, and about which point of the window: `[factor, clientX, clientY]`. */
	let zoomed: [string, number, number][];
	/** Ends the running gesture, as the quiet time does. */
	let quietTimePasses: () => void;
	let zoom: number;
	/** The setting says that the wheel zooms the canvas. */
	let wheelZooms: boolean;
	let installed: IDisposable | undefined;

	function element(parent: HTMLElement, className: string): HTMLElement {
		const child = mainWindow.document.createElement('div');
		child.className = className;
		parent.appendChild(child);
		return child;
	}

	/** A card with a 100 pixel high box that holds `contentHeight` pixels of note. */
	function card(path: string, contentHeight: number): ITestCard {
		const cardElement = element(renderer, 'basehalf-canvas-card');
		cardElement.dataset.basehalfCardPath = path;
		const caption = element(cardElement, 'basehalf-canvas-card-caption');
		const note = element(element(cardElement, 'basehalf-canvas-card-content'), 'note');
		note.style.height = '100px';
		note.style.overflow = 'hidden';
		const text = element(note, 'text');
		text.style.height = `${contentHeight}px`;
		cards.set(path, cardElement);
		notes.set(cardElement, note);
		return { card: cardElement, caption, note, text };
	}

	/** One wheel event. Returns whether it was taken from its target. */
	function wheel(target: HTMLElement, init: WheelEventInit): boolean {
		const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
		target.dispatchEvent(event);
		return event.defaultPrevented;
	}

	/** Installs the gestures on the scene, with the Command key or with Ctrl as the zoom key. */
	function install(zoomKeyIsControl: boolean): void {
		// The store disposes it again when the test ends, which does nothing.
		installed?.dispose();
		installed = disposables.add(installBaseHalfCanvasWheelGestures(host, {
			zoom: () => zoom,
			card: path => cards.get(path),
			scrollableContent: cardElement => notes.get(cardElement),
			wheelZooms: () => wheelZooms,
			zoomCanvas: (factor, clientX, clientY) => zoomed.push([factor.toFixed(4), clientX, clientY]),
			zoomKeyIsControl,
			afterQuietTime: callback => {
				quietTimePasses = callback;
				return toDisposable(() => { });
			}
		}));
	}

	setup(() => {
		host = element(mainWindow.document.body, 'host');
		renderer = element(host, 'react-flow__renderer');
		pane = element(renderer, 'react-flow__pane');
		editor = element(element(element(renderer, 'node'), 'toolbar nowheel'), 'editor nowheel');
		cards = new Map();
		notes = new Map();
		panned = [];
		zoomed = [];
		quietTimePasses = () => { };
		zoom = 1;
		wheelZooms = false;
		installed = undefined;
		renderer.addEventListener('wheel', event => panned.push([(event.target as HTMLElement).className, event.deltaX, event.deltaY]));
		install(false);
	});

	teardown(() => host.remove());

	test('a gesture that starts on a card scrolls its note, also after the pointer has left the card', () => {
		const long = card('long.md', 1000);

		const taken = [
			wheel(long.text, { deltaY: 30, deltaX: 12 }),
			wheel(pane, { deltaY: 30 }),
			wheel(editor, { deltaY: 0.25 }),
			wheel(editor, { deltaY: 0.25 }),
			wheel(editor, { deltaY: 0.25 }),
			wheel(editor, { deltaY: 0.25 })
		];

		// The four small events add up to one pixel. Each alone would be rounded away.
		assert.deepStrictEqual({ taken, scrollTop: long.note.scrollTop, panned }, {
			taken: [true, true, true, true, true, true],
			scrollTop: 61,
			panned: []
		});
	});

	test('a gesture that starts on the canvas keeps panning over a note and over surfaces that take the wheel', () => {
		const long = card('long.md', 1000);

		const taken = [
			wheel(pane, { deltaY: 30 }),
			wheel(long.text, { deltaY: 31 }),
			wheel(editor, { deltaX: 5, deltaY: 32 }),
			wheel(editor, { deltaY: 33, cancelable: false })
		];

		assert.deepStrictEqual({ taken, scrollTop: long.note.scrollTop, panned }, {
			taken: [false, false, true, false],
			scrollTop: 0,
			// The third is a copy from just outside the two surfaces that would have
			// taken it. The fourth cannot be taken from its surface and is left there.
			panned: [['react-flow__pane', 0, 30], ['text', 0, 31], ['node', 5, 32], ['editor nowheel', 0, 33]]
		});
	});

	test('after the quiet time, the next scroll belongs to what the pointer is on then', () => {
		const long = card('long.md', 1000);

		wheel(pane, { deltaY: 30 });
		wheel(long.text, { deltaY: 30 });
		const duringThePan = long.note.scrollTop;
		quietTimePasses();
		wheel(long.text, { deltaY: 30 });
		wheel(pane, { deltaY: 30 });
		quietTimePasses();
		wheel(long.caption, { deltaY: 30 });

		assert.deepStrictEqual({ duringThePan, scrollTop: long.note.scrollTop, panned }, {
			duringThePan: 0,
			scrollTop: 60,
			panned: [['react-flow__pane', 0, 30], ['text', 0, 30], ['basehalf-canvas-card-caption', 0, 30]]
		});
	});

	test('the small first events of a gesture on a note are held, and the canvas gets them when the gesture goes sideways', () => {
		const long = card('long.md', 1000);

		const down = [wheel(long.text, { deltaX: 1 }), wheel(long.text, { deltaY: 2 }), wheel(long.text, { deltaY: 3 })];
		const afterDown = long.note.scrollTop;
		quietTimePasses();
		const sideways = [wheel(long.text, { deltaY: 1 }), wheel(long.text, { deltaX: 2 }), wheel(long.text, { deltaX: 6 }), wheel(long.text, { deltaX: 7 })];

		assert.deepStrictEqual({ down, afterDown, sideways, scrollTop: long.note.scrollTop, panned }, {
			down: [true, true, true],
			afterDown: 5,
			sideways: [true, true, true, false],
			scrollTop: 5,
			panned: [['text', 8, 1], ['text', 7, 0]]
		});
	});

	test('the canvas pans when the note under the pointer cannot move that way', () => {
		const long = card('long.md', 1000);
		const short = card('short.md', 80);
		long.note.scrollTop = 900;

		for (const init of [{ deltaY: 30 }, { deltaX: 30, deltaY: 10 }, { deltaY: -30, buttons: 1 }]) {
			wheel(long.text, init);
			quietTimePasses();
		}
		wheel(short.text, { deltaY: 30 });
		quietTimePasses();
		wheel(long.text, { deltaY: -30, ctrlKey: true });
		wheel(long.text, { deltaY: -30 });

		assert.deepStrictEqual({ scrollTop: long.note.scrollTop, panned: panned.length }, { scrollTop: 870, panned: 5 });
	});

	test('a sideways gesture that begins on a wide table scrolls the table and nothing else', () => {
		const long = card('long.md', 1000);
		// A table 100 pixels wide that holds 400 pixels of columns.
		const table = element(long.text, 'basehalf-canvas-scroll-sideways');
		table.style.width = '100px';
		table.style.overflow = 'hidden';
		element(table, 'columns').style.width = '400px';
		const columns = table.firstElementChild as HTMLElement;
		columns.style.height = '20px';

		const onTheTable = [wheel(columns, { deltaX: 30, deltaY: 4 }), wheel(pane, { deltaX: 0.5, deltaY: 40 }), wheel(pane, { deltaX: 0.5 })];
		const afterTheTable = { scrollLeft: table.scrollLeft, scrollTop: long.note.scrollTop };
		quietTimePasses();
		// Down on the table scrolls the note. Sideways on the text of the note moves the canvas.
		wheel(columns, { deltaY: 30 });
		quietTimePasses();
		wheel(long.text, { deltaX: 30 });
		quietTimePasses();
		// The table is redrawn during a gesture: the rest of the gesture moves nothing.
		zoom = 2;
		wheel(columns, { deltaX: 60 });
		const scrollLeft = table.scrollLeft;
		const redrawn = element(long.text, 'basehalf-canvas-scroll-sideways');
		table.remove();
		const afterRedraw = wheel(pane, { deltaX: 60 });

		assert.deepStrictEqual({ onTheTable, afterTheTable, scrollLeft, scrollTop: long.note.scrollTop, afterRedraw, redrawn: redrawn.scrollLeft, panned }, {
			onTheTable: [true, true, true],
			afterTheTable: { scrollLeft: 31, scrollTop: 0 },
			// 31, and 60 screen pixels at a zoom of 2.
			scrollLeft: 61,
			scrollTop: 30,
			afterRedraw: true,
			redrawn: 0,
			panned: [['text', 30, 0]]
		});
	});

	test('the note moves as far on screen as the wheel asks at every zoom', () => {
		const long = card('long.md', 1000);
		zoom = 2;
		wheel(long.text, { deltaY: 60 });
		const zoomedIn = long.note.scrollTop;
		zoom = 0.5;
		wheel(long.text, { deltaY: 60 });

		assert.deepStrictEqual([zoomedIn, long.note.scrollTop], [30, 150]);
	});

	test('a gesture goes on with the new drawing of its card, and moves nothing when the card shows no note', () => {
		const long = card('long.md', 1000);
		wheel(long.text, { deltaY: 30 });
		// The replacement is built first and is not in the document yet.
		const redrawn = card('long.md', 1000);
		redrawn.card.remove();
		wheel(pane, { deltaY: 30 });
		const beforeTheSwap = long.note.scrollTop;
		long.card.remove();
		renderer.appendChild(redrawn.card);
		redrawn.note.scrollTop = 200;
		wheel(pane, { deltaY: 30 });
		redrawn.note.setAttribute('inert', '');
		const taken = wheel(pane, { deltaY: 30 });

		assert.deepStrictEqual({ beforeTheSwap, redrawn: redrawn.note.scrollTop, taken, panned }, { beforeTheSwap: 60, redrawn: 230, taken: true, panned: [] });
	});

	test('with the wheel that moves the canvas, the Command key zooms it about the pointer, also on a long note, and a pinch is left to the canvas', () => {
		const long = card('long.md', 1000);

		const taken = [
			wheel(pane, { deltaY: 100, metaKey: true, clientX: 40, clientY: 30 }),
			wheel(long.text, { deltaY: -100, metaKey: true, clientX: 41, clientY: 31 }),
			// The key came up: a new gesture, which the note under the pointer owns.
			wheel(long.text, { deltaY: 30 }),
			// A pinch says that Ctrl is held.
			wheel(long.text, { deltaY: 5, ctrlKey: true })
		];

		assert.deepStrictEqual({ taken, zoomed, scrollTop: long.note.scrollTop, panned }, {
			taken: [true, true, true, false],
			zoomed: [['0.8706', 40, 30], ['1.1487', 41, 31]],
			scrollTop: 30,
			panned: [['text', 0, 5]]
		});
	});

	test('with the wheel that zooms, the wheel zooms the canvas, a long note is still read, and the Command key moves the canvas', () => {
		const long = card('long.md', 1000);
		wheelZooms = true;

		const taken = [
			wheel(pane, { deltaY: 100, clientX: 40, clientY: 30 }),
			// The gesture goes on over a note and over a surface that takes the wheel: neither scrolls.
			wheel(long.text, { deltaY: 100, clientX: 50, clientY: 30 }),
			wheel(editor, { deltaY: 100, clientX: 60, clientY: 30 })
		];
		quietTimePasses();
		taken.push(wheel(long.text, { deltaY: 30 }));
		quietTimePasses();
		// With the key the event itself moves the canvas: the canvas reads it as it is.
		taken.push(wheel(pane, { deltaY: 100, metaKey: true }));
		quietTimePasses();
		// Sideways, as the wheel with Shift sends: a copy without the vertical part moves the canvas.
		taken.push(wheel(pane, { deltaX: 100, deltaY: 4 }), wheel(pane, { deltaX: 100 }));

		assert.deepStrictEqual({ taken, zoomed, scrollTop: long.note.scrollTop, panned }, {
			taken: [true, true, true, true, false, true, false],
			zoomed: [['0.8706', 40, 30], ['0.8706', 50, 30], ['0.8706', 60, 30]],
			scrollTop: 30,
			panned: [['react-flow__pane', 0, 100], ['react-flow__pane', 100, 0], ['react-flow__pane', 100, 0]]
		});
	});

	test('a change of the setting cuts no gesture in two: the one that runs goes on, and the next follows it', () => {
		wheel(pane, { deltaY: 30 });
		wheelZooms = true;
		wheel(pane, { deltaY: 30 });
		quietTimePasses();
		wheel(pane, { deltaY: 30, clientX: 7, clientY: 8 });
		wheelZooms = false;
		wheel(pane, { deltaY: 30, clientX: 7, clientY: 8 });
		quietTimePasses();
		wheel(pane, { deltaY: 30 });

		assert.deepStrictEqual({ zoomed, panned }, {
			zoomed: [['0.9593', 7, 8], ['0.9593', 7, 8]],
			panned: [['react-flow__pane', 0, 30], ['react-flow__pane', 0, 30], ['react-flow__pane', 0, 30]]
		});
	});

	test('where Ctrl is the zoom key, the key that is down tells the wheel with the key from a pinch, which says Ctrl too', () => {
		install(true);
		const key = (type: 'keydown' | 'keyup', ctrlKey: boolean) => mainWindow.dispatchEvent(new KeyboardEvent(type, { key: 'Control', ctrlKey }));

		// A pinch: Ctrl is said, and the key is not down. It is left to the canvas, which zooms on it.
		const pinch = wheel(pane, { deltaY: 5, ctrlKey: true });
		key('keydown', true);
		const withTheKey = wheel(pane, { deltaY: 100, ctrlKey: true, clientX: 40, clientY: 30 });
		quietTimePasses();
		wheelZooms = true;
		// The wheel zooms, so with the key it moves the canvas: by a copy that does not say Ctrl, which the canvas would take for a pinch.
		const movesWithTheKey = wheel(pane, { deltaY: 100, ctrlKey: true });
		key('keyup', false);
		const pinchAgain = wheel(pane, { deltaY: 5, ctrlKey: true });
		// The window lost the keyboard while the key was down: the key is not down any more.
		key('keydown', true);
		mainWindow.dispatchEvent(new Event('blur'));
		const afterBlur = wheel(pane, { deltaY: 5, ctrlKey: true });

		assert.deepStrictEqual({ taken: [pinch, withTheKey, movesWithTheKey, pinchAgain, afterBlur], zoomed, panned }, {
			taken: [false, true, true, false, false],
			zoomed: [['0.8706', 40, 30]],
			panned: [['react-flow__pane', 0, 5], ['react-flow__pane', 0, 100], ['react-flow__pane', 0, 5], ['react-flow__pane', 0, 5]]
		});
	});

	test('a wheel that counts in lines zooms as 20 pixels a line', () => {
		wheelZooms = true;
		wheel(pane, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, clientX: 1, clientY: 2 });

		// 60 pixels.
		assert.deepStrictEqual(zoomed, [['0.9202', 1, 2]]);
	});
});

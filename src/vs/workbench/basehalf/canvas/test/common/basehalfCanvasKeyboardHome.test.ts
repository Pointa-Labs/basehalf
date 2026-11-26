/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfCanvasHoldsBackRepeat,
	baseHalfCanvasKeyboardPlaceAfter,
	baseHalfKeyboardReturnsTo,
	IBaseHalfKeyboardReturnFacts
} from '../../common/basehalfCanvasKeyboardHome.js';
import { BaseHalfCanvasKeyboardPlace } from '../../common/basehalfCanvasKeys.js';

/** The keyboard on the page itself over a canvas that remembers no card, unless the case says more. */
function facts(more: Partial<IBaseHalfKeyboardReturnFacts>): IBaseHalfKeyboardReturnFacts {
	return {
		keyboardOn: 'page',
		dialogOpen: false,
		overlayOpen: false,
		leftPart: false,
		editorOverCanvas: false,
		cardDetailOpen: false,
		homeCardShown: false,
		...more
	};
}

suite('BaseHalfCanvasKeyboardHome', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('what takes the keyboard that has nowhere to be', () => {
		const cases: Readonly<Record<string, IBaseHalfKeyboardReturnFacts>> = {
			'a window that opens, the keyboard on the empty editor group': facts({ keyboardOn: 'emptyGroup' }),
			'an overlay closes over the blank canvas': facts({ keyboardOn: 'emptyGroup' }),
			'an overlay closes over a card that had the keyboard': facts({ keyboardOn: 'emptyGroup', homeCardShown: true }),
			// The base gives the keyboard to its editor area a moment before the overlay is gone.
			'an overlay closes over a card, and is not gone yet': facts({ keyboardOn: 'emptyGroup', overlayOpen: true, homeCardShown: true }),
			'an overlay closes over Card Detail': facts({ keyboardOn: 'emptyGroup', cardDetailOpen: true, homeCardShown: true }),
			'the editor of a note on its card ends': facts({ homeCardShown: true }),
			'the card that had the keyboard is deleted': facts({}),
			'something in Card Detail is taken away': facts({ cardDetailOpen: true, homeCardShown: true }),
			'something in an overlay is taken away': facts({ overlayOpen: true, cardDetailOpen: true, homeCardShown: true }),
			'a session of the Agent Area ends, another comes to the front': facts({ leftPart: true, homeCardShown: true }),
			'a session ends under an overlay': facts({ leftPart: true, overlayOpen: true }),
			'something is taken away while an editor of the base is over the canvas': facts({ editorOverCanvas: true, homeCardShown: true }),
			'the empty group while an editor of the base is over the canvas': facts({ keyboardOn: 'emptyGroup', editorOverCanvas: true }),
			'something is taken away under a dialog': facts({ dialogOpen: true, homeCardShown: true }),
			'the empty group under a dialog': facts({ keyboardOn: 'emptyGroup', dialogOpen: true }),
			'the keyboard is in Files': facts({ keyboardOn: 'elsewhere', homeCardShown: true }),
			'the keyboard is in a field of an overlay': facts({ keyboardOn: 'elsewhere', overlayOpen: true })
		};
		assert.deepStrictEqual(Object.fromEntries(Object.entries(cases).map(([name, value]) => [name, baseHalfKeyboardReturnsTo(value)])), {
			'a window that opens, the keyboard on the empty editor group': 'canvas',
			'an overlay closes over the blank canvas': 'canvas',
			'an overlay closes over a card that had the keyboard': 'card',
			'an overlay closes over a card, and is not gone yet': 'card',
			'an overlay closes over Card Detail': 'cardDetail',
			'the editor of a note on its card ends': 'card',
			'the card that had the keyboard is deleted': 'canvas',
			'something in Card Detail is taken away': 'cardDetail',
			'something in an overlay is taken away': 'overlay',
			'a session of the Agent Area ends, another comes to the front': 'part',
			'a session ends under an overlay': 'overlay',
			'something is taken away while an editor of the base is over the canvas': 'editor',
			'the empty group while an editor of the base is over the canvas': 'nothing',
			'something is taken away under a dialog': 'nothing',
			'the empty group under a dialog': 'nothing',
			'the keyboard is in Files': 'nothing',
			'the keyboard is in a field of an overlay': 'nothing'
		});
	});

	test('the place the canvas remembers', () => {
		// Where the keyboard goes, and the card it is on or in there; `a` had the keyboard before.
		const moves: readonly [string, BaseHalfCanvasKeyboardPlace | '', string | undefined][] = [
			['the blank canvas', 'canvas', undefined],
			['a card', 'card', 'b'],
			['a note edited on its card', 'control', 'b'],
			['something of a card that is no control', 'insideCard', 'b'],
			['the frame the canvas library draws around a card', 'scene', 'b'],
			['elsewhere among the cards', 'scene', undefined],
			['the prompt under a draft', 'control', undefined],
			['the zoom control', 'control', undefined],
			['the toolbar of the selection', 'toolbar', undefined],
			['a selected connection', 'connection', undefined],
			['the rest of the canvas area', 'frame', undefined],
			['a card under Card Detail', 'frame', 'b'],
			['Files', '', undefined]
		];
		assert.deepStrictEqual(Object.fromEntries(moves.map(([name, keyboardOn, card]) => [name, baseHalfCanvasKeyboardPlaceAfter('a', keyboardOn, card) ?? 'the canvas itself'])), {
			'the blank canvas': 'the canvas itself',
			'a card': 'b',
			'a note edited on its card': 'b',
			'something of a card that is no control': 'b',
			'the frame the canvas library draws around a card': 'b',
			'elsewhere among the cards': 'a',
			'the prompt under a draft': 'a',
			'the zoom control': 'a',
			'the toolbar of the selection': 'a',
			'a selected connection': 'a',
			'the rest of the canvas area': 'a',
			'a card under Card Detail': 'a',
			'Files': 'a'
		});
		// Without a card before, a control of the canvas leaves the canvas itself as the place.
		assert.strictEqual(baseHalfCanvasKeyboardPlaceAfter(undefined, 'control', undefined), undefined);
	});

	test('a key that is held does nothing where the keyboard arrives', () => {
		const presses: readonly [string, { repeat: boolean; key: string; wentDownHere: boolean }][] = [
			['Enter pressed on a card', { repeat: false, key: 'Enter', wentDownHere: true }],
			['Enter held on a card', { repeat: true, key: 'Enter', wentDownHere: true }],
			['Enter held from the name that was accepted', { repeat: true, key: 'Enter', wentDownHere: false }],
			['Escape held from the overlay that closed', { repeat: true, key: 'Escape', wentDownHere: false }],
			['Backspace held from a field that closed', { repeat: true, key: 'Backspace', wentDownHere: false }],
			['a letter held from a note whose editing ended', { repeat: true, key: 'x', wentDownHere: false }],
			['Tab held through the controls', { repeat: true, key: 'Tab', wentDownHere: false }],
			['an arrow key held through a toolbar', { repeat: true, key: 'ArrowRight', wentDownHere: false }],
			['an arrow key held on a card', { repeat: true, key: 'ArrowLeft', wentDownHere: true }]
		];
		assert.deepStrictEqual(presses.filter(([, press]) => baseHalfCanvasHoldsBackRepeat(press)).map(([name]) => name), [
			'Enter held from the name that was accepted',
			'Escape held from the overlay that closed',
			'Backspace held from a field that closed',
			'a letter held from a note whose editing ended'
		]);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfNoteOutlineColumn,
	baseHalfNoteOutlineCurrent,
	baseHalfNoteOutlineIndent,
	baseHalfNoteOutlinePanelHeight,
	baseHalfNoteOutlinePanelTop,
	baseHalfNoteOutlineTickLength
} from '../../common/basehalfNoteOutlineLayout.js';

suite('BaseHalfNoteOutlineLayout', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a tick is 16, 12, or 8 pixels long by its level below the note\'s highest', () => {
		assert.deepStrictEqual([1, 2, 3, 4, 6].map(level => baseHalfNoteOutlineTickLength(level, 1)), [16, 12, 8, 8, 8]);
		// A note whose highest heading is of level 2 draws those as the longest.
		assert.deepStrictEqual([2, 3, 4].map(level => baseHalfNoteOutlineTickLength(level, 2)), [16, 12, 8]);
		assert.deepStrictEqual([1, 2, 4].map(level => baseHalfNoteOutlineIndent(level, 1)), [0, 12, 36]);
	});

	test('ticks stand 14 pixels apart in the middle of the view, closer when they do not fit, and around the current heading beyond that', () => {
		assert.deepStrictEqual(baseHalfNoteOutlineColumn(5, 800, 0), { pitch: 14, top: Math.round((800 - 58) / 2), first: 0, last: 4 });
		assert.deepStrictEqual(baseHalfNoteOutlineColumn(1, 800, 0), { pitch: 14, top: 399, first: 0, last: 0 });

		const closer = baseHalfNoteOutlineColumn(100, 800, 0);
		assert.ok(closer.pitch < 14 && closer.pitch >= 4, String(closer.pitch));
		assert.strictEqual(closer.first, 0);
		assert.strictEqual(closer.last, 99);
		assert.strictEqual(closer.top, 16);

		const window = baseHalfNoteOutlineColumn(500, 800, 300);
		assert.strictEqual(window.pitch, 4);
		const shown = window.last - window.first + 1;
		assert.ok((shown - 1) * 4 + 2 <= 800 - 32, String(shown));
		assert.ok(window.first <= 300 && window.last >= 300);
		assert.strictEqual(baseHalfNoteOutlineColumn(500, 800, 499).last, 499);
		assert.strictEqual(baseHalfNoteOutlineColumn(500, 800, -1).first, 0);
	});

	test('the current heading is the last above the top third, the first in view before that, and the last in view at the end', () => {
		const height = 900;
		// Scrolled into the second part: 0 and 1 are above the line at 300.
		assert.strictEqual(baseHalfNoteOutlineCurrent([-500, 120, 640], height, false), 1);
		// At the start of the note, the first heading lower in view.
		assert.strictEqual(baseHalfNoteOutlineCurrent([520, 1400], height, false), 0);
		// No heading above the line, none in view yet.
		assert.strictEqual(baseHalfNoteOutlineCurrent([1200, 1800], height, false), -1);
		// At the end of the note the last heading in view, though below the line.
		assert.strictEqual(baseHalfNoteOutlineCurrent([-800, 100, 700], height, true), 2);
		assert.strictEqual(baseHalfNoteOutlineCurrent([], height, false), -1);
	});

	test('the panel stands 10 pixels above the first tick, inside the view, at most 70% of its height', () => {
		assert.strictEqual(baseHalfNoteOutlinePanelHeight(4, 800), 4 * 25 + 14);
		assert.strictEqual(baseHalfNoteOutlinePanelHeight(100, 800), 560);
		assert.strictEqual(baseHalfNoteOutlinePanelTop(300, 114, 800), 290);
		assert.strictEqual(baseHalfNoteOutlinePanelTop(4, 114, 800), 8);
		assert.strictEqual(baseHalfNoteOutlinePanelTop(760, 114, 800), 800 - 8 - 114);
	});
});

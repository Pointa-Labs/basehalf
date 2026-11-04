/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import {
	baseHalfCodeFaceContentHeight,
	baseHalfCodeFaceDigits,
	baseHalfCodeFaceEstimatedLines,
	baseHalfCodeFaceLineAt,
	baseHalfCodeFaceLinesInView,
	baseHalfCodeFaceMarks,
	baseHalfCodeFaceScrollTopOfLine,
	baseHalfCodeFaceTickBox
} from '../../common/basehalfCanvasCodeFaceLayout.js';

suite('BaseHalf code card face', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('it draws the lines in view, and a few around them while it scrolls, whatever the length of the file', () => {
		assert.deepStrictEqual(baseHalfCodeFaceLinesInView(0, 200, 30_000), { first: 1, last: 11 });
		assert.deepStrictEqual(baseHalfCodeFaceLinesInView(180_008, 200, 30_000), { first: 10_001, last: 10_012 });
		assert.deepStrictEqual(baseHalfCodeFaceLinesInView(180_008, 200, 30_000, 6), { first: 9_995, last: 10_018 });
		assert.deepStrictEqual(baseHalfCodeFaceLinesInView(0, 200, 4), { first: 1, last: 4 });
		assert.deepStrictEqual(baseHalfCodeFaceLinesInView(0, 200, 0), { first: 1, last: 0 });
	});

	test('a line and the place that shows it at the top go back and forth, and the first line keeps the room above it', () => {
		assert.strictEqual(baseHalfCodeFaceScrollTopOfLine(1), 0);
		for (const line of [2, 12, 300, 29_999]) {
			assert.strictEqual(baseHalfCodeFaceLineAt(baseHalfCodeFaceScrollTopOfLine(line)), line);
		}
		assert.strictEqual(baseHalfCodeFaceLineAt(0), 1);
		assert.strictEqual(baseHalfCodeFaceLineAt(8), 1);
		assert.strictEqual(baseHalfCodeFaceLineAt(25), 1);
		assert.strictEqual(baseHalfCodeFaceLineAt(26), 2);
	});

	test('the content holds the room around its lines', () => {
		assert.strictEqual(baseHalfCodeFaceContentHeight(10), 8 + 180 + 12);
	});

	test('a gutter has as many digits as the editor gives it', () => {
		assert.deepStrictEqual([1, 999, 1_000, 30_000].map(baseHalfCodeFaceDigits), [3, 3, 4, 5]);
	});

	test('a file that was read in part is counted from what was read of it', () => {
		assert.strictEqual(baseHalfCodeFaceEstimatedLines(12, 400, true, 400), 12);
		assert.strictEqual(baseHalfCodeFaceEstimatedLines(200, 8_000, false, 80_000), 2_000);
		assert.strictEqual(baseHalfCodeFaceEstimatedLines(200, 8_000, false, undefined), 200);
	});

	test('added, modified, and deleted lines are read as the gutter reads them', () => {
		const marks = baseHalfCodeFaceMarks([
			{ originalStartLineNumber: 46, originalEndLineNumber: 46, modifiedStartLineNumber: 46, modifiedEndLineNumber: 46 },
			{ originalStartLineNumber: 300, originalEndLineNumber: 0, modifiedStartLineNumber: 301, modifiedEndLineNumber: 303 },
			{ originalStartLineNumber: 520, originalEndLineNumber: 525, modifiedStartLineNumber: 522, modifiedEndLineNumber: 0 },
			{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 0, modifiedEndLineNumber: 0 }
		]);
		assert.deepStrictEqual([...marks.lines], [[46, 'modified'], [301, 'added'], [302, 'added'], [303, 'added']]);
		assert.deepStrictEqual([...marks.deletedAfter], [522, 0]);
		assert.deepStrictEqual(marks.ticks, [
			{ kind: 'modified', first: 46, last: 46 },
			{ kind: 'added', first: 301, last: 303 },
			{ kind: 'deleted', first: 522, last: 522 },
			{ kind: 'deleted', first: 1, last: 1 }
		]);
	});

	test('a change stands in the ruler at its share of the file', () => {
		assert.deepStrictEqual(baseHalfCodeFaceTickBox({ kind: 'added', first: 501, last: 510 }, 1000), { top: 0.5, height: 0.01 });
	});
});

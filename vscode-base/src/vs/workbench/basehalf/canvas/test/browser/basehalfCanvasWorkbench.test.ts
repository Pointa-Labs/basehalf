/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfCanvasLayoutNotice, baseHalfCanvasPendingSelectionIsReady, baseHalfCanvasPostCreateOwnerIsCurrent, baseHalfCanvasRetainedCardChromeIsStale } from '../../browser/basehalfCanvasWorkbench.contribution.js';

suite('BaseHalfCanvasWorkbench', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('invalidates retained Note chrome only when its visual key changed', () => {
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'updated'), true);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
	});

	test('describes unusable saved layout in one calm line per damage kind', () => {
		assert.deepStrictEqual(
			[
				baseHalfCanvasLayoutNotice({ kind: 'partial', reason: 'cards[0].kind must be file or folder' }),
				baseHalfCanvasLayoutNotice({ kind: 'unreadable', reason: 'path must be "docs"' })
			],
			[
				'Some saved card positions could not be read',
				'This canvas\'s saved layout could not be read'
			]
		);
	});

	test('retains a post-create selection until every created card is visible in the model', () => {
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['new-note.md'], new Set()), false);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['new-note.md'], new Set(['existing.md'])), false);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['new-note.md'], new Set(['existing.md', 'new-note.md'])), true);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['a.md', 'b.md'], new Set(['a.md'])), false);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['a.md', 'b.md'], new Set(['a.md', 'b.md'])), true);
	});

	test('invalidates post-create presentation when interaction or navigation ownership changes', () => {
		const navigationA = {} as never;
		const navigationB = {} as never;
		const owner = { interactionEpoch: 7, navigationEpoch: 11, navigationState: navigationA };

		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 7, 11, navigationA), true);
		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 8, 11, navigationA), false);
		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 7, 12, navigationA), false);
		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 7, 11, navigationB), false);
	});
});

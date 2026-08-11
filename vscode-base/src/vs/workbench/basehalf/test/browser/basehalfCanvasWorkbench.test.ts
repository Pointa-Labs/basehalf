/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasCardPreviewCanRetainElement, baseHalfCanvasCardPreviewRenderKey, baseHalfCanvasPendingSelectionIsReady, baseHalfCanvasPostCreateOwnerIsCurrent, baseHalfCanvasRetainedCardChromeIsStale, baseHalfCanvasWarningDisplayMessage, baseHalfCanvasZoomFromPercentInput, formatBaseHalfCanvasZoomPercent } from '../../browser/basehalfCanvasWorkbench.contribution.js';

suite('BaseHalfCanvasWorkbench', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('invalidates retained Note chrome only when its visual key changed', () => {
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'updated'), true);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
	});

	test('compares refreshed result-node previews by rendered Map content', () => {
		const first = {
			kind: 'node',
			document: { id: 'video' },
			inputKinds: new Map([['prompt.md', 'text'], ['image.png', 'image']]),
			directSourceProblems: new Map([['missing.md', 'missing']])
		};
		const equivalent = {
			...first,
			inputKinds: new Map([['image.png', 'image'], ['prompt.md', 'text']]),
			directSourceProblems: new Map([['missing.md', 'missing']])
		};
		const changed = {
			...equivalent,
			directSourceProblems: new Map([['missing.md', 'changed']])
		};

		assert.strictEqual(baseHalfCanvasCardPreviewRenderKey(first as never), baseHalfCanvasCardPreviewRenderKey(equivalent as never));
		assert.notStrictEqual(baseHalfCanvasCardPreviewRenderKey(first as never), baseHalfCanvasCardPreviewRenderKey(changed as never));
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(true, first as never, equivalent as never), true);
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(true, first as never, changed as never), false);
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(false, first as never, equivalent as never), false);
	});

	test('collapses detailed corrupt canvas errors into one display warning', () => {
		assert.strictEqual(baseHalfCanvasWarningDisplayMessage('Corrupt canvas.yaml'), 'Corrupt canvas.yaml');
		assert.strictEqual(
			baseHalfCanvasWarningDisplayMessage('Corrupt canvas.yaml at file:///tmp/work/.bh/mirror/canvas.yaml: card \'note.md\' width must be positive'),
			'Corrupt canvas.yaml'
		);
		assert.strictEqual(baseHalfCanvasWarningDisplayMessage('Unable to read canvas.yaml'), 'Unable to read canvas.yaml');
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

	test('accepts bounded canvas zoom percentages without turning invalid input into reset', () => {
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('20'), 0.2);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput(' 37.5% '), 0.375);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('400'), 4);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('19.9'), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('401%'), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput(''), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('fit'), undefined);
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(0.375), '37.5');
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(1), '100');
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(4), '400');
	});
});

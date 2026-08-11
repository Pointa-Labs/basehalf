/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfPdfSelectionFromMessage, baseHalfPdfViewStateFromMessage, DEFAULT_BASEHALF_PDF_VIEW_STATE, isBaseHalfPdfUserInteractionMessage, normalizeBaseHalfPdfViewState } from '../../common/basehalfMediaViewState.js';

suite('BaseHalfMediaViewState', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizes persisted PDF reading state', () => {
		assert.deepStrictEqual(normalizeBaseHalfPdfViewState({ page: 7, zoom: 1.44, fitWidth: false }), {
			page: 7,
			zoom: 1.44,
			fitWidth: false
		});
		assert.deepStrictEqual(normalizeBaseHalfPdfViewState({ page: 0, zoom: 100, fitWidth: 'yes' }), {
			page: 1,
			zoom: 5,
			fitWidth: true
		});
		assert.deepStrictEqual(normalizeBaseHalfPdfViewState(undefined), DEFAULT_BASEHALF_PDF_VIEW_STATE);
	});

	test('accepts only PDF view-state messages', () => {
		assert.deepStrictEqual(baseHalfPdfViewStateFromMessage({
			type: 'basehalf.pdf.viewState',
			state: { page: 3, zoom: 0.8, fitWidth: true }
		}), { page: 3, zoom: 0.8, fitWidth: true });
		assert.strictEqual(baseHalfPdfViewStateFromMessage({ type: 'other', state: {} }), undefined);
		assert.strictEqual(baseHalfPdfViewStateFromMessage({ type: 'basehalf.pdf.viewState' }), undefined);
	});

	test('validates and bounds PDF branch selections at the webview boundary', () => {
		assert.deepStrictEqual(baseHalfPdfSelectionFromMessage({
			type: 'basehalf.pdf.createBranch',
			selection: { text: '  A useful passage.  ', pages: [4, 2, 4, -1, 2.5] }
		}), { text: 'A useful passage.', pages: [2, 4] });
		assert.strictEqual(baseHalfPdfSelectionFromMessage({
			type: 'basehalf.pdf.createBranch',
			selection: { text: '   ', pages: [1] }
		}), undefined);
		assert.strictEqual(baseHalfPdfSelectionFromMessage({
			type: 'basehalf.pdf.createBranch',
			selection: { text: 'Passage', pages: [] }
		}), undefined);
	});

	test('recognizes only the explicit PDF user-interaction bridge message', () => {
		assert.strictEqual(isBaseHalfPdfUserInteractionMessage({ type: 'basehalf.pdf.userInteraction' }), true);
		assert.strictEqual(isBaseHalfPdfUserInteractionMessage({ type: 'basehalf.pdf.viewState' }), false);
		assert.strictEqual(isBaseHalfPdfUserInteractionMessage(undefined), false);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfPdfFailureFromMessage, baseHalfPdfSelectionChangeFromMessage, baseHalfPdfSelectionFromMessage, baseHalfPdfViewStateFromMessage, DEFAULT_BASEHALF_PDF_VIEW_STATE, isBaseHalfMediaEscapeMessage, isBaseHalfPdfUserInteractionMessage, normalizeBaseHalfPdfViewState } from '../../common/basehalfMediaViewState.js';

suite('BaseHalfMediaViewState', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizes persisted PDF reading state: a zoom the user chose, or none for the width of Card Detail', () => {
		assert.deepStrictEqual([
			normalizeBaseHalfPdfViewState({ page: 7, zoom: 1.44 }),
			normalizeBaseHalfPdfViewState({ page: 0, zoom: 100 }),
			normalizeBaseHalfPdfViewState({ page: 2, zoom: 'fit-page' }),
			normalizeBaseHalfPdfViewState({ page: 2, zoom: 'fit-width' }),
			normalizeBaseHalfPdfViewState({ page: 3, zoom: 'automatic' }),
			normalizeBaseHalfPdfViewState({ page: 4 }),
			normalizeBaseHalfPdfViewState(undefined)
		], [
			{ page: 7, zoom: 1.44 },
			{ page: 1, zoom: 5 },
			{ page: 2, zoom: 'fit-page' },
			{ page: 2, zoom: 'fit-width' },
			{ page: 3 },
			{ page: 4 },
			DEFAULT_BASEHALF_PDF_VIEW_STATE
		]);
	});

	test('accepts only PDF view-state messages', () => {
		assert.deepStrictEqual(baseHalfPdfViewStateFromMessage({
			type: 'basehalf.pdf.viewState',
			state: { page: 3, zoom: 0.8 }
		}), { page: 3, zoom: 0.8 });
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

	test('takes the text selected in a PDF, at most one character more than the record of agents keeps, and an ended selection', () => {
		assert.deepStrictEqual([
			baseHalfPdfSelectionChangeFromMessage({ type: 'basehalf.pdf.selectionChanged', selection: { text: ' 激励人心 ', pages: [3, 2] } }),
			baseHalfPdfSelectionChangeFromMessage({ type: 'basehalf.pdf.selectionChanged', selection: { text: 'x'.repeat(20_000), pages: [1] } })?.selection?.text.length,
			baseHalfPdfSelectionChangeFromMessage({ type: 'basehalf.pdf.selectionChanged' }),
			baseHalfPdfSelectionChangeFromMessage({ type: 'basehalf.pdf.selectionChanged', selection: { text: '  ', pages: [1] } }),
			baseHalfPdfSelectionChangeFromMessage({ type: 'basehalf.pdf.createBranch', selection: { text: 'Passage', pages: [1] } })
		], [
			{ selection: { text: ' 激励人心 ', pages: [2, 3] } },
			10_001,
			{},
			{},
			undefined
		]);
	});

	test('recognizes only the explicit PDF user-interaction bridge message', () => {
		assert.strictEqual(isBaseHalfPdfUserInteractionMessage({ type: 'basehalf.pdf.userInteraction' }), true);
		assert.strictEqual(isBaseHalfPdfUserInteractionMessage({ type: 'basehalf.pdf.viewState' }), false);
		assert.strictEqual(isBaseHalfPdfUserInteractionMessage(undefined), false);
	});

	test('takes the reason a PDF did not open for the log, at most 500 characters', () => {
		assert.deepStrictEqual([
			baseHalfPdfFailureFromMessage({ type: 'basehalf.pdf.failed', message: 'FPDF_LoadMemDocument failed' }),
			baseHalfPdfFailureFromMessage({ type: 'basehalf.pdf.failed', message: 'x'.repeat(900) })?.length,
			baseHalfPdfFailureFromMessage({ type: 'basehalf.pdf.failed', message: 42 }),
			baseHalfPdfFailureFromMessage({ type: 'basehalf.pdf.userInteraction' }),
			baseHalfPdfFailureFromMessage('basehalf.pdf.failed')
		], ['FPDF_LoadMemDocument failed', 500, '', undefined, undefined]);
	});

	test('recognizes only the Escape that a page of Card Detail did not use', () => {
		assert.deepStrictEqual(
			[{ type: 'basehalf.media.escape' }, { type: 'basehalf.media.drawn' }, { type: 'basehalf.pdf.userInteraction' }, 'basehalf.media.escape', undefined].map(isBaseHalfMediaEscapeMessage),
			[true, false, false, false, false]
		);
	});
});

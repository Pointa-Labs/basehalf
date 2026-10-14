/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasCardPreviewCanRetainElement, baseHalfCanvasCardPreviewRenderKey, baseHalfCanvasLayoutNotice, baseHalfCanvasPendingSelectionIsReady, baseHalfCanvasPostCreateOwnerIsCurrent, baseHalfCanvasRetainedCardChromeIsStale, baseHalfCanvasVideoCardStatus, baseHalfCanvasZoomFromPercentInput, formatBaseHalfCanvasZoomPercent } from '../../browser/basehalfCanvasWorkbench.contribution.js';
import { createBaseHalfNodeDocument, IBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { IBaseHalfVideoGenerationRecord, IBaseHalfVideoTask } from '../../common/basehalfVideoNode.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

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

	test('says what a Video node card shows in each phase', () => {
		const request: IBaseHalfVideoGenerationRecord = { provider: 'ark', model: 'seedance', prompt: '', inputs: [], mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true };
		const running: IBaseHalfVideoTask = { id: 'task-1', state: 'running', startedAt: '2026-10-15T08:00:00.000Z', channel: 'ark-1', remoteId: 'cgt-1', request };
		const node = (fields: Pick<IBaseHalfNodeDocument, 'task' | 'result'>) => createBaseHalfNodeDocument({ id: baseHalfNodeTestId(1), kind: 'video', title: 'Shot 1', ...fields });
		const withVideo = node({ result: { source: 'imported', artifact: { kind: 'video', path: 'assets/clip.mp4', size: 1 } } });
		assert.deepStrictEqual([
			baseHalfCanvasVideoCardStatus({ document: node({}) }),
			baseHalfCanvasVideoCardStatus({ document: node({ task: { ...running, state: 'submitting', remoteId: undefined } }) }),
			baseHalfCanvasVideoCardStatus({ document: node({ task: running }) }),
			baseHalfCanvasVideoCardStatus({ document: node({ task: { ...running, state: 'failed', endedAt: '2026-10-15T08:01:00.000Z', error: 'The key was refused.' } }) }),
			baseHalfCanvasVideoCardStatus({ document: node({ task: { ...running, state: 'stopped', endedAt: '2026-10-15T08:01:00.000Z' } }) }),
			baseHalfCanvasVideoCardStatus({ document: withVideo }),
			baseHalfCanvasVideoCardStatus({ document: withVideo, resultMissing: true })
		], [
			{ phase: 'empty' },
			{ phase: 'generating', text: 'Generating' },
			{ phase: 'generating', text: 'Generating' },
			{ phase: 'failed', text: 'The key was refused.' },
			{ phase: 'stopped', text: 'Stopped' },
			{ phase: 'video' },
			{ phase: 'video', text: 'The video file is missing', title: 'assets/clip.mp4' }
		]);
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

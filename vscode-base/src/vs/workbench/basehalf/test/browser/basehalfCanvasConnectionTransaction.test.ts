/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfCanvasInteractionRenderGate,
	baseHalfBadgeDraftFailureDisposition,
	baseHalfCopyRetainedBadgeDraft,
	baseHalfDiscardRetainedBadgeDraft,
	baseHalfPersistedCanvasEdgeRemoval,
	baseHalfShouldVetoForBadgeDrafts,
	baseHalfTransitionBadgeDraftIdentity,
	removeCompleteBaseHalfCanvasReference
} from '../../browser/basehalfCanvasConnectionTransaction.js';
import { IBaseHalfReferenceState } from '../../common/basehalfBadgeGraph.js';

suite('BaseHalf canvas connection transactions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	for (const concurrentState of [
		{ forward: true, backlink: false },
		{ forward: false, backlink: true }
	] as const) {
		test(`restores a concurrent ${concurrentState.forward ? 'forward' : 'backlink'}-only reference before rejecting a node save`, async () => {
			let truth: IBaseHalfReferenceState = concurrentState;
			let undoElements = 0;

			await assert.rejects(async () => {
				await removeCompleteBaseHalfCanvasReference(
					async () => {
						const before = truth;
						truth = { forward: false, backlink: false };
						return { removed: before.forward, before, after: truth };
					},
					async transition => {
						assert.deepStrictEqual(truth, transition.after);
						truth = transition.before;
					},
					'The reference changed before the save completed.'
				);
				undoElements++;
			}, /changed before the save completed/);

			assert.deepStrictEqual(truth, concurrentState);
			assert.strictEqual(undoElements, 0);
		});
	}

	test('removes a complete reciprocal reference as one recoverable transition', async () => {
		let truth: IBaseHalfReferenceState = { forward: true, backlink: true };
		const transition = await removeCompleteBaseHalfCanvasReference(
			async () => {
				const before = truth;
				truth = { forward: false, backlink: false };
				return { removed: true, before, after: truth };
			},
			async () => assert.fail('A complete reference must not be restored during removal.'),
			'The reference changed.'
		);

		assert.deepStrictEqual(transition.before, { forward: true, backlink: true });
		assert.deepStrictEqual(truth, { forward: false, backlink: false });
	});

	test('explicit binding cleanup can recover when reciprocal graph metadata is already absent', async () => {
		const truth: IBaseHalfReferenceState = { forward: false, backlink: false };
		let restored = false;
		const transition = await removeCompleteBaseHalfCanvasReference(
			async () => ({ removed: false, before: truth, after: truth }),
			async () => { restored = true; },
			'The reference changed.',
			true
		);

		assert.deepStrictEqual(transition.before, { forward: false, backlink: false });
		assert.strictEqual(restored, false);
	});

	test('derived semantic edges without persisted anchors have no style deletion CAS', () => {
		assert.deepStrictEqual(baseHalfPersistedCanvasEdgeRemoval([], 'brief.md', 'frame.bhnode'), []);
		const persisted = {
			from: 'brief.md',
			from_anchor: 'east' as const,
			to: 'frame.bhnode',
			to_anchor: 'west' as const
		};
		assert.deepStrictEqual(
			baseHalfPersistedCanvasEdgeRemoval([persisted], 'brief.md', 'frame.bhnode'),
			[{ from: 'brief.md', to: 'frame.bhnode', expected: persisted, next: null }]
		);
	});

	test('keeps the rendered card stable through a pointer gesture and flushes one queued refresh', () => {
		const gate = new BaseHalfCanvasInteractionRenderGate();
		assert.strictEqual(gate.defer(), false);
		gate.begin();
		assert.strictEqual(gate.defer(), true);
		assert.strictEqual(gate.defer(), true);
		assert.strictEqual(gate.end(), true);
		assert.strictEqual(gate.defer(), false);
		assert.strictEqual(gate.end(), false);
	});

	test('archives an old draft without blocking a replacement resource draft', () => {
		const originalStamp = { workspaceKey: 'file:///workspace', relativePath: 'note.md', structuralEpoch: 1 };
		const replacementStamp = { ...originalStamp, structuralEpoch: 2 };
		const original = { identityStamp: originalStamp, resourceIdentity: 'file:direct:100', value: 'original unsaved text' };
		const replacement = { identityStamp: replacementStamp, resourceIdentity: 'file:direct:200', value: 'replacement text' };

		const replaced = baseHalfTransitionBadgeDraftIdentity(original, [], replacementStamp, replacement.resourceIdentity);
		assert.strictEqual(replaced.identityChanged, true);
		assert.strictEqual(replaced.active, undefined);
		assert.deepStrictEqual(replaced.retained, [original]);

		const editable = baseHalfTransitionBadgeDraftIdentity(replacement, replaced.retained, replacementStamp, replacement.resourceIdentity);
		assert.strictEqual(editable.identityChanged, false);
		assert.strictEqual(editable.active, replacement);
		assert.deepStrictEqual(editable.retained, [original]);
		assert.deepStrictEqual(baseHalfDiscardRetainedBadgeDraft(editable.retained, original), []);
	});

	test('archives an externally recreated path even when its structural epoch did not change', () => {
		const stamp = { workspaceKey: 'file:///workspace', relativePath: 'note.md', structuralEpoch: 1 };
		const original = { identityStamp: stamp, resourceIdentity: 'file:direct:100', value: 'unsaved text' };
		const replaced = baseHalfTransitionBadgeDraftIdentity(original, [], stamp, 'file:direct:200');
		assert.strictEqual(replaced.identityChanged, true);
		assert.strictEqual(replaced.active, undefined);
		assert.deepStrictEqual(replaced.retained, [original]);
	});

	test('retains bounded failures and archives drafts whose resource is replaced or missing', () => {
		assert.strictEqual(baseHalfBadgeDraftFailureDisposition(true, true, 0), 'retry');
		assert.strictEqual(baseHalfBadgeDraftFailureDisposition(true, true, 3), 'retain');
		assert.strictEqual(baseHalfBadgeDraftFailureDisposition(true, false, 0), 'archive-replaced');
		assert.strictEqual(baseHalfBadgeDraftFailureDisposition(false, false, 0), 'archive-missing');
	});

	test('blocks shutdown until retained drafts are explicitly discarded', () => {
		assert.strictEqual(baseHalfShouldVetoForBadgeDrafts(0, undefined), false);
		assert.strictEqual(baseHalfShouldVetoForBadgeDrafts(1, undefined), true);
		assert.strictEqual(baseHalfShouldVetoForBadgeDrafts(1, 'stay'), true);
		assert.strictEqual(baseHalfShouldVetoForBadgeDrafts(1, 'discard'), false);
	});

	test('settles retained-draft clipboard failures without losing the recovery state', async () => {
		const failure = new Error('clipboard unavailable');
		let reported: unknown;
		assert.strictEqual(await baseHalfCopyRetainedBadgeDraft(
			async () => { throw failure; },
			error => reported = error
		), false);
		assert.strictEqual(reported, failure);
		assert.strictEqual(await baseHalfCopyRetainedBadgeDraft(async () => { }, () => assert.fail('Successful copies must not report a failure.')), true);
	});
});

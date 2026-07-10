/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { FileOperation } from '../../../../platform/files/common/files.js';
import { BaseHalfMirrorCascadeStageError, baseHalfMirrorCascadeCompletedMutations, baseHalfMoveCrossesWorkspaceRoots, baseHalfOrderCascadeStages, baseHalfPrepareStructuralDetail, baseHalfRunRequiredCascadeStages, baseHalfShouldRepublishCascadeRecoveryPrompt, baseHalfStructuralOperationAffectsResource } from '../../common/basehalfMirrorCascadeOperation.js';

suite('BaseHalfMirrorCascadeOperation', () => {
	test('failed batch maps only the explicit completed prefix', () => {
		const first = { source: URI.file('/workspace/a.md'), target: URI.file('/workspace/a-moved.md') };
		const unattempted = { source: URI.file('/workspace/b.md'), target: URI.file('/workspace/b-moved.md') };
		const completed = baseHalfMirrorCascadeCompletedMutations(FileOperation.MOVE, [first]);

		assert.deepStrictEqual(completed, [{ operation: FileOperation.MOVE, ...first }]);
		assert.ok(!completed.some(entry => entry.source?.toString() === unattempted.source.toString()));
	});

	test('zero completed members stays an empty aborted fact set', () => {
		assert.deepStrictEqual(baseHalfMirrorCascadeCompletedMutations(FileOperation.DELETE, []), []);
	});

	test('source and target subtrees both fence an affected retained detail', () => {
		const source = URI.file('/workspace/docs');
		const target = URI.file('/workspace/archive');
		const files = [{ source, target }];

		assert.strictEqual(baseHalfStructuralOperationAffectsResource(FileOperation.MOVE, files, URI.file('/workspace/docs/readme.md')), true);
		assert.strictEqual(baseHalfStructuralOperationAffectsResource(FileOperation.MOVE, files, URI.file('/workspace/archive/existing.md')), true);
		assert.strictEqual(baseHalfStructuralOperationAffectsResource(FileOperation.MOVE, files, URI.file('/workspace/other.md')), false);
		assert.strictEqual(baseHalfStructuralOperationAffectsResource(FileOperation.COPY, files, URI.file('/workspace/docs/readme.md')), false);
	});

	test('cross-workspace-root move is detected for a hard pre-IO veto', () => {
		const first = URI.file('/workspace-a');
		const second = URI.file('/workspace-b');
		const locate = (resource: URI) => resource.path.startsWith('/workspace-a/') ? first : resource.path.startsWith('/workspace-b/') ? second : undefined;

		assert.strictEqual(baseHalfMoveCrossesWorkspaceRoots([
			{ source: URI.file('/workspace-a/doc.md'), target: URI.file('/workspace-b/doc.md') }
		], locate), true);
		assert.strictEqual(baseHalfMoveCrossesWorkspaceRoots([
			{ source: URI.file('/workspace-a/doc.md'), target: URI.file('/workspace-a/moved.md') }
		], locate), false);
	});

	test('affected rich detail flushes before structural work may proceed', async () => {
		const order: string[] = [];
		const guard = await baseHalfPrepareStructuralDetail(
			FileOperation.DELETE,
			[{ target: URI.file('/workspace/docs') }],
			URI.file('/workspace/docs/readme.md'),
			() => { order.push('acquire-fence'); return { dispose: () => order.push('release-fence') }; },
			async () => { order.push('flush-rich'); return true; }
		);
		order.push('structural-work');
		guard?.dispose();

		assert.deepStrictEqual(order, ['acquire-fence', 'flush-rich', 'structural-work', 'release-fence']);
	});

	test('operation subtrees are fenced even when no detail is open at prepare time', async () => {
		let sourceFenced = false;
		let targetFenced = false;
		let flushCalls = 0;
		const guard = await baseHalfPrepareStructuralDetail(
			FileOperation.MOVE,
			[{ source: URI.file('/workspace/docs'), target: URI.file('/workspace/archive') }],
			undefined,
			() => {
				sourceFenced = true;
				targetFenced = true;
				return { dispose: () => { sourceFenced = false; targetFenced = false; } };
			},
			async () => { flushCalls++; return true; }
		);

		// A detail opened later under either batch endpoint observes the held
		// operation fence before it can accept an edit.
		assert.strictEqual(sourceFenced, true);
		assert.strictEqual(targetFenced, true);
		assert.strictEqual(flushCalls, 0);
		guard?.dispose();
		assert.strictEqual(sourceFenced, false);
		assert.strictEqual(targetFenced, false);
	});

	test('failed or rejected retained-detail flush vetoes structural work', async () => {
		const files = [{ source: URI.file('/workspace/a.md'), target: URI.file('/workspace/b.md') }];
		let structuralWork = 0;
		let fences = 0;
		const run = async (flush: () => Promise<boolean>) => {
			await baseHalfPrepareStructuralDetail(
				FileOperation.MOVE,
				files,
				files[0].source,
				() => { fences++; return { dispose: () => fences-- }; },
				flush
			);
			structuralWork++;
		};
		await assert.rejects(run(async () => false), /could not be saved/);
		await assert.rejects(run(async () => { throw new Error('webview save rejected'); }), /webview save rejected/);
		assert.strictEqual(structuralWork, 0);
		assert.strictEqual(fences, 0);
	});

	test('required cascade retries only the failed stage and never replays committed predecessors', async () => {
		const calls = [0, 0, 0];
		await baseHalfRunRequiredCascadeStages([
			{ label: 'graph', run: async () => { calls[0]++; } },
			{ label: 'canvas', run: async () => { if (++calls[1] < 3) { throw new Error('transient'); } } },
			{ label: 'adhd', run: async () => { calls[2]++; } }
		]);

		assert.deepStrictEqual(calls, [1, 3, 1]);
	});

	test('batch ordering keeps pair order inside projection and semantic phases', () => {
		assert.deepStrictEqual(baseHalfOrderCascadeStages([
			{ projectionStages: ['pair-1-canvas', 'pair-1-adhd'], semanticStages: ['pair-1-badge'] },
			{ projectionStages: ['pair-2-canvas', 'pair-2-adhd'], semanticStages: ['pair-2-badge'] }
		]), [
			'pair-1-canvas', 'pair-1-adhd',
			'pair-2-canvas', 'pair-2-adhd',
			'pair-1-badge', 'pair-2-badge'
		]);
	});

	test('persistent required-stage failure exposes an exact recovery cursor', async () => {
		const calls = [0, 0, 0];
		await assert.rejects(
			() => baseHalfRunRequiredCascadeStages([
				{ label: 'graph', run: async () => { calls[0]++; } },
				{ label: 'canvas', run: async () => { calls[1]++; throw new Error('persistent'); } },
				{ label: 'adhd', run: async () => { calls[2]++; } }
			]),
			error => error instanceof BaseHalfMirrorCascadeStageError
				&& error.stageIndex === 1
				&& error.stageLabel === 'canvas'
		);
		assert.deepStrictEqual(calls, [1, 3, 0]);
	});

	test('one batch cursor finishes every pair projection before any semantic owner', async () => {
		const order: string[] = [];
		let blocked = true;
		const stages = [
			{ label: 'pair 1 canvas', run: async () => { order.push('pair-1-canvas'); } },
			{ label: 'pair 1 ADHD', run: async () => { order.push('pair-1-adhd'); } },
			{
				label: 'pair 2 canvas',
				run: async () => {
					order.push('pair-2-canvas');
					if (blocked) {
						throw new Error('persistent');
					}
				}
			},
			{ label: 'pair 2 ADHD', run: async () => { order.push('pair-2-adhd'); } },
			{ label: 'pair 1 badge', run: async () => { order.push('pair-1-badge'); } },
			{ label: 'pair 2 badge', run: async () => { order.push('pair-2-badge'); } }
		];

		let cursor = -1;
		try {
			await baseHalfRunRequiredCascadeStages(stages);
		} catch (error) {
			assert.ok(error instanceof BaseHalfMirrorCascadeStageError);
			cursor = error.stageIndex;
		}
		assert.strictEqual(cursor, 2);
		assert.deepStrictEqual(order, [
			'pair-1-canvas', 'pair-1-adhd',
			'pair-2-canvas', 'pair-2-canvas', 'pair-2-canvas'
		]);

		blocked = false;
		await baseHalfRunRequiredCascadeStages(stages, cursor);
		assert.deepStrictEqual(order, [
			'pair-1-canvas', 'pair-1-adhd',
			'pair-2-canvas', 'pair-2-canvas', 'pair-2-canvas',
			'pair-2-canvas', 'pair-2-adhd',
			'pair-1-badge', 'pair-2-badge'
		]);
	});

	test('required cascade never blindly retries a failed conditional compensation', async () => {
		let calls = 0;
		await assert.rejects(
			() => baseHalfRunRequiredCascadeStages([{
				label: 'graph',
				run: async () => { calls++; throw new AggregateError([new Error('commit'), new Error('rollback')]); }
			}]),
			error => error instanceof BaseHalfMirrorCascadeStageError && error.attempts === 1
		);
		assert.strictEqual(calls, 1);
	});

	test('required cascade does not mistake an undefined rejection reason for success', async () => {
		let laterStageCalls = 0;
		await assert.rejects(
			() => baseHalfRunRequiredCascadeStages([
				{ label: 'undefined failure', run: () => Promise.reject() },
				{ label: 'must remain blocked', run: async () => { laterStageCalls++; } }
			]),
			error => error instanceof BaseHalfMirrorCascadeStageError
				&& error.stageIndex === 0
				&& error.attempts === 3
		);
		assert.strictEqual(laterStageCalls, 0);
	});

	test('recovery prompt republishes only after an unsuppressed user close', () => {
		const manualClose = {
			disposed: false,
			pending: true,
			running: false,
			hasNotification: false,
			closeWasSuppressed: false
		};
		assert.strictEqual(baseHalfShouldRepublishCascadeRecoveryPrompt(manualClose), true);
		assert.strictEqual(baseHalfShouldRepublishCascadeRecoveryPrompt({ ...manualClose, closeWasSuppressed: true }), false);
		assert.strictEqual(baseHalfShouldRepublishCascadeRecoveryPrompt({ ...manualClose, running: true }), false);
		assert.strictEqual(baseHalfShouldRepublishCascadeRecoveryPrompt({ ...manualClose, pending: false }), false);
		assert.strictEqual(baseHalfShouldRepublishCascadeRecoveryPrompt({ ...manualClose, disposed: true }), false);
		assert.strictEqual(baseHalfShouldRepublishCascadeRecoveryPrompt({ ...manualClose, hasNotification: true }), false);
	});
});

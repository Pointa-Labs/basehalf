/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { FileOperation } from '../../../../platform/files/common/files.js';
import { baseHalfStructuralResourceOutcome, BaseHalfWorkspaceMutationCoordinator, IBaseHalfStructuralMutationOutcome } from '../../common/basehalfWorkspaceMutation.js';

suite('BaseHalfWorkspaceMutationCoordinator', () => {
	const workspaceA = URI.file('/workspace-a');
	const workspaceB = URI.file('/workspace-b');

	test('commits ordinary mutations in issuance order rather than IO completion order', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const order: string[] = [];
		let releaseFirst!: () => void;
		let signalFirstStarted!: () => void;
		const firstGate = new Promise<void>(resolve => releaseFirst = resolve);
		const firstStarted = new Promise<void>(resolve => signalFirstStarted = resolve);
		const first = coordinator.runExclusive(workspaceA, async () => {
			order.push('first:start');
			signalFirstStarted();
			await firstGate;
			order.push('first:end');
		});
		const second = coordinator.runExclusive(workspaceA, async () => {
			order.push('second');
		});

		await firstStarted;
		assert.deepStrictEqual(order, ['first:start']);
		releaseFirst();
		await Promise.all([first, second]);
		assert.deepStrictEqual(order, ['first:start', 'first:end', 'second']);
	});

	test('rejects both pre-reservation and in-reservation scene stamps', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const before = coordinator.capture(workspaceA);
		const reservation = coordinator.reserveStructural(workspaceA);
		await reservation.ready;
		const during = coordinator.capture(workspaceA);
		let ran = false;

		await assert.rejects(coordinator.runSceneMutation(workspaceA, before, async () => { ran = true; }));
		await assert.rejects(coordinator.runSceneMutation(workspaceA, during, async () => { ran = true; }));
		await reservation.finish(async () => undefined);
		await assert.rejects(coordinator.runSceneMutation(workspaceA, during, async () => { ran = true; }));
		assert.strictEqual(ran, false);
	});

	test('lets an already-issued scene mutation finish before a later structural cascade', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const stamp = coordinator.capture(workspaceA);
		const order: string[] = [];
		let releaseScene!: () => void;
		let signalSceneStarted!: () => void;
		const sceneGate = new Promise<void>(resolve => releaseScene = resolve);
		const sceneStarted = new Promise<void>(resolve => signalSceneStarted = resolve);
		const scene = coordinator.runSceneMutation(workspaceA, stamp, async () => {
			order.push('scene:start');
			signalSceneStarted();
			await sceneGate;
			order.push('scene:end');
		});
		const reservation = coordinator.reserveStructural(workspaceA);

		await sceneStarted;
		assert.deepStrictEqual(order, ['scene:start']);
		releaseScene();
		await scene;
		await reservation.ready;
		await reservation.finish(async () => { order.push('structural'); });
		assert.deepStrictEqual(order, ['scene:start', 'scene:end', 'structural']);
	});

	test('serializes overlapping multi-workspace reservations without deadlock', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const first = coordinator.reserveStructural([workspaceA, workspaceB]);
		const second = coordinator.reserveStructural([workspaceB, workspaceA]);
		await first.ready;
		let secondReady = false;
		void second.ready.then(() => secondReady = true);
		await Promise.resolve();
		assert.strictEqual(secondReady, false);
		await first.finish(async () => undefined);
		await second.ready;
		await second.finish(async lease => {
			coordinator.assertLease(lease, workspaceA);
			coordinator.assertLease(lease, workspaceB);
		});
	});

	test('internal finalization releases the commit barrier before publishing retained-surface outcome', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const outcomes: IBaseHalfStructuralMutationOutcome[] = [];
		coordinator.onDidFinishStructuralMutation(outcome => outcomes.push(outcome));
		const first = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'a.md' }]);
		const second = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'a.md' }]);
		await first.ready;
		let secondReady = false;
		void second.ready.then(() => secondReady = true);

		await first.finishInternal(async () => undefined, [{
			operation: FileOperation.DELETE,
			target: URI.joinPath(workspaceA, 'a.md')
		}]);
		await second.ready;
		assert.strictEqual(secondReady, true);
		assert.strictEqual(outcomes.length, 0);

		await first.publish();
		assert.deepStrictEqual(outcomes.map(outcome => outcome.kind), ['committed']);
		await first.publish();
		assert.strictEqual(outcomes.length, 1);
		await second.abort();
	});

	test('a deferred structural finalizer keeps later workspace mutations behind the same lease', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const order: string[] = [];
		let resumeRecovery!: () => void;
		let recoveryStarted!: () => void;
		const recoveryGate = new Promise<void>(resolve => resumeRecovery = resolve);
		const started = new Promise<void>(resolve => recoveryStarted = resolve);
		const reservation = coordinator.reserveStructural(workspaceA);
		await reservation.ready;
		const finalize = reservation.finishInternal(async () => {
			order.push('recovery:waiting');
			recoveryStarted();
			await recoveryGate;
			order.push('recovery:complete');
		});
		await started;

		const later = coordinator.runExclusive(workspaceA, async () => { order.push('later-mutation'); });
		await Promise.resolve();
		assert.deepStrictEqual(order, ['recovery:waiting']);

		resumeRecovery();
		await Promise.all([finalize, later]);
		assert.deepStrictEqual(order, ['recovery:waiting', 'recovery:complete', 'later-mutation']);
	});

	test('publish awaits retained-surface listener reconciliation', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		let releaseReconcile!: () => void;
		const reconcileGate = new Promise<void>(resolve => releaseReconcile = resolve);
		let reconciled = false;
		coordinator.onDidFinishStructuralMutation(outcome => {
			outcome.waitUntil(reconcileGate.then(() => { reconciled = true; }));
		});
		const reservation = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'a.md' }]);
		await reservation.finishInternal(async () => undefined, [{
			operation: FileOperation.DELETE,
			target: URI.joinPath(workspaceA, 'a.md')
		}]);

		let publishResolved = false;
		const publish = reservation.publish().then(() => publishResolved = true);
		await Promise.resolve();
		assert.strictEqual(publishResolved, false);
		releaseReconcile();
		await publish;
		assert.strictEqual(reconciled, true);
	});

	test('nested successor publish composes behind its unpublished predecessor and maps A through B to C', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const a = URI.joinPath(workspaceA, 'a.md');
		const b = URI.joinPath(workspaceA, 'b.md');
		const c = URI.joinPath(workspaceA, 'c.md');
		let detail = a;
		coordinator.onDidFinishStructuralMutation(outcome => {
			outcome.waitUntil(Promise.resolve().then(() => {
				const relative = detail.path.slice(workspaceA.path.length + 1);
				const effect = baseHalfStructuralResourceOutcome(outcome, workspaceA, relative, detail);
				if (effect.kind === 'move') {
					detail = effect.resource;
				}
			}));
		});

		const outer = coordinator.reserveStructural(workspaceA, [
			{ workspace: workspaceA, relativePath: 'a.md' },
			{ workspace: workspaceA, relativePath: 'b.md' }
		]);
		await outer.finishInternal(async () => undefined, [{ operation: FileOperation.MOVE, source: a, target: b }]);
		const nested = coordinator.reserveStructural(workspaceA, [
			{ workspace: workspaceA, relativePath: 'b.md' },
			{ workspace: workspaceA, relativePath: 'c.md' }
		]);
		await nested.finishInternal(async () => undefined, [{ operation: FileOperation.MOVE, source: b, target: c }]);

		// Mirrors an operation awaited inside the predecessor's public did
		// listener: it must not deadlock waiting for the outer publish.
		await nested.publish();
		assert.strictEqual(detail.toString(), a.toString());
		await outer.publish();
		assert.strictEqual(detail.toString(), c.toString());
	});

	test('a vetoed prepared reservation publishes one non-destructive cancellation and unblocks the next commit barrier', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const outcomes: IBaseHalfStructuralMutationOutcome[] = [];
		coordinator.onDidFinishStructuralMutation(outcome => outcomes.push(outcome));
		const vetoed = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'docs' }]);
		const later = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'docs/readme.md' }]);
		await vetoed.ready;
		let laterReady = false;
		void later.ready.then(() => laterReady = true);
		await Promise.resolve();
		assert.strictEqual(laterReady, false);

		await Promise.all([vetoed.cancel(), vetoed.cancel()]);
		await later.ready;
		assert.strictEqual(laterReady, true);
		assert.deepStrictEqual(outcomes.map(outcome => outcome.kind), ['cancelled']);
		assert.deepStrictEqual(baseHalfStructuralResourceOutcome(
			outcomes[0],
			workspaceA,
			'docs/readme.md',
			URI.joinPath(workspaceA, 'docs', 'readme.md')
		), { kind: 'none' });
		await later.abort();
	});

	test('rejects using a lease for a different workspace', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		await coordinator.runExclusive(workspaceA, async lease => {
			assert.throws(() => coordinator.assertLease(lease, workspaceB));
		});
	});

	test('resource stamps survive unrelated structure changes but reject their own subtree changes', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const stable = coordinator.captureResource(workspaceA, 'docs/readme.md');
		const unrelated = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'other' }]);
		await unrelated.ready;
		let ran = false;
		const queued = coordinator.runResourceMutation(workspaceA, stable, async () => { ran = true; });
		await unrelated.finish(async () => undefined);
		await queued;
		assert.strictEqual(ran, true);

		const affected = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'docs' }]);
		await affected.ready;
		const during = coordinator.captureResource(workspaceA, 'docs/readme.md');
		await assert.rejects(coordinator.runResourceMutation(workspaceA, stable, async () => undefined));
		await assert.rejects(coordinator.runResourceMutation(workspaceA, during, async () => undefined));
		await affected.finish(async () => undefined);
		await assert.rejects(coordinator.runResourceMutation(workspaceA, during, async () => undefined));
	});

	test('publishes committed, aborted, and reconciled outcomes with attempted paths and completed facts', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const outcomes: IBaseHalfStructuralMutationOutcome[] = [];
		coordinator.onDidFinishStructuralMutation(outcome => outcomes.push(outcome));
		const source = URI.joinPath(workspaceA, 'a.md');
		const target = URI.joinPath(workspaceA, 'b.md');
		const paths = [
			{ workspace: workspaceA, relativePath: 'a.md' },
			{ workspace: workspaceA, relativePath: 'b.md' }
		];

		const committed = coordinator.reserveStructural(workspaceA, paths);
		await committed.finish(async () => undefined, [{ operation: FileOperation.MOVE, source, target }]);
		const aborted = coordinator.reserveStructural(workspaceA, paths);
		await aborted.abort();
		const reconciled = coordinator.reserveStructural(workspaceA, paths);
		await reconciled.reconcile(
			[{ operation: FileOperation.MOVE, source, target }],
			async () => undefined
		);

		assert.deepStrictEqual(outcomes.map(outcome => outcome.kind), ['committed', 'aborted', 'reconciled']);
		assert.deepStrictEqual(outcomes.map(outcome => outcome.affectedPaths.map(path => path.relativePath)), [
			['a.md', 'b.md'],
			['a.md', 'b.md'],
			['a.md', 'b.md']
		]);
		assert.deepStrictEqual(outcomes.map(outcome => outcome.completed.length), [1, 0, 1]);
	});

	test('classifies retained identities from a reconciled partial move prefix', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		let outcome: IBaseHalfStructuralMutationOutcome | undefined;
		coordinator.onDidFinishStructuralMutation(value => outcome = value);
		const firstSource = URI.joinPath(workspaceA, 'first.md');
		const firstTarget = URI.joinPath(workspaceA, 'first-moved.md');
		const reservation = coordinator.reserveStructural(workspaceA, [
			{ workspace: workspaceA, relativePath: 'first.md' },
			{ workspace: workspaceA, relativePath: 'first-moved.md' },
			{ workspace: workspaceA, relativePath: 'second.md' },
			{ workspace: workspaceA, relativePath: 'second-moved.md' }
		]);
		await reservation.reconcile(
			[{ operation: FileOperation.MOVE, source: firstSource, target: firstTarget }],
			async () => undefined
		);

		assert.ok(outcome);
		assert.deepStrictEqual(baseHalfStructuralResourceOutcome(outcome, workspaceA, 'first.md', firstSource), { kind: 'move', resource: firstTarget });
		assert.deepStrictEqual(baseHalfStructuralResourceOutcome(outcome, workspaceA, 'first-moved.md', firstTarget), { kind: 'close' });
		assert.deepStrictEqual(baseHalfStructuralResourceOutcome(outcome, workspaceA, 'second.md', URI.joinPath(workspaceA, 'second.md')), { kind: 'recreate' });
		assert.deepStrictEqual(baseHalfStructuralResourceOutcome(outcome, workspaceA, 'unrelated.md', URI.joinPath(workspaceA, 'unrelated.md')), { kind: 'none' });
	});

	test('successful delete closes descendants while an aborted attempt validates and recreates them', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const outcomes: IBaseHalfStructuralMutationOutcome[] = [];
		coordinator.onDidFinishStructuralMutation(value => outcomes.push(value));
		const docs = URI.joinPath(workspaceA, 'docs');
		const readme = URI.joinPath(docs, 'readme.md');
		const paths = [{ workspace: workspaceA, relativePath: 'docs' }];
		const committed = coordinator.reserveStructural(workspaceA, paths);
		await committed.finish(async () => undefined, [{ operation: FileOperation.DELETE, target: docs }]);
		const aborted = coordinator.reserveStructural(workspaceA, paths);
		await aborted.abort();

		assert.deepStrictEqual(baseHalfStructuralResourceOutcome(outcomes[0], workspaceA, 'docs/readme.md', readme), { kind: 'close' });
		assert.deepStrictEqual(baseHalfStructuralResourceOutcome(outcomes[1], workspaceA, 'docs/readme.md', readme), { kind: 'recreate' });
	});

	test('a composite resource intent is rejected when either endpoint identity changes', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const sourceStamp = coordinator.captureResource(workspaceA, 'source.md');
		const targetStamp = coordinator.captureResource(workspaceA, 'target.md');
		const reservation = coordinator.reserveStructural(workspaceA, [{ workspace: workspaceA, relativePath: 'target.md' }]);
		await reservation.finish(async () => undefined);

		let ran = false;
		await assert.rejects(coordinator.runResourceMutation(workspaceA, [sourceStamp, targetStamp], async () => { ran = true; }));
		assert.strictEqual(ran, false);
		await coordinator.runResourceMutation(workspaceA, sourceStamp, async () => { ran = true; });
		assert.strictEqual(ran, true);
	});

	test('resource mutation fence blocks retained intents without inventing a new identity', async () => {
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const stamp = coordinator.captureResource(workspaceA, 'docs/readme.md');
		const changes: string[] = [];
		coordinator.onDidChangeResourceMutationFence(path => changes.push(path.relativePath));
		const fence = coordinator.acquireResourceMutationFence(workspaceA, 'docs');

		assert.strictEqual(coordinator.isResourceMutationFenced(workspaceA, 'docs/readme.md'), true);
		assert.strictEqual(coordinator.isResourceStampCurrent(workspaceA, stamp), false);
		fence.dispose();
		assert.strictEqual(coordinator.isResourceMutationFenced(workspaceA, 'docs/readme.md'), false);
		assert.strictEqual(coordinator.isResourceStampCurrent(workspaceA, stamp), true);
		assert.deepStrictEqual(changes, ['docs', 'docs']);
	});
});

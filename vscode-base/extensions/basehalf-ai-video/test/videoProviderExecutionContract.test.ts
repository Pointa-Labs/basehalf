/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	VideoProviderExecutionFailure,
	createVideoExecutionAuthorizationGrant,
	createVideoExecutionFingerprint,
	normalizeVideoProviderTaskIntent,
	videoProviderPreparationFailureForIntent,
	videoProviderExecutionFailure,
	type VideoExecutionFingerprintInput
} from '../src/videoProviderExecutionContract.ts';

test('normalizes new, recover, and exact-Retry intents without granting legacy replacement authority', () => {
	assert.throws(() => normalizeVideoProviderTaskIntent(undefined), /explicit provider task intent or a legacy resume id/);
	assert.deepEqual(normalizeVideoProviderTaskIntent({ kind: 'new' }), { kind: 'new' });
	assert.deepEqual(normalizeVideoProviderTaskIntent(undefined, 'task-existing'), {
		kind: 'recover',
		providerRequestId: 'task-existing'
	});
	assert.deepEqual(normalizeVideoProviderTaskIntent({
		kind: 'recover',
		providerRequestId: 'task-recovery'
	}), {
		kind: 'recover',
		providerRequestId: 'task-recovery'
	});
	assert.deepEqual(normalizeVideoProviderTaskIntent({
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		providerRequestId: 'task-retry',
		replacementAuthorized: false
	}), {
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		providerRequestId: 'task-retry',
		replacementAuthorized: false
	});
	assert.throws(() => normalizeVideoProviderTaskIntent({ kind: 'new' }, 'task-existing'), /cannot combine/);
	assert.throws(() => normalizeVideoProviderTaskIntent({
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		replacementAuthorized: true
	}), /requires proof/);
});

test('allows id-less exact Retry only for persisted non-acceptance evidence and authorization', () => {
	const rejected = videoProviderExecutionFailure('submission-rejected', 'Rejected before acceptance.').evidence;
	assert.deepEqual(normalizeVideoProviderTaskIntent({
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		sourceFailure: rejected,
		replacementAuthorized: true
	}), {
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		sourceFailure: rejected,
		replacementAuthorized: true
	});
	assert.throws(() => normalizeVideoProviderTaskIntent({
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		sourceFailure: rejected,
		replacementAuthorized: false
	}), /without replacement authorization/);
	const ambiguous = videoProviderExecutionFailure('submission-ambiguous', 'Acceptance is unknown.').evidence;
	assert.throws(() => normalizeVideoProviderTaskIntent({
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		sourceFailure: ambiguous,
		replacementAuthorized: true
	}), /requires proof/);
});

test('classifies structured failures into conservative retry policies', () => {
	assert.deepEqual(videoProviderExecutionFailure('submission-rejected', 'Rejected.').evidence, {
		kind: 'submission-rejected',
		retry: 'fresh-submit'
	});
	assert.deepEqual(videoProviderExecutionFailure('submission-ambiguous', 'Unknown.').evidence, {
		kind: 'submission-ambiguous',
		retry: 'blocked'
	});
	assert.deepEqual(videoProviderExecutionFailure('poll-interrupted', 'Read failed.', {
		providerRequestId: 'task-durable'
	}).evidence, {
		kind: 'poll-interrupted',
		retry: 'resume-existing',
		providerRequestId: 'task-durable'
	});
	assert.deepEqual(videoProviderExecutionFailure('remote-failed', 'Remote failed.', {
		providerRequestId: 'task-terminal'
	}).evidence, {
		kind: 'remote-failed',
		retry: 'replace-after-terminal-proof',
		providerRequestId: 'task-terminal'
	});
	assert.deepEqual(videoProviderExecutionFailure('remote-id-uncommitted', 'Host write failed.', {
		uncommittedProviderRequestId: 'task-not-durable'
	}).evidence, {
		kind: 'remote-id-uncommitted',
		retry: 'blocked',
		uncommittedProviderRequestId: 'task-not-durable'
	});
	assert.throws(() => new VideoProviderExecutionFailure('Unsafe policy.', {
		kind: 'submission-ambiguous',
		retry: 'fresh-submit'
	}), /requires retry policy 'blocked'/);
});

test('keeps preparation failures bound to a durable recovery task', () => {
	assert.deepEqual(videoProviderPreparationFailureForIntent({ kind: 'new' }), {
		kind: 'preparation',
		retry: 'fresh-submit'
	});
	assert.deepEqual(videoProviderPreparationFailureForIntent({
		kind: 'recover',
		providerRequestId: 'task-durable'
	}), {
		kind: 'execution-ownership',
		retry: 'resume-existing',
		providerRequestId: 'task-durable'
	});
	assert.deepEqual(videoProviderPreparationFailureForIntent({
		kind: 'exact-retry',
		sourceAttemptId: 'attempt-source',
		providerRequestId: 'task-terminal',
		replacementAuthorized: true
	}), {
		kind: 'execution-ownership',
		retry: 'resume-existing',
		providerRequestId: 'task-terminal'
	});
});

test('creates deterministic fingerprints from canonical material and changes every material boundary', () => {
	const base = fingerprintInput();
	const reordered = fingerprintInput({
		settings: { durationSeconds: 5, generationMode: 'text-to-video' },
		inputs: [...base.inputs].reverse()
	});
	const fingerprint = createVideoExecutionFingerprint(base);
	assert.match(fingerprint, /^v1:[A-Za-z0-9_-]{43}$/);
	assert.equal(createVideoExecutionFingerprint(reordered), fingerprint);

	for (const changed of [
		fingerprintInput({ prompt: 'A different prompt' }),
		fingerprintInput({ method: 'first-frame-to-video' }),
		fingerprintInput({ settings: { generationMode: 'text-to-video', durationSeconds: 6 } }),
		fingerprintInput({ inputs: [{ ...base.inputs[0], revision: 'revision-2' }] }),
		fingerprintInput({ operation: { kind: 'exact-retry', sourceAttemptId: 'attempt-source', providerRequestId: 'task-1' } })
	]) {
		assert.notEqual(createVideoExecutionFingerprint(changed), fingerprint);
	}
});

test('rejects non-canonical fingerprint material', () => {
	assert.throws(() => createVideoExecutionFingerprint(fingerprintInput({ nodePath: '../outside.bhnode' })), /portable/);
	assert.throws(() => createVideoExecutionFingerprint(fingerprintInput({
		settings: { generationMode: 'text-to-video', invalid: Number.NaN }
	})), /finite scalar/);
	assert.throws(() => createVideoExecutionFingerprint(fingerprintInput({
		inputs: [
			{ slotId: 'first-frame', order: 0, sourceId: 'source-1', revision: 'revision-1' },
			{ slotId: 'last-frame', order: 0, sourceId: 'source-2', revision: 'revision-2' }
		]
	})), /unique input order/);
});

test('consumes one memory-only authorization only for its exact fingerprint and Attempt', () => {
	const fingerprint = createVideoExecutionFingerprint(fingerprintInput());
	const grant = createVideoExecutionAuthorizationGrant(fingerprint, 'attempt-1');
	assert.match(grant.authorizationId, /^[A-Za-z0-9_-]+$/);
	assert.equal(grant.state, 'available');
	assert.throws(() => grant.consume(fingerprint, 'attempt-other'), /does not match/);
	assert.equal(grant.state, 'available');
	grant.consume(fingerprint, 'attempt-1');
	assert.equal(grant.state, 'consumed');
	assert.throws(() => grant.consume(fingerprint, 'attempt-1'), /already consumed/);
	grant.invalidate();
	assert.equal(grant.state, 'consumed');

	const invalidated = createVideoExecutionAuthorizationGrant(fingerprint, 'attempt-2');
	invalidated.invalidate();
	assert.equal(invalidated.state, 'invalidated');
	assert.throws(() => invalidated.consume(fingerprint, 'attempt-2'), /no longer valid/);
});

function fingerprintInput(overrides: Partial<VideoExecutionFingerprintInput> = {}): VideoExecutionFingerprintInput {
	return {
		schemaVersion: 1,
		nodeId: 'node-1',
		nodePath: 'shots/clip.bhnode',
		recipeId: 'pointa.basehalf-ai-video.generate-video',
		catalogId: 'pointa.basehalf-ai-video.official-models',
		providerId: 'provider',
		deploymentId: 'deployment',
		region: 'global',
		modelId: 'reviewed-model',
		revision: '2026-08-16',
		method: 'text-to-video',
		settings: { generationMode: 'text-to-video', durationSeconds: 5 },
		prompt: 'A calm camera move',
		inputs: [{ slotId: 'reference', order: 2, sourceId: 'source-1', revision: 'revision-1' }],
		operation: { kind: 'generate' },
		...overrides
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'node:crypto';

const MAX_CONTRACT_TEXT_LENGTH = 4_096;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_SETTINGS = 128;
const MAX_INPUTS = 32;

export type VideoProviderExecutionFailureKind =
	| 'preparation'
	| 'submission-rejected'
	| 'submission-ambiguous'
	| 'remote-id-uncommitted'
	| 'poll-interrupted'
	| 'poll-window-exhausted'
	| 'remote-failed'
	| 'remote-cancelled'
	| 'protocol'
	| 'download'
	| 'artifact-invalid'
	| 'artifact-commit'
	| 'execution-ownership';

export type VideoProviderRetryPolicy =
	| 'fresh-submit'
	| 'resume-existing'
	| 'replace-after-terminal-proof'
	| 'blocked';

export interface VideoProviderExecutionFailureEvidence {
	readonly kind: VideoProviderExecutionFailureKind;
	readonly retry: VideoProviderRetryPolicy;
	/** A host-durable id that may be used by recovery. */
	readonly providerRequestId?: string;
	/** An accepted id that failed host acknowledgement and is not safe to resume. */
	readonly uncommittedProviderRequestId?: string;
}

export class VideoProviderExecutionFailure extends Error {
	readonly evidence: VideoProviderExecutionFailureEvidence;

	constructor(message: string, evidence: VideoProviderExecutionFailureEvidence) {
		super(sanitizedMessage(message));
		this.name = 'VideoProviderExecutionFailure';
		this.evidence = normalizeVideoProviderExecutionFailureEvidence(evidence);
	}
}

export type VideoProviderTaskIntent =
	| { readonly kind: 'new' }
	| {
		readonly kind: 'recover';
		readonly providerRequestId: string;
	}
	| {
		readonly kind: 'exact-retry';
		readonly sourceAttemptId: string;
		readonly providerRequestId?: string;
		readonly sourceFailure?: VideoProviderExecutionFailureEvidence;
		readonly replacementAuthorized: boolean;
	};

export interface VideoExecutionFingerprintInput {
	readonly schemaVersion: 1;
	readonly nodeId: string;
	readonly nodePath: string;
	readonly recipeId: string;
	readonly catalogId: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly modelId: string;
	readonly revision: string;
	readonly method: string;
	readonly settings: Readonly<Record<string, string | number | boolean>>;
	readonly prompt: string;
	readonly inputs: readonly {
		readonly slotId: string;
		readonly order: number;
		readonly sourceId: string;
		readonly revision: string;
	}[];
	readonly operation:
		| { readonly kind: 'generate' }
		| {
			readonly kind: 'exact-retry';
			readonly sourceAttemptId: string;
			readonly providerRequestId?: string;
		};
}

export interface VideoExecutionAuthorizationGrant {
	/** Memory-only random identity. It must not be persisted or logged. */
	readonly authorizationId: string;
	readonly state: 'available' | 'consumed' | 'invalidated';
	consume(fingerprint: string, attemptId: string): void;
	invalidate(): void;
}

export function normalizeVideoProviderTaskIntent(
	intent: VideoProviderTaskIntent | undefined,
	legacyResumeProviderRequestId?: string
): VideoProviderTaskIntent {
	if (intent !== undefined && legacyResumeProviderRequestId !== undefined) {
		throw contractError('Execution cannot combine an explicit provider task intent with a legacy resume id.');
	}
	if (intent === undefined) {
		if (legacyResumeProviderRequestId === undefined) {
			throw contractError('Execution requires an explicit provider task intent or a legacy resume id.');
		}
		// The legacy field cannot prove replacement authorization. Treat it as
		// recover-only so an older host can never trigger a second paid task.
		return Object.freeze({
			kind: 'recover',
			providerRequestId: providerRequestIdentifier(legacyResumeProviderRequestId, 'legacy provider request id')
		});
	}
	if (intent.kind === 'new') {
		return Object.freeze({ kind: 'new' });
	}
	if (intent.kind === 'recover') {
		return Object.freeze({
			kind: 'recover',
			providerRequestId: providerRequestIdentifier(intent.providerRequestId, 'recovery provider request id')
		});
	}

	const sourceAttemptId = opaqueIdentifier(intent.sourceAttemptId, 'source Attempt id');
	if (typeof intent.replacementAuthorized !== 'boolean') {
		throw contractError('Exact Retry requires an explicit replacement-authorization decision.');
	}
	const providerRequestId = intent.providerRequestId === undefined
		? undefined
		: providerRequestIdentifier(intent.providerRequestId, 'Retry provider request id');
	const sourceFailure = intent.sourceFailure === undefined
		? undefined
		: normalizeVideoProviderExecutionFailureEvidence(intent.sourceFailure);
	if (providerRequestId === undefined) {
		if (sourceFailure?.retry !== 'fresh-submit') {
			throw contractError('Exact Retry without a durable provider request id requires proof that the earlier submission was not accepted.');
		}
		if (!intent.replacementAuthorized) {
			throw contractError('Exact Retry cannot create a new provider task without replacement authorization.');
		}
	}
	return Object.freeze({
		kind: 'exact-retry',
		sourceAttemptId,
		...(providerRequestId === undefined ? {} : { providerRequestId }),
		...(sourceFailure === undefined ? {} : { sourceFailure }),
		replacementAuthorized: intent.replacementAuthorized
	});
}

export function videoProviderExecutionFailure(
	kind: VideoProviderExecutionFailureKind,
	message: string,
	options: {
		readonly providerRequestId?: string;
		readonly uncommittedProviderRequestId?: string;
	} = {}
): VideoProviderExecutionFailure {
	const providerRequestId = options.providerRequestId === undefined
		? undefined
		: providerRequestIdentifier(options.providerRequestId, 'durable provider request id');
	const uncommittedProviderRequestId = options.uncommittedProviderRequestId === undefined
		? undefined
		: providerRequestIdentifier(options.uncommittedProviderRequestId, 'uncommitted provider request id');
	return new VideoProviderExecutionFailure(message, {
		kind,
		retry: retryPolicyForFailure(kind, providerRequestId !== undefined),
		...(providerRequestId === undefined ? {} : { providerRequestId }),
		...(uncommittedProviderRequestId === undefined ? {} : { uncommittedProviderRequestId })
	});
}

/** Preparation cannot authorize a replacement when an existing durable task still owns the Attempt. */
export function videoProviderPreparationFailureForIntent(
	intent: VideoProviderTaskIntent
): VideoProviderExecutionFailureEvidence {
	const providerRequestId = intent.kind === 'recover'
		? intent.providerRequestId
		: intent.kind === 'exact-retry' ? intent.providerRequestId : undefined;
	return providerRequestId === undefined
		? normalizeVideoProviderExecutionFailureEvidence({ kind: 'preparation', retry: 'fresh-submit' })
		: normalizeVideoProviderExecutionFailureEvidence({
			kind: 'execution-ownership',
			retry: 'resume-existing',
			providerRequestId
		});
}

export function withVideoProviderExecutionFailureMessage(
	failure: VideoProviderExecutionFailure,
	message: string
): VideoProviderExecutionFailure {
	return new VideoProviderExecutionFailure(message, failure.evidence);
}

export function createVideoExecutionFingerprint(input: VideoExecutionFingerprintInput): string {
	if (input.schemaVersion !== 1) {
		throw contractError('Video execution fingerprint input must use schema version 1.');
	}
	const settingsEntries = Object.entries(input.settings);
	if (settingsEntries.length > MAX_SETTINGS) {
		throw contractError(`Video execution fingerprint cannot contain more than ${MAX_SETTINGS} settings.`);
	}
	const settings: Record<string, string | number | boolean> = {};
	for (const [key, rawValue] of settingsEntries.sort(([left], [right]) => left.localeCompare(right))) {
		const canonicalKey = settingIdentifier(key);
		if (typeof rawValue !== 'string' && typeof rawValue !== 'boolean'
			&& !(typeof rawValue === 'number' && Number.isFinite(rawValue))) {
			throw contractError(`Video execution setting '${canonicalKey}' is not a finite scalar.`);
		}
		settings[canonicalKey] = typeof rawValue === 'number' && Object.is(rawValue, -0) ? 0 : rawValue;
	}
	if (input.inputs.length > MAX_INPUTS) {
		throw contractError(`Video execution fingerprint cannot contain more than ${MAX_INPUTS} inputs.`);
	}
	const seenOrders = new Set<number>();
	const inputs = [...input.inputs]
		.map(item => {
			if (!Number.isSafeInteger(item.order) || item.order < 0 || item.order > 1_024 || seenOrders.has(item.order)) {
				throw contractError('Video execution fingerprint requires unique input order values from 0 to 1024.');
			}
			seenOrders.add(item.order);
			return Object.freeze({
				slotId: opaqueIdentifier(item.slotId, 'input slot id'),
				order: item.order,
				sourceId: opaqueIdentifier(item.sourceId, 'input source id'),
				revision: canonicalText(item.revision, 'input revision')
			});
		})
		.sort((left, right) => left.order - right.order);
	const operation = input.operation.kind === 'generate'
		? Object.freeze({ kind: 'generate' as const })
		: Object.freeze({
			kind: 'exact-retry' as const,
			sourceAttemptId: opaqueIdentifier(input.operation.sourceAttemptId, 'Retry source Attempt id'),
			...(input.operation.providerRequestId === undefined ? {} : {
				providerRequestId: providerRequestIdentifier(input.operation.providerRequestId, 'Retry provider request id')
			})
		});
	const material = {
		schemaVersion: 1,
		nodeId: opaqueIdentifier(input.nodeId, 'node id'),
		nodePath: portableNodePath(input.nodePath),
		recipeId: opaqueIdentifier(input.recipeId, 'Recipe id'),
		catalogId: opaqueIdentifier(input.catalogId, 'catalog id'),
		providerId: opaqueIdentifier(input.providerId, 'provider id'),
		deploymentId: opaqueIdentifier(input.deploymentId, 'deployment id'),
		region: opaqueIdentifier(input.region, 'region'),
		modelId: opaqueIdentifier(input.modelId, 'model id'),
		revision: canonicalText(input.revision, 'model revision'),
		method: opaqueIdentifier(input.method, 'generation method'),
		settings,
		promptSha256: sha256(input.prompt),
		inputs,
		operation
	};
	return `v1:${sha256(JSON.stringify(material))}`;
}

export function createVideoExecutionAuthorizationGrant(
	fingerprint: string,
	attemptId: string
): VideoExecutionAuthorizationGrant {
	const expectedFingerprint = executionFingerprint(fingerprint);
	const expectedAttemptId = opaqueIdentifier(attemptId, 'authorized Attempt id');
	const authorizationId = randomBytes(24).toString('base64url');
	let state: VideoExecutionAuthorizationGrant['state'] = 'available';
	return Object.freeze({
		authorizationId,
		get state() { return state; },
		consume(candidateFingerprint: string, candidateAttemptId: string): void {
			if (state !== 'available') {
				throw contractError(state === 'consumed'
					? 'Video execution authorization was already consumed.'
					: 'Video execution authorization is no longer valid.');
			}
			if (executionFingerprint(candidateFingerprint) !== expectedFingerprint
				|| opaqueIdentifier(candidateAttemptId, 'Attempt id') !== expectedAttemptId) {
				throw contractError('Video execution authorization does not match this request and Attempt.');
			}
			state = 'consumed';
		},
		invalidate(): void {
			if (state === 'available') {
				state = 'invalidated';
			}
		}
	});
}

function normalizeVideoProviderExecutionFailureEvidence(
	evidence: VideoProviderExecutionFailureEvidence
): VideoProviderExecutionFailureEvidence {
	if (!isFailureKind(evidence.kind) || !isRetryPolicy(evidence.retry)) {
		throw contractError('Video provider failure evidence is invalid.');
	}
	const providerRequestId = evidence.providerRequestId === undefined
		? undefined
		: providerRequestIdentifier(evidence.providerRequestId, 'failure provider request id');
	const uncommittedProviderRequestId = evidence.uncommittedProviderRequestId === undefined
		? undefined
		: providerRequestIdentifier(evidence.uncommittedProviderRequestId, 'failure uncommitted provider request id');
	if (providerRequestId !== undefined && uncommittedProviderRequestId !== undefined) {
		throw contractError('Failure evidence cannot treat one provider request id as both durable and uncommitted.');
	}
	const expectedRetry = retryPolicyForFailure(evidence.kind, providerRequestId !== undefined);
	if (evidence.retry !== expectedRetry) {
		throw contractError(`Failure '${evidence.kind}' requires retry policy '${expectedRetry}'.`);
	}
	if (evidence.kind === 'remote-id-uncommitted' && uncommittedProviderRequestId === undefined) {
		throw contractError('An uncommitted remote-id failure requires the uncommitted provider request id.');
	}
	if (evidence.kind !== 'remote-id-uncommitted' && uncommittedProviderRequestId !== undefined) {
		throw contractError(`Failure '${evidence.kind}' cannot contain an uncommitted provider request id.`);
	}
	return Object.freeze({
		kind: evidence.kind,
		retry: evidence.retry,
		...(providerRequestId === undefined ? {} : { providerRequestId }),
		...(uncommittedProviderRequestId === undefined ? {} : { uncommittedProviderRequestId })
	});
}

function retryPolicyForFailure(kind: VideoProviderExecutionFailureKind, hasDurableProviderRequestId: boolean): VideoProviderRetryPolicy {
	switch (kind) {
		case 'preparation':
		case 'submission-rejected':
			return 'fresh-submit';
		case 'submission-ambiguous':
		case 'remote-id-uncommitted':
			return 'blocked';
		case 'remote-failed':
		case 'remote-cancelled':
			return hasDurableProviderRequestId ? 'replace-after-terminal-proof' : 'blocked';
		case 'poll-interrupted':
		case 'poll-window-exhausted':
		case 'protocol':
		case 'download':
		case 'artifact-invalid':
		case 'artifact-commit':
		case 'execution-ownership':
			return hasDurableProviderRequestId ? 'resume-existing' : 'blocked';
	}
}

function isFailureKind(value: unknown): value is VideoProviderExecutionFailureKind {
	return value === 'preparation' || value === 'submission-rejected'
		|| value === 'submission-ambiguous' || value === 'remote-id-uncommitted'
		|| value === 'poll-interrupted' || value === 'poll-window-exhausted'
		|| value === 'remote-failed' || value === 'remote-cancelled'
		|| value === 'protocol' || value === 'download'
		|| value === 'artifact-invalid' || value === 'artifact-commit'
		|| value === 'execution-ownership';
}

function isRetryPolicy(value: unknown): value is VideoProviderRetryPolicy {
	return value === 'fresh-submit' || value === 'resume-existing'
		|| value === 'replace-after-terminal-proof' || value === 'blocked';
}

function executionFingerprint(value: string): string {
	if (!/^v1:[A-Za-z0-9_-]{43}$/.test(value)) {
		throw contractError('Video execution fingerprint is invalid.');
	}
	return value;
}

function settingIdentifier(value: string): string {
	if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value)) {
		throw contractError(`Video execution setting id '${value.slice(0, 64)}' is invalid.`);
	}
	return value;
}

function providerRequestIdentifier(value: string, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > MAX_IDENTIFIER_LENGTH
		|| !/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/.test(value)) {
		throw contractError(`The ${label} is invalid.`);
	}
	return value;
}

function opaqueIdentifier(value: string, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > MAX_IDENTIFIER_LENGTH
		|| /[\u0000-\u001f\u007f]/.test(value)) {
		throw contractError(`The ${label} is invalid.`);
	}
	return value;
}

function portableNodePath(value: string): string {
	const path = canonicalText(value, 'node path');
	if (path.startsWith('/') || path.includes('\\')
		|| path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
		throw contractError('The node path must be portable and project-relative.');
	}
	return path;
}

function canonicalText(value: string, label: string): string {
	if (typeof value !== 'string' || value.length > MAX_CONTRACT_TEXT_LENGTH
		|| /[\u0000\r\n]/.test(value)) {
		throw contractError(`The ${label} is invalid.`);
	}
	return value;
}

function sanitizedMessage(value: string): string {
	const message = canonicalText(value, 'failure message').replace(/[\u0001-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
	return message || 'Video provider execution failed.';
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('base64url');
}

function contractError(message: string): Error {
	const error = new Error(message);
	error.name = 'VideoProviderExecutionContractError';
	return error;
}

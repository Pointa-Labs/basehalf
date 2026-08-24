/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { generateUuid } from '../../../base/common/uuid.js';
import type { IBaseHalfModelServiceAttemptSnapshot } from './basehalfModelServices.js';
import type { BaseHalfCanvasProviderTaskIntent } from './basehalfCanvasRecipes.js';
import type { IBaseHalfNodeAttemptInput, IBaseHalfNodeRecipe } from './basehalfNodeDocument.js';

export interface IBaseHalfProviderRequestFingerprintInput {
	readonly nodeId: string;
	readonly nodePath: string;
	readonly recipe: IBaseHalfNodeRecipe;
	readonly prompt: string;
	readonly model?: IBaseHalfModelServiceAttemptSnapshot;
	readonly inputs: readonly IBaseHalfNodeAttemptInput[];
	readonly intent: BaseHalfCanvasProviderTaskIntent;
}

export type BaseHalfProviderCreateAuthorizationKind = 'new' | 'replacement';
export type BaseHalfProviderCreateAuthorizationState = 'available' | 'consumed' | 'invalidated';

/**
 * Process-local authority for exactly one provider create transport.
 *
 * The random id is diagnostic identity only. Callers must never persist or log
 * it, and possession of the id cannot substitute for consuming this object.
 */
export interface IBaseHalfProviderCreateAuthorizationGrant {
	readonly authorizationId: string;
	readonly state: BaseHalfProviderCreateAuthorizationState;
	consume(requestFingerprint: string, attemptId: string, kind: BaseHalfProviderCreateAuthorizationKind): void;
	invalidate(): void;
}

/** Creates the provider-neutral fingerprint disclosed before one paid run. */
export async function createBaseHalfProviderRequestFingerprint(
	input: IBaseHalfProviderRequestFingerprintInput
): Promise<string> {
	const material = canonicalFingerprintValue({
		schemaVersion: 1,
		nodeId: input.nodeId,
		nodePath: input.nodePath,
		recipe: input.recipe,
		promptSha256: await sha256Text(input.prompt),
		model: input.model ?? null,
		inputs: input.inputs,
		operation: input.intent.kind === 'new'
			? { kind: 'generate' }
			: input.intent.kind === 'recover'
				? { kind: 'recover', providerRequestId: input.intent.providerRequestId }
				: {
					kind: 'exact-retry',
					sourceAttemptId: input.intent.sourceAttemptId,
					providerRequestId: input.intent.providerRequestId ?? null
				}
	});
	return `v1:${await sha256Text(JSON.stringify(material))}`;
}

/** Creates one memory-only grant bound to the final fingerprint and Attempt. */
export function createBaseHalfProviderCreateAuthorizationGrant(
	requestFingerprint: string,
	attemptId: string,
	kind: BaseHalfProviderCreateAuthorizationKind
): IBaseHalfProviderCreateAuthorizationGrant {
	const expectedFingerprint = providerRequestFingerprint(requestFingerprint);
	const expectedAttemptId = boundedOpaqueId(attemptId, 'Attempt id');
	if (kind !== 'new' && kind !== 'replacement') {
		throw new Error('The provider create authorization kind is invalid.');
	}
	let state: BaseHalfProviderCreateAuthorizationState = 'available';
	return Object.freeze({
		authorizationId: generateUuid(),
		get state() { return state; },
		consume(candidateFingerprint: string, candidateAttemptId: string, candidateKind: BaseHalfProviderCreateAuthorizationKind): void {
			if (state !== 'available') {
				throw new Error(state === 'consumed'
					? 'The provider create authorization has already been consumed.'
					: 'The provider create authorization is no longer active.');
			}
			if (providerRequestFingerprint(candidateFingerprint) !== expectedFingerprint
				|| boundedOpaqueId(candidateAttemptId, 'Attempt id') !== expectedAttemptId
				|| candidateKind !== kind) {
				throw new Error('The provider create authorization does not match this immutable Attempt.');
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

function canonicalFingerprintValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalFingerprintValue);
	}
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value as Readonly<Record<string, unknown>>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonicalFingerprintValue(item)]));
	}
	if (typeof value === 'number' && Object.is(value, -0)) {
		return 0;
	}
	return value;
}

function providerRequestFingerprint(value: string): string {
	if (!/^v1:[A-Za-z0-9_-]{43}$/.test(value)) {
		throw new Error('The provider request fingerprint is invalid.');
	}
	return value;
}

function boundedOpaqueId(value: string, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
		throw new Error(`The ${label} is invalid.`);
	}
	return value;
}

async function sha256Text(value: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true);
}

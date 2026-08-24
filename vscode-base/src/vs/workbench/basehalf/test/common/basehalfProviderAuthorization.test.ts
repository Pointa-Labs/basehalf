/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	IBaseHalfProviderRequestFingerprintInput,
	createBaseHalfProviderCreateAuthorizationGrant,
	createBaseHalfProviderRequestFingerprint
} from '../../common/basehalfProviderAuthorization.js';

suite('BaseHalf node execution authorization', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('fingerprints canonical material and changes every paid request boundary', async () => {
		const base = fingerprintInput();
		const fingerprint = await createBaseHalfProviderRequestFingerprint(base);
		assert.match(fingerprint, /^v1:[A-Za-z0-9_-]{43}$/);
		assert.strictEqual(await createBaseHalfProviderRequestFingerprint(fingerprintInput({
			recipe: {
				...base.recipe,
				parameters: {
					durationSeconds: 5,
					generationMode: 'text-to-video',
					videoModelSnapshot: base.recipe.parameters.videoModelSnapshot
				}
			},
			inputs: [...base.inputs]
		})), fingerprint);

		const changes: IBaseHalfProviderRequestFingerprintInput[] = [
			fingerprintInput({ nodeId: 'node-other' }),
			fingerprintInput({ nodePath: 'shots/other.bhnode' }),
			fingerprintInput({ recipe: { ...base.recipe, recipeId: 'test.video.other' } }),
			fingerprintInput({ recipe: recipeWithSnapshot(base, { catalogId: 'test.video.catalog.other' }) }),
			fingerprintInput({ recipe: recipeWithSnapshot(base, { providerId: 'provider-other' }) }),
			fingerprintInput({ recipe: recipeWithSnapshot(base, { deploymentId: 'deployment-other' }) }),
			fingerprintInput({ recipe: recipeWithSnapshot(base, { region: 'region-other' }) }),
			fingerprintInput({ recipe: recipeWithSnapshot(base, { modelId: 'model-other' }) }),
			fingerprintInput({ recipe: recipeWithSnapshot(base, { revision: 'revision-other' }) }),
			fingerprintInput({ recipe: recipeWithSnapshot(base, { mode: 'first-frame-to-video' }) }),
			fingerprintInput({ recipe: { ...base.recipe, parameters: { ...base.recipe.parameters, durationSeconds: 6 } } }),
			fingerprintInput({ model: {
				serviceId: 'service-1',
				serviceLabel: 'Service',
				connectionIdentity: `sha256:${'B'.repeat(43)}`,
				capability: 'video',
				modelId: 'model-1'
			} }),
			fingerprintInput({ prompt: 'A different frozen prompt' }),
			fingerprintInput({ inputs: [{ ...base.inputs[0], slot: 'last-frame' }] }),
			fingerprintInput({ inputs: [{ ...base.inputs[0], sourcePath: 'assets/other.png' }] }),
			fingerprintInput({ inputs: [{ ...base.inputs[0], revision: 'revision-other' }] }),
			fingerprintInput({ intent: {
				kind: 'exact-retry',
				sourceAttemptId: 'attempt-source',
				providerRequestId: 'provider-task',
				replacementAuthorized: false
			} })
		];
		for (const changed of changes) {
			assert.notStrictEqual(await createBaseHalfProviderRequestFingerprint(changed), fingerprint);
		}
		const orderedInputs = [
			base.inputs[0],
			{ sourcePath: 'assets/last.png', slot: 'last-frame', order: 1, revision: 'revision-2' }
		];
		assert.notStrictEqual(
			await createBaseHalfProviderRequestFingerprint(fingerprintInput({ inputs: orderedInputs })),
			await createBaseHalfProviderRequestFingerprint(fingerprintInput({ inputs: [...orderedInputs].reverse() }))
		);

		const retry = fingerprintInput({ intent: {
			kind: 'exact-retry',
			sourceAttemptId: 'attempt-source',
			providerRequestId: 'provider-task',
			replacementAuthorized: false
		} });
		assert.strictEqual(
			await createBaseHalfProviderRequestFingerprint(retry),
			await createBaseHalfProviderRequestFingerprint({
				...retry,
				intent: {
					kind: 'exact-retry',
					sourceAttemptId: 'attempt-source',
					providerRequestId: 'provider-task',
					replacementAuthorized: true
				}
			})
		);
	});

	test('consumes and invalidates one process-local provider create grant', async () => {
		const fingerprint = await createBaseHalfProviderRequestFingerprint(fingerprintInput());
		const grant = createBaseHalfProviderCreateAuthorizationGrant(fingerprint, 'attempt-1', 'new');
		const independent = createBaseHalfProviderCreateAuthorizationGrant(fingerprint, 'attempt-1', 'new');
		assert.notStrictEqual(grant.authorizationId, independent.authorizationId);
		assert.strictEqual(grant.state, 'available');
		assert.throws(() => grant.consume(`v1:${'A'.repeat(43)}`, 'attempt-1', 'new'), /does not match/);
		assert.throws(() => grant.consume(fingerprint, 'attempt-other', 'new'), /does not match/);
		assert.throws(() => grant.consume(fingerprint, 'attempt-1', 'replacement'), /does not match/);
		assert.strictEqual(grant.state, 'available');
		grant.consume(fingerprint, 'attempt-1', 'new');
		assert.strictEqual(grant.state, 'consumed');
		assert.throws(() => grant.consume(fingerprint, 'attempt-1', 'new'), /already been consumed/);

		independent.invalidate();
		assert.strictEqual(independent.state, 'invalidated');
		assert.throws(() => independent.consume(fingerprint, 'attempt-1', 'new'), /no longer active/);
	});
});

function fingerprintInput(
	overrides: Partial<IBaseHalfProviderRequestFingerprintInput> = {}
): IBaseHalfProviderRequestFingerprintInput {
	const recipe = {
		recipeId: 'test.video.generate',
		modelServiceId: 'service-1',
		modelId: 'model-1',
		parameters: {
			videoModelSnapshot: {
				catalogId: 'test.video.catalog',
				providerId: 'provider',
				deploymentId: 'deployment',
				region: 'global',
				modelId: 'model-1',
				revision: '2026-08-24',
				mode: 'text-to-video'
			},
			generationMode: 'text-to-video',
			durationSeconds: 5
		},
		inputBindings: [{ sourcePath: 'assets/reference.png', slot: 'reference', order: 0 }]
	} as const;
	return {
		nodeId: 'node-1',
		nodePath: 'shots/clip.bhnode',
		recipe,
		prompt: 'A calm frozen prompt',
		model: {
			serviceId: 'service-1',
			serviceLabel: 'Service',
			connectionIdentity: `sha256:${'A'.repeat(43)}`,
			capability: 'video',
			modelId: 'model-1'
		},
		inputs: [{
			sourcePath: 'assets/reference.png',
			slot: 'reference',
			order: 0,
			revision: 'revision-1'
		}],
		intent: { kind: 'new' },
		...overrides
	};
}

function recipeWithSnapshot(
	base: IBaseHalfProviderRequestFingerprintInput,
	changes: Readonly<Record<string, string>>
): IBaseHalfProviderRequestFingerprintInput['recipe'] {
	return {
		...base.recipe,
		parameters: {
			...base.recipe.parameters,
			videoModelSnapshot: {
				...(base.recipe.parameters.videoModelSnapshot as Readonly<Record<string, string>>),
				...changes
			}
		}
	};
}

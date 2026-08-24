/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID,
	BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID,
	BaseHalfVideoModelResolution,
	BaseHalfVideoModelContractError,
	baseHalfVideoModelMatchesServiceScope,
	createBaseHalfVideoModelRegistry,
	createBaseHalfVideoModelSelectionSnapshot,
	getBaseHalfVideoPromptMaxCharacters,
	getBaseHalfVideoPromptProblem,
	IBaseHalfSupportedVideoModelResolution,
	normalizeBaseHalfVideoSettings,
	parseBaseHalfVideoModelCatalog,
	parseBaseHalfVideoModelSelection,
	parseBaseHalfVideoModelSelectionSnapshot,
	resolveBaseHalfVideoModelSelectionSnapshot
} from '../../common/basehalfVideoModels.js';

suite('BaseHalfVideoModels', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('strictly validates and deep-freezes versioned provider catalogs', () => {
		const parsed = parseBaseHalfVideoModelCatalog(catalog());

		assert.strictEqual(parsed.schemaVersion, 1);
		assert.strictEqual(parsed.models[0].key.modelId, 'seedance-1.5-pro');
		assert.strictEqual(parsed.models[0].source.verifiedAt, '2026-08-16');
		assert.strictEqual(Object.isFrozen(parsed), true);
		assert.strictEqual(Object.isFrozen(parsed.models), true);
		assert.strictEqual(Object.isFrozen(parsed.models[0].modes[0].parameters[0]), true);
		assert.strictEqual(Object.isFrozen(parsed.models[0].modes[0].constraints), true);
	});

	test('fails closed on unknown fields, duplicate exact keys, and dangling conditions', () => {
		assert.throws(() => parseBaseHalfVideoModelCatalog({ ...catalog(), undocumented: true }), BaseHalfVideoModelContractError);
		assert.throws(() => parseBaseHalfVideoModelCatalog({
			...catalog(),
			models: [{
				...catalog().models[0],
				key: { ...catalog().models[0].key, provider: 'BytePlus' }
			}]
		}), /canonical lowercase provider or deployment identifier/);
		assert.throws(() => parseBaseHalfVideoModelCatalog({
			...catalog(),
			models: [catalog().models[0], catalog().models[0]]
		}), /duplicate exact model key/);
		assert.throws(() => parseBaseHalfVideoModelCatalog(withMode({
			...mode(),
			parameters: [{
				...mode().parameters[0],
				visibleWhen: { kind: 'parameter', parameterId: 'missing', operator: 'equals', value: 'x' }
			}, ...mode().parameters.slice(1)]
		})), /unknown parameter 'missing'/);
		assert.throws(() => parseBaseHalfVideoModelCatalog(withMode({
			...mode(),
			constraints: [{
				id: 'badRange',
				targetParameterId: 'duration',
				allowed: { kind: 'range', minimum: 1, maximum: 10 },
				reason: 'Wrong kind.'
			}]
		})), /must narrow the target range/);
		assert.throws(() => parseBaseHalfVideoModelCatalog(withMode({
			...mode(),
			inputs: [{ kind: 'text-prompt', minItems: 1, maxItems: 1 }]
		})), /maxCharacters/);
		assert.throws(() => parseBaseHalfVideoModelCatalog(withMode({
			...mode(),
			inputs: [{ kind: 'first-frame', minItems: 1, maxItems: 1, maxCharacters: 100 }]
		})), /only for text-prompt/);
	});

	test('validates prompt length from the resolved generation mode', () => {
		const resolution = supportedResolution();
		assert.strictEqual(getBaseHalfVideoPromptMaxCharacters(resolution), 16_000);
		assert.strictEqual(getBaseHalfVideoPromptProblem(resolution, 'x'.repeat(16_000)), undefined);
		assert.match(getBaseHalfVideoPromptProblem(resolution, 'x'.repeat(16_001)) ?? '', /16,000 characters or fewer/);
		assert.match(getBaseHalfVideoPromptProblem(resolution, '   ') ?? '', /Write a prompt/);
	});

	test('matches provider, deployment, region, exact model revision, mode, and current inputs', () => {
		const registry = createBaseHalfVideoModelRegistry(catalog());
		const selected = registry.resolve(selection());
		assert.strictEqual(selected.status, 'supported');
		assert.strictEqual(Object.isFrozen(selected), true);
		assert.strictEqual(Object.isFrozen(registry.models), true);

		assert.deepStrictEqual(registry.resolve({ ...selection(), revision: '2026-08-01' }), {
			status: 'unsupported',
			reason: 'No reviewed capability matches byteplus/global/ap-southeast-1/seedance-1.5-pro@2026-08-01.'
		});
		assert.match(resolutionReason(registry.resolve({ ...selection(), mode: 'video-edit' })), /does not support mode/);
		assert.match(resolutionReason(registry.resolve({ ...selection(), inputs: {} })), /text-prompt.*between 1 and 1/);
		assert.match(resolutionReason(registry.resolve({ ...selection(), inputs: { 'text-prompt': 1, audio: 1 } })), /does not support input 'audio'/);
	});

	test('distinguishes reviewed-but-unavailable capabilities from unsupported ones', () => {
		const unavailableCatalog = catalog();
		unavailableCatalog.models[0] = {
			...unavailableCatalog.models[0],
			availability: { status: 'unavailable', reason: 'This deployment is in scheduled maintenance.' }
		};
		const resolution = createBaseHalfVideoModelRegistry(unavailableCatalog).resolve(selection());

		if (resolution.status !== 'unavailable') {
			assert.fail(`Expected unavailable resolution, received '${resolution.status}'.`);
		}
		assert.strictEqual(resolution.reason, 'This deployment is in scheduled maintenance.');
		assert.strictEqual(resolution.descriptor.label, 'Seedance 1.5 Pro');
	});

	test('round-trips a strict host-owned selection snapshot for execution revalidation', () => {
		const registry = createBaseHalfVideoModelRegistry(catalog());
		const supported = supportedResolution();
		const catalogId = 'pointa.basehalf-ai-video.official-models';
		const snapshot = createBaseHalfVideoModelSelectionSnapshot(catalogId, supported);
		const scope = { providerId: 'byteplus', deploymentId: 'global', region: 'ap-southeast-1' };

		assert.deepStrictEqual(snapshot, {
			schemaVersion: 1,
			catalogId,
			providerId: 'byteplus',
			deploymentId: 'global',
			region: 'ap-southeast-1',
			modelId: 'seedance-1.5-pro',
			revision: '2026-08-16',
			mode: 'text-to-video',
			inputs: { 'text-prompt': 1 }
		});
		assert.strictEqual(Object.isFrozen(snapshot), true);
		assert.strictEqual(Object.isFrozen(snapshot.inputs), true);
		assert.deepStrictEqual(parseBaseHalfVideoModelSelectionSnapshot(snapshot, catalogId), snapshot);
		assert.strictEqual(baseHalfVideoModelMatchesServiceScope(supported.descriptor, scope), true);
		assert.strictEqual(baseHalfVideoModelMatchesServiceScope(supported.descriptor, { ...scope, providerId: 'BytePlus' }), false);
		assert.strictEqual(resolveBaseHalfVideoModelSelectionSnapshot(registry, catalogId, scope, snapshot).status, 'supported');
		assert.throws(() => parseBaseHalfVideoModelSelectionSnapshot({ ...snapshot, region: 'AP-Southeast-1' }, catalogId), /canonical lowercase region identifier/);
		assert.strictEqual(BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID, 'videoModelSnapshot');
	});

	test('fails persisted execution selections closed on dirty data, stale revisions, or changed service scope', () => {
		const registry = createBaseHalfVideoModelRegistry(catalog());
		const catalogId = 'pointa.basehalf-ai-video.official-models';
		const snapshot = createBaseHalfVideoModelSelectionSnapshot(catalogId, supportedResolution());
		const scope = { providerId: 'byteplus', deploymentId: 'global', region: 'ap-southeast-1' };

		assert.throws(() => parseBaseHalfVideoModelSelection({ ...selection(), hiddenFallback: true }), /not part of the video model contract/);
		assert.throws(() => parseBaseHalfVideoModelSelectionSnapshot({ ...snapshot, inputs: { 'text-prompt': 1, unknown: 1 } }, catalogId), /not a supported video input kind/);
		assert.throws(() => parseBaseHalfVideoModelSelectionSnapshot(snapshot, 'other.video.models'), /must match expected catalog/);
		assert.throws(() => createBaseHalfVideoModelSelectionSnapshot('not-a-complete-id', supportedResolution()), /complete contribution identifier/);
		assert.match(resolutionReason(resolveBaseHalfVideoModelSelectionSnapshot(registry, 'other.video.models', scope, snapshot)), /must match expected catalog/);
		assert.match(resolutionReason(resolveBaseHalfVideoModelSelectionSnapshot(registry, catalogId, { ...scope, region: 'cn-beijing' }, snapshot)), /does not match the configured service scope/);
		assert.match(resolutionReason(resolveBaseHalfVideoModelSelectionSnapshot(registry, catalogId, scope, { ...snapshot, revision: '2026-08-01' })), /No reviewed capability matches/);
		assert.match(resolutionReason(resolveBaseHalfVideoModelSelectionSnapshot(registry, catalogId, scope, { ...snapshot, schemaVersion: 2 })), /schemaVersion must be 1/);
	});

	test('preserves compatible values and deterministically repairs dependent combinations', () => {
		const resolution = supportedResolution();
		const normalized = normalizeBaseHalfVideoSettings(resolution, {
			generationMode: 'video-edit',
			resolution: '1080P',
			duration: 10,
			generateAudio: true,
			unknownLegacyValue: 'remove-me'
		});

		assert.strictEqual(normalized.status, 'ready');
		assert.deepStrictEqual(normalized.values, {
			generationMode: 'text-to-video',
			resolution: '1080P',
			duration: 5,
			generateAudio: true,
			draft: false
		});
		assert.strictEqual(normalized.adjustments.some(change => change.parameterId === 'duration' && change.kind === 'constrained'), true);
		assert.strictEqual(normalized.adjustments.some(change => change.parameterId === 'unknownLegacyValue' && change.kind === 'removed'), true);
		assert.strictEqual(normalized.adjustments.some(change => change.parameterId === BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID && change.value === 'text-to-video'), true);
		assert.strictEqual(Object.isFrozen(normalized.values), true);
		assert.strictEqual(Object.isFrozen(normalized.parameters), true);
		assert.strictEqual(Object.isFrozen(normalized.parameters[0].options), true);
	});

	test('keeps unavailable enum options visible but never emits them', () => {
		const normalized = normalizeBaseHalfVideoSettings(supportedResolution(), {
			resolution: '4K',
			duration: 5,
			generateAudio: true,
			draft: false
		});

		assert.strictEqual(normalized.status, 'ready');
		assert.strictEqual(normalized.values.resolution, '720P');
		const resolutionState = normalized.parameters.find(parameter => parameter.id === 'resolution')!;
		assert.deepStrictEqual(resolutionState.options?.find(option => option.value === '4K'), {
			value: '4K',
			label: '4K',
			enabled: false,
			unavailableReason: '4K is not enabled for this account.'
		});
	});

	test('omits context-disabled settings and exposes a reason from the same state', () => {
		const normalized = normalizeBaseHalfVideoSettings(supportedResolution(), {
			resolution: '720P',
			duration: 5,
			generateAudio: true,
			draft: true
		});

		assert.strictEqual(normalized.status, 'ready');
		assert.strictEqual(Object.hasOwn(normalized.values, 'generateAudio'), false);
		assert.deepStrictEqual(normalized.parameters.find(parameter => parameter.id === 'generateAudio'), {
			id: 'generateAudio',
			label: 'Generate audio',
			type: 'boolean',
			visible: true,
			enabled: false,
			unavailableReason: 'Audio is disabled while draft mode is on.'
		});
		assert.strictEqual(normalized.values.resolution, '480P');
	});

	test('fails normalization closed when active constraints have no legal intersection', () => {
		const impossible = withMode({
			...mode(),
			constraints: [
				...mode().constraints,
				{
					id: 'conflictingDuration',
					targetParameterId: 'duration',
					when: { kind: 'parameter', parameterId: 'resolution', operator: 'equals', value: '1080P' },
					allowed: { kind: 'values', values: [10] },
					reason: 'This rollout only allows ten seconds.'
				}
			]
		});
		const resolved = createBaseHalfVideoModelRegistry(impossible).resolve(selection());
		assert.strictEqual(resolved.status, 'supported');
		const normalized = normalizeBaseHalfVideoSettings(resolved as IBaseHalfSupportedVideoModelResolution, {
			resolution: '1080P',
			duration: 10,
			generateAudio: false,
			draft: false
		});

		assert.strictEqual(normalized.status, 'unavailable');
		assert.match(normalized.reason, /duration:.*1080P only supports five seconds.*ten seconds/);
	});

	function supportedResolution(): IBaseHalfSupportedVideoModelResolution {
		const resolution = createBaseHalfVideoModelRegistry(catalog()).resolve(selection());
		assert.strictEqual(resolution.status, 'supported');
		return resolution as IBaseHalfSupportedVideoModelResolution;
	}
});

function selection() {
	return {
		provider: 'byteplus',
		deployment: 'global',
		region: 'ap-southeast-1',
		modelId: 'seedance-1.5-pro',
		revision: '2026-08-16',
		mode: 'text-to-video' as const,
		inputs: { 'text-prompt': 1 }
	};
}

function resolutionReason(resolution: BaseHalfVideoModelResolution): string {
	if (resolution.status === 'supported') {
		assert.fail('Expected an unsupported or unavailable resolution.');
	}
	return resolution.reason;
}

function catalog(): any {
	return {
		schemaVersion: 1,
		models: [{
			key: {
				provider: 'byteplus',
				deployment: 'global',
				region: 'ap-southeast-1',
				modelId: 'seedance-1.5-pro',
				revision: '2026-08-16'
			},
			label: 'Seedance 1.5 Pro',
			source: {
				url: 'https://docs.byteplus.com/en/docs/modelark/video-generation-api',
				verifiedAt: '2026-08-16'
			},
			modes: [mode()]
		}]
	};
}

function withMode(replacement: any): any {
	const value = catalog();
	value.models[0].modes = [replacement];
	return value;
}

function mode(): any {
	return {
		mode: 'text-to-video',
		inputs: [{ kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 16_000 }],
		parameters: [
			{
				id: 'resolution',
				label: 'Resolution',
				type: 'enum',
				default: '720P',
				options: [
					{ value: '480P', label: '480P' },
					{ value: '720P', label: '720P' },
					{ value: '1080P', label: '1080P' },
					{ value: '4K', label: '4K', availability: { status: 'unavailable', reason: '4K is not enabled for this account.' } }
				]
			},
			{
				id: 'duration',
				label: 'Duration',
				type: 'enum',
				default: 5,
				options: [{ value: 5, label: '5s' }, { value: 10, label: '10s' }]
			},
			{
				id: 'generateAudio',
				label: 'Generate audio',
				type: 'boolean',
				default: true,
				enabledWhen: {
					condition: { kind: 'parameter', parameterId: 'draft', operator: 'equals', value: false },
					reason: 'Audio is disabled while draft mode is on.'
				}
			},
			{
				id: 'draft',
				label: 'Draft',
				type: 'boolean',
				default: false
			}
		],
		constraints: [
			{
				id: 'fullHdDuration',
				targetParameterId: 'duration',
				when: { kind: 'parameter', parameterId: 'resolution', operator: 'equals', value: '1080P' },
				allowed: { kind: 'values', values: [5] },
				reason: '1080P only supports five seconds.'
			},
			{
				id: 'draftResolution',
				targetParameterId: 'resolution',
				when: { kind: 'parameter', parameterId: 'draft', operator: 'equals', value: true },
				allowed: { kind: 'values', values: ['480P'] },
				reason: 'Draft mode requires 480P.'
			}
		]
	};
}

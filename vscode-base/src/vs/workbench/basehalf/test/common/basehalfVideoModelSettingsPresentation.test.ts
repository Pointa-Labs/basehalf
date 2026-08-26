/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	createBaseHalfVideoModelRegistry,
	evaluateBaseHalfVideoInputs,
	IBaseHalfSupportedVideoCapabilityResolution,
	IBaseHalfVideoModelDescriptor,
	normalizeBaseHalfVideoSettingsForCapability
} from '../../common/basehalfVideoModels.js';
import {
	baseHalfVideoModelChoiceLogicalKey,
	createBaseHalfVideoModelPickerPresentation,
	createBaseHalfVideoModelSettingsPresentation,
	createBaseHalfVideoMessagePrecedencePresentation,
	IBaseHalfVideoModelChoice,
	IBaseHalfVideoModelPresentationEntry,
	mergeBaseHalfVideoSettingAdjustments,
	reconcileBaseHalfVideoGenerationMethodSettings,
	reconcileBaseHalfVideoModelSettings,
	resolveBaseHalfVideoModelPickerFocus
} from '../../common/basehalfVideoModelSettingsPresentation.js';

suite('BaseHalfVideoModelSettingsPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('projects availability independently from selection and input readiness', () => {
		const descriptors = descriptorsFrom(Array.from({ length: 5 }, (_, index) => model(`model-${index}`, `Model ${index}`)));
		const selectedChoice = choice(descriptors[0]);
		const entries: IBaseHalfVideoModelPresentationEntry[] = [
			entry(descriptors[0], 'configured'),
			entry(descriptors[1], 'configured'),
			entry(descriptors[2], 'missing'),
			entry(descriptors[3], 'configured', { status: 'unavailable', reason: 'Catalog rollout is unavailable.' }),
			entry(descriptors[4], 'needs-attention')
		];
		const presentation = createBaseHalfVideoModelPickerPresentation({ entries, selectedChoice });
		assert.deepStrictEqual(presentation.rows.map(row => row.availability), [
			'available', 'available', 'connection-required', 'unavailable', 'connection-required'
		]);
		assert.deepStrictEqual(presentation.rows.map(row => row.action), ['none', 'select', 'connect', 'none', 'connect']);
		assert.strictEqual(presentation.rows[0].selected, true);
		assert.strictEqual(presentation.rows[0].disabledReason, undefined);
		assert.strictEqual(presentation.rows[2].disabledReason, 'Connect this model before selecting it.');
		assert.strictEqual(presentation.rows[3].disabledReason, 'Catalog rollout is unavailable.');
		assert.strictEqual(presentation.rows[4].disabledReason, 'Reconnect this model before selecting it.');

		const selectedConnectionRequired = createBaseHalfVideoModelPickerPresentation({ entries, selectedChoice: choice(descriptors[4]) });
		assert.strictEqual(selectedConnectionRequired.rows[4].availability, 'connection-required');
		assert.strictEqual(selectedConnectionRequired.rows[4].action, 'connect');
		assert.strictEqual(selectedConnectionRequired.rows[4].disabledReason, 'Reconnect this model to continue.');
		assert.strictEqual(selectedConnectionRequired.rows[4].selected, true);
		assert.strictEqual(Object.isFrozen(selectedConnectionRequired.rows[4]), true);

		const missingSelected = createBaseHalfVideoModelPickerPresentation({ entries, selectedChoice: choice(descriptors[2]) });
		assert.strictEqual(missingSelected.rows[2].availability, 'connection-required');
		assert.strictEqual(missingSelected.rows[2].action, 'connect');
		assert.strictEqual(missingSelected.rows[2].disabledReason, 'Connect this model to continue.');
		assert.strictEqual(missingSelected.rows[2].selected, true);

		const selectedUnavailable = createBaseHalfVideoModelPickerPresentation({
			entries: [entries[3]],
			selectedChoice: choice(descriptors[3])
		});
		assert.strictEqual(selectedUnavailable.rows[0].availability, 'unavailable');
		assert.strictEqual(selectedUnavailable.rows[0].selected, true);
		assert.strictEqual(selectedUnavailable.rows[0].action, 'none');
	});

	test('projects a model without connection setup as unavailable rather than connectable', () => {
		const [descriptor] = descriptorsFrom([model('without-connection-setup', 'Without connection setup')]);
		const presentation = createBaseHalfVideoModelPickerPresentation({
			entries: [{
				...entry(descriptor, 'missing'),
				choice: { ...choice(descriptor), connectionSpecId: undefined }
			}]
		});
		assert.strictEqual(presentation.rows[0].availability, 'unavailable');
		assert.strictEqual(presentation.rows[0].action, 'none');
		assert.strictEqual(presentation.rows[0].disabledReason, 'No connection setup is available for this model.');
	});

	test('keeps a selected model actionable when its saved connection must be rebound', () => {
		const [descriptor] = descriptorsFrom([model('rebind-connection', 'Rebind connection')]);
		const selectedChoice = choice(descriptor);
		const presentation = createBaseHalfVideoModelPickerPresentation({
			entries: [entry(descriptor, 'rebind-required')],
			selectedChoice
		});
		assert.strictEqual(presentation.rows[0].selected, true);
		assert.strictEqual(presentation.rows[0].availability, 'available');
		assert.strictEqual(presentation.rows[0].action, 'select');
		assert.strictEqual(presentation.rows[0].disabledReason, undefined);
	});

	test('keeps long catalogs unfiltered and pins a missing exact selection as unavailable', () => {
		const descriptors = descriptorsFrom(Array.from({ length: 13 }, (_, index) => model(`model-${index}`, `Model ${index}`)));
		const presentation = createBaseHalfVideoModelPickerPresentation({
			entries: descriptors.map(descriptor => entry(descriptor, 'configured')),
			selectedChoice: choice(descriptors[0])
		});
		assert.strictEqual(presentation.showScopeHeadings, false);
		assert.strictEqual(presentation.rows.length, 13);
		assert.strictEqual(presentation.rows[12].typeaheadText, 'model 12');
		assert.strictEqual(presentation.pinnedUnavailableSelection, undefined);

		const secondScopeEntry = entry(descriptors[1], 'configured');
		const multipleScopes = createBaseHalfVideoModelPickerPresentation({
			entries: [entry(descriptors[0], 'configured'), {
				...secondScopeEntry,
				choice: { ...secondScopeEntry.choice, connectionSpecId: 'pointa.test.secondary-provider' }
			}]
		});
		assert.strictEqual(multipleScopes.showScopeHeadings, true);

		const staleChoice = { ...choice(descriptors[0]), revision: 'older-review' };
		const stale = createBaseHalfVideoModelPickerPresentation({
			entries: descriptors.slice(0, 12).map(descriptor => entry(descriptor, 'configured')),
			selectedChoice: staleChoice,
			staleSelection: { choice: staleChoice, label: 'Older reviewed model', reason: 'This model is no longer available. Choose another model.' }
		});
		assert.strictEqual(stale.rows.length, 12);
		assert.strictEqual(stale.pinnedUnavailableSelection?.availability, 'unavailable');
		assert.strictEqual(stale.pinnedUnavailableSelection?.action, 'none');
		assert.strictEqual(stale.pinnedUnavailableSelection?.selected, true);
		assert.strictEqual(stale.pinnedUnavailableSelection?.disabledReason, 'This model is no longer available. Choose another model.');
	});

	test('preserves reviewed order, groups scopes, and disambiguates only duplicate labels', () => {
		const [first, second, third] = descriptorsFrom([
			model('first', 'Shared label'),
			model('second', 'Unique label'),
			model('third', 'Shared label')
		]);
		const secondScope = entry(third, 'configured');
		const presentation = createBaseHalfVideoModelPickerPresentation({
			entries: [entry(first, 'configured'), entry(second, 'configured'), {
				...secondScope,
				choice: { ...secondScope.choice, connectionSpecId: 'pointa.test.secondary' },
				deploymentLabel: 'Secondary'
			}]
		});
		assert.deepStrictEqual(presentation.rows.map(row => row.label), ['Shared label', 'Unique label', 'Shared label']);
		assert.strictEqual(presentation.showScopeHeadings, true);
		assert.strictEqual(presentation.rows[0].disambiguationLabel, 'Provider label · Global');
		assert.strictEqual(presentation.rows[1].disambiguationLabel, undefined);
		assert.strictEqual(presentation.rows[2].disambiguationLabel, 'Provider label · Secondary');
		assert.strictEqual(presentation.rows[0].typeaheadText, 'shared label provider label · global');
		assert.strictEqual(presentation.rows[1].typeaheadText, 'unique label');
		assert.strictEqual(presentation.rows[2].typeaheadText, 'shared label provider label · secondary');
		assert.strictEqual(presentation.rows.every(row => !!row.groupLabel), true);
	});

	test('uses the complete reviewed model identity for logical selection keys', () => {
		const [descriptor] = descriptorsFrom([model('identity', 'Identity')]);
		const exactChoice = choice(descriptor);
		const exactKey = baseHalfVideoModelChoiceLogicalKey(exactChoice);
		for (const changed of [
			{ ...exactChoice, recipeId: 'pointa.test.other-recipe' },
			{ ...exactChoice, catalogId: 'pointa.test.other-catalog' },
			{ ...exactChoice, providerId: 'other-provider' },
			{ ...exactChoice, deploymentId: 'other-deployment' },
			{ ...exactChoice, region: 'other-region' },
			{ ...exactChoice, modelId: 'other-model' },
			{ ...exactChoice, revision: 'other-revision' },
			{ ...exactChoice, connectionSpecId: 'pointa.test.other-connection' }
		]) {
			assert.notStrictEqual(baseHalfVideoModelChoiceLogicalKey(changed), exactKey);
		}
	});

	test('restores focus by logical key, then reviewed proximity, then the trigger', () => {
		const descriptors = descriptorsFrom(Array.from({ length: 4 }, (_, index) => model(`focus-${index}`, `Focus ${index}`)));
		const previous = createBaseHalfVideoModelPickerPresentation({
			entries: descriptors.map(descriptor => entry(descriptor, 'configured'))
		});
		const focusedKey = previous.rows[1].logicalKey;
		const exact = resolveBaseHalfVideoModelPickerFocus(previous.rows, previous.rows, focusedKey);
		assert.deepStrictEqual(exact, { kind: 'row', logicalKey: focusedKey });

		const unavailable = entry(descriptors[2], 'configured');
		const next = createBaseHalfVideoModelPickerPresentation({
			entries: [
				entry(descriptors[0], 'configured'),
				{ ...unavailable, descriptor: { ...unavailable.descriptor, availability: { status: 'unavailable', reason: 'Not reviewed.' } } },
				entry(descriptors[3], 'configured')
			]
		});
		assert.deepStrictEqual(resolveBaseHalfVideoModelPickerFocus(previous.rows, next.rows, focusedKey), {
			kind: 'row',
			logicalKey: next.rows[2].logicalKey
		});
		assert.deepStrictEqual(resolveBaseHalfVideoModelPickerFocus(previous.rows, [next.rows[1]], focusedKey), { kind: 'trigger' });
	});

	test('derives capability tokens only from executable reviewed modes', () => {
		const [descriptor] = descriptorsFrom([model('capabilities', 'Capability model', [
			mode('text-to-video', settingsParameters()),
			mode('first-frame-to-video', settingsParameters()),
			mode('first-last-frame-to-video', settingsParameters()),
			mode('reference-to-video', [{
				id: 'resolution', label: 'Resolution', type: 'enum', default: '8K',
				options: [{ value: '8K', label: '8K' }]
			}], { status: 'unavailable', reason: 'Transport is not reviewed.' })
		])]);
		const [row] = createBaseHalfVideoModelPickerPresentation({ entries: [entry(descriptor, 'configured')] }).rows;
		assert.deepStrictEqual(row.capabilityTokens.map(token => token.kind), [
			'method', 'method', 'method', 'resolution', 'duration', 'audio'
		]);
		assert.deepStrictEqual(row.capabilityTokens.filter(token => token.kind === 'method').map(token => token.label), [
			'Text to Video', 'Start Frame', 'Start + End Frames'
		]);
		assert.strictEqual(row.capabilityTokens.find(token => token.kind === 'resolution')?.label, 'Up to 1080p');
		assert.strictEqual(row.capabilityTokens.find(token => token.kind === 'duration')?.label, '1–15s');
		assert.strictEqual(row.capabilityTokens.some(token => token.label.includes('8K')), false);
		assert.strictEqual(row.typeaheadText, 'capability model');
	});

	test('chooses fixed, segmented, and listbox method presentations from executable methods', () => {
		const [zero, fixed, segmented, listbox] = descriptorsFrom([
			model('zero', 'Zero', [mode('text-to-video', [], { status: 'unavailable', reason: 'No reviewed transport.' })]),
			model('fixed', 'Fixed', [mode('text-to-video')]),
			model('segmented', 'Segmented', [mode('text-to-video'), mode('first-frame-to-video')]),
			model('listbox', 'Listbox', [
				mode('text-to-video'),
				mode('first-frame-to-video'),
				mode('first-last-frame-to-video'),
				mode('reference-to-video'),
				mode('video-edit')
			])
		]);
		assert.strictEqual(createBaseHalfVideoModelPickerPresentation({ entries: [entry(zero, 'configured')] }).rows[0].availability, 'unavailable');
		assert.strictEqual(settingsPresentation(fixed, 'text-to-video').methods.control, 'fixed');
		assert.strictEqual(settingsPresentation(segmented, 'first-frame-to-video').methods.control, 'segmented');
		assert.strictEqual(settingsPresentation(listbox, 'video-edit').methods.control, 'listbox');
	});

	test('keeps a declared unavailable method visible with its disabled reason', () => {
		const [descriptor] = descriptorsFrom([model('method-availability', 'Method availability', [
			mode('text-to-video'),
			mode('first-frame-to-video', [], { status: 'unavailable', reason: 'Frame transport is not available.' })
		])]);
		const presentation = settingsPresentation(descriptor, 'text-to-video');
		assert.deepStrictEqual(presentation.methods.options, [{
			mode: 'text-to-video', label: 'Text to Video', selected: true, enabled: true
		}, {
			mode: 'first-frame-to-video', label: 'Start Frame', selected: false, enabled: false,
			disabledReason: 'Frame transport is not available.'
		}]);
		assert.strictEqual(presentation.methods.control, 'segmented');
		assert.strictEqual(Object.isFrozen(presentation.methods.options[1]), true);
	});

	test('projects schema controls, canonical summary, disabled reasons, and adjustments', () => {
		const [descriptor] = descriptorsFrom([model('settings', 'Settings model', [mode('text-to-video', settingsParameters())])]);
		const resolution = capability(descriptor, 'text-to-video');
		const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, { 'text-prompt': 1 }, {
			aspectRatio: '16:9',
			resolution: '4K',
			durationSeconds: 12,
			qualityPreset: 'q1',
			strength: 8,
			generateAudio: false,
			shotType: 'multi',
			hiddenDetail: true,
			legacy: 'remove'
		});
		const presentation = createBaseHalfVideoModelSettingsPresentation(resolution, normalization);
		assert.deepStrictEqual(presentation.parameters.map(parameter => [parameter.parameterId, parameter.control]), [
			['aspectRatio', 'segmented'],
			['resolution', 'segmented'],
			['durationSeconds', 'segmented'],
			['qualityPreset', 'listbox'],
			['strength', 'range'],
			['generateAudio', 'boolean'],
			['shotType', 'segmented']
		]);
		assert.strictEqual(presentation.parameters.some(parameter => parameter.parameterId === 'hiddenDetail'), false);
		assert.strictEqual(presentation.parameters.find(parameter => parameter.parameterId === 'shotType')?.enabled, false);
		assert.strictEqual(presentation.parameters.find(parameter => parameter.parameterId === 'shotType')?.disabledReason, 'Shot type requires generated audio.');
		const resolutionParameter = presentation.parameters.find(parameter => parameter.parameterId === 'resolution');
		assert.deepStrictEqual(resolutionParameter?.options?.find(option => option.value === '4K'), {
			value: '4K', label: '4K', enabled: false, unavailableReason: 'Not available.'
		});
		assert.deepStrictEqual(presentation.settingsSummary.map(token => [token.kind, token.value]), [
			['method', 'Text to Video'],
			['aspect-ratio', '16:9'],
			['resolution', '720p'],
			['duration', '12s'],
			['audio', 'Off']
		]);
		assert.ok(presentation.adjustments.some(adjustment => adjustment.parameterId === 'resolution'
			&& adjustment.previousValueLabel === '4K' && adjustment.valueLabel === '720p'));
		assert.ok(presentation.adjustments.some(adjustment => adjustment.parameterId === 'legacy' && adjustment.kind === 'removed'));
		assert.strictEqual(presentation.availabilityMessage, undefined);
		assert.strictEqual(Object.isFrozen(presentation), true);
		assert.strictEqual(Object.isFrozen(presentation.parameters), true);
		assert.strictEqual(presentation.values, normalization.values);
	});

	test('projects fixed parameters, catalog units, and display-safe adjustments', () => {
		const [descriptor] = descriptorsFrom([model('fixed-settings', 'Fixed settings', [mode('text-to-video', [{
			id: 'quality', label: 'Quality', type: 'enum', default: 'reviewed',
			options: [{ value: 'reviewed', label: 'Reviewed' }]
		}, {
			id: 'durationSeconds', label: 'Duration', type: 'range', default: 5,
			minimum: 5, maximum: 5, step: 1, unit: 's'
		}])])]);
		const resolution = capability(descriptor, 'text-to-video');
		const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, { 'text-prompt': 1 }, {
			legacyInternalSetting: 'opaque-value'
		});
		const presentation = createBaseHalfVideoModelSettingsPresentation(resolution, normalization);
		assert.deepStrictEqual(presentation.parameters.map(parameter => [parameter.control, parameter.valueLabel]), [
			['fixed', 'Reviewed'],
			['fixed', '5s']
		]);
		const removed = presentation.adjustments.find(adjustment => adjustment.parameterId === 'legacyInternalSetting');
		assert.strictEqual(removed?.parameterLabel, 'Previous setting');
		assert.strictEqual(removed?.previousValueLabel, 'Previous saved value');
		assert.strictEqual(JSON.stringify(removed).includes('opaque-value'), false);
	});

	test('merges ordinary normalization adjustments without losing the original reviewed value', () => {
		const merged = mergeBaseHalfVideoSettingAdjustments([
			{ parameterId: 'resolution', kind: 'constrained', reason: 'First normalization.', previousValue: '4K', value: '1080p' }
		], [
			{ parameterId: 'resolution', kind: 'constrained', reason: 'Second normalization.', previousValue: '1080p', value: '720p' },
			{ parameterId: 'durationSeconds', kind: 'defaulted', reason: 'Defaulted.', value: 5 }
		]);
		assert.deepStrictEqual(merged.map(adjustment => [adjustment.parameterId, adjustment.previousValue, adjustment.value]), [
			['resolution', '4K', '720p'],
			['durationSeconds', undefined, 5]
		]);
		assert.strictEqual(Object.isFrozen(merged), true);
		assert.strictEqual(merged.every(adjustment => Object.isFrozen(adjustment)), true);
	});

	test('keeps a declared frame method selected while input readiness fails', () => {
		const [descriptor] = descriptorsFrom([model('frame-method', 'Frame method', [mode('first-frame-to-video')])]);
		const resolution = capability(descriptor, 'first-frame-to-video');
		const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, { 'text-prompt': 1 }, {});
		const presentation = createBaseHalfVideoModelSettingsPresentation(resolution, normalization);
		const readiness = evaluateBaseHalfVideoInputs(resolution, { 'text-prompt': 1 });
		assert.strictEqual(presentation.methods.options[0].selected, true);
		assert.strictEqual(presentation.methods.options[0].mode, 'first-frame-to-video');
		assert.strictEqual(normalization.status, 'ready');
		assert.strictEqual(readiness.ready, false);
		assert.strictEqual(readiness.problems[0].input, 'first-frame');
	});

	test('uses semantic message precedence and never promotes an adjustment action', () => {
		const presentation = createBaseHalfVideoMessagePrecedencePresentation([
			{ kind: 'settings-adjustment', message: 'A setting changed.', action: { id: 'review-settings', label: 'Review settings' } },
			{ kind: 'information', message: 'Reviewed source.' },
			{ kind: 'input-readiness-problem', message: 'A frame is required.', action: { id: 'add-frame', label: 'Add frame' } },
			{ kind: 'model-selection-problem', message: 'The selected model is unavailable.', action: { id: 'choose-model', label: 'Choose another model' } }
		]);
		assert.deepStrictEqual(presentation.messages.map(message => message.kind), [
			'model-selection-problem', 'input-readiness-problem', 'settings-adjustment', 'information'
		]);
		assert.strictEqual(presentation.primaryMessage?.kind, 'model-selection-problem');
		assert.strictEqual(presentation.primaryAction?.id, 'choose-model');
		assert.strictEqual(presentation.messages.some(message => message.kind === 'settings-adjustment'), true);
		assert.strictEqual(Object.isFrozen(presentation.primaryAction), true);

		const adjustmentOnly = createBaseHalfVideoMessagePrecedencePresentation([
			{ kind: 'settings-adjustment', message: 'A setting changed.', action: { id: 'ignored', label: 'Ignored' } }
		]);
		assert.strictEqual(adjustmentOnly.primaryMessage?.kind, 'settings-adjustment');
		assert.strictEqual(adjustmentOnly.primaryAction, undefined);
	});

	test('normalizes a model switch without inferring a method from inputs or mutating inputs', () => {
		const [descriptor] = descriptorsFrom([model('ordered', 'Ordered', [
			mode('first-frame-to-video', [{
				id: 'resolution', label: 'Resolution', type: 'enum', default: '720p',
				options: [{ value: '720p', label: '720p' }]
			}]),
			mode('text-to-video', [{
				id: 'resolution', label: 'Resolution', type: 'enum', default: '720p',
				options: [{ value: '720p', label: '720p' }]
			}])
		])]);
		const withoutFrameInputs = Object.freeze({ 'text-prompt': 1 } as const);
		const withFrameInputs = Object.freeze({ 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 } as const);
		const savedSettings = Object.freeze({ resolution: '1080p' } as const);
		const withoutFrames = reconcileBaseHalfVideoModelSettings(
			descriptor,
			'first-last-frame-to-video',
			savedSettings,
			withoutFrameInputs
		);
		const withTwoFrames = reconcileBaseHalfVideoModelSettings(
			descriptor,
			'first-last-frame-to-video',
			savedSettings,
			withFrameInputs
		);
		assert.strictEqual(withoutFrames.status, 'ready');
		assert.strictEqual(withTwoFrames.status, 'ready');
		if (withoutFrames.status !== 'ready' || withTwoFrames.status !== 'ready') {
			assert.fail('Expected ready reconciliations.');
		}
		assert.strictEqual(withoutFrames.mode, 'first-frame-to-video');
		assert.strictEqual(withTwoFrames.mode, 'first-frame-to-video');
		assert.strictEqual(withoutFrames.methodChanged, true);
		assert.strictEqual(withoutFrames.normalization.values.resolution, '720p');
		assert.ok(withoutFrames.normalization.adjustments.some(adjustment => adjustment.parameterId === 'generationMode'
			&& adjustment.previousValue === 'first-last-frame-to-video'
			&& adjustment.value === 'first-frame-to-video'));
		assert.deepStrictEqual(savedSettings, { resolution: '1080p' });
		assert.deepStrictEqual(withoutFrameInputs, { 'text-prompt': 1 });
		assert.deepStrictEqual(withFrameInputs, { 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 });

		const explicit = reconcileBaseHalfVideoGenerationMethodSettings(
			descriptor,
			'text-to-video',
			'first-frame-to-video',
			{ resolution: '720p' },
			{ 'text-prompt': 1, 'first-frame': 1 }
		);
		assert.strictEqual(explicit.status, 'ready');
		assert.strictEqual(explicit.status === 'ready' ? explicit.mode : undefined, 'text-to-video');
		assert.strictEqual(reconcileBaseHalfVideoGenerationMethodSettings(
			descriptor,
			'first-last-frame-to-video',
			'first-frame-to-video',
			{},
			{}
		).status, 'unavailable');
	});

	test('projects invalid saved configuration as deterministic values or an availability message', () => {
		const [descriptor] = descriptorsFrom([model('impossible', 'Impossible', [mode('text-to-video', [{
			id: 'quality', label: 'Quality', type: 'enum', default: 'standard',
			options: [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]
		}], undefined, [{
			id: 'standardOnly', targetParameterId: 'quality',
			allowed: { kind: 'values', values: ['standard'] }, reason: 'Only standard is permitted.'
		}, {
			id: 'highOnly', targetParameterId: 'quality',
			allowed: { kind: 'values', values: ['high'] }, reason: 'Only high is permitted.'
		}])])]);
		const reconciliation = reconcileBaseHalfVideoModelSettings(descriptor, undefined, {}, { 'text-prompt': 1 });
		assert.strictEqual(reconciliation.status, 'unavailable');
		assert.ok(reconciliation.reason.includes('Only standard is permitted.'));
		assert.strictEqual(reconciliation.normalization?.status, 'unavailable');
		const resolution = capability(descriptor, 'text-to-video');
		const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, { 'text-prompt': 1 }, {});
		const presentation = createBaseHalfVideoModelSettingsPresentation(resolution, normalization);
		assert.strictEqual(presentation.availabilityMessage?.kind, 'settings-unavailable');
		assert.strictEqual(presentation.availabilityMessage?.message, normalization.status === 'unavailable' ? normalization.reason : undefined);
		assert.strictEqual(Object.isFrozen(presentation.availabilityMessage), true);
	});
});

function settingsPresentation(
	descriptor: IBaseHalfVideoModelDescriptor,
	modeId: Parameters<typeof capability>[1]
) {
	const resolution = capability(descriptor, modeId);
	return createBaseHalfVideoModelSettingsPresentation(
		resolution,
		normalizeBaseHalfVideoSettingsForCapability(resolution, { 'text-prompt': 1 }, {})
	);
}

function capability(
	descriptor: IBaseHalfVideoModelDescriptor,
	modeId: 'text-to-video' | 'first-frame-to-video' | 'first-last-frame-to-video' | 'reference-to-video' | 'video-edit'
): IBaseHalfSupportedVideoCapabilityResolution {
	const capabilityValue = descriptor.modes.find(candidate => candidate.mode === modeId && !candidate.availability);
	if (!capabilityValue) {
		throw new Error(`Missing executable fixture mode '${modeId}'.`);
	}
	return {
		status: 'supported',
		descriptor,
		capability: capabilityValue,
		selection: { ...descriptor.key, mode: capabilityValue.mode }
	};
}

function entry(
	descriptor: IBaseHalfVideoModelDescriptor,
	connectionState: IBaseHalfVideoModelPresentationEntry['connectionState'],
	descriptorAvailability?: { status: 'unavailable'; reason: string }
): IBaseHalfVideoModelPresentationEntry {
	const effectiveDescriptor = descriptorAvailability ? { ...descriptor, availability: descriptorAvailability } : descriptor;
	return {
		choice: choice(effectiveDescriptor),
		descriptor: effectiveDescriptor,
		connectionState,
		providerLabel: 'Provider label',
		deploymentLabel: 'Global'
	};
}

function choice(descriptor: IBaseHalfVideoModelDescriptor): IBaseHalfVideoModelChoice {
	return {
		recipeId: 'pointa.test.generate-video',
		catalogId: 'pointa.test.video-models',
		providerId: descriptor.key.provider,
		deploymentId: descriptor.key.deployment,
		region: descriptor.key.region,
		modelId: descriptor.key.modelId,
		revision: descriptor.key.revision,
		connectionSpecId: 'pointa.test.provider'
	};
}

function descriptorsFrom(models: unknown[]): readonly IBaseHalfVideoModelDescriptor[] {
	return createBaseHalfVideoModelRegistry({ schemaVersion: 1, models }).models;
}

function model(modelId: string, label: string, modes: unknown[] = [mode('text-to-video')]): unknown {
	return {
		key: { provider: 'provider', deployment: 'global', region: 'global', modelId, revision: '2026-08-24' },
		label,
		source: { url: 'https://example.com/models', verifiedAt: '2026-08-24' },
		modes
	};
}

function mode(
	modeId: 'text-to-video' | 'first-frame-to-video' | 'first-last-frame-to-video' | 'reference-to-video' | 'video-edit',
	parameters: unknown[] = [],
	availability?: { status: 'unavailable'; reason: string },
	constraints: unknown[] = []
): unknown {
	const inputs: unknown[] = [{ kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 16_000 }];
	if (modeId === 'first-frame-to-video' || modeId === 'first-last-frame-to-video') {
		inputs.push({ kind: 'first-frame', minItems: 1, maxItems: 1 });
	}
	if (modeId === 'first-last-frame-to-video') {
		inputs.push({ kind: 'last-frame', minItems: 1, maxItems: 1 });
	}
	if (modeId === 'reference-to-video') {
		inputs.push({ kind: 'reference-image', minItems: 1, maxItems: 4 });
	}
	return {
		mode: modeId,
		...(availability ? { availability } : {}),
		inputs,
		parameters,
		constraints
	};
}

function settingsParameters(): unknown[] {
	return [
		{
			id: 'aspectRatio', label: 'Aspect Ratio', type: 'enum', default: '16:9',
			options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]
		},
		{
			id: 'resolution', label: 'Resolution', type: 'enum', default: '720p',
			options: [
				{ value: '720p', label: '720p' },
				{ value: '1080p', label: '1080p' },
				{ value: '4K', label: '4K', availability: { status: 'unavailable', reason: 'Not available.' } }
			]
		},
			{ id: 'durationSeconds', label: 'Duration', type: 'range', default: 5, minimum: 1, maximum: 15, step: 1, unit: 's' },
		{
			id: 'qualityPreset', label: 'Quality', type: 'enum', default: 'q1',
			options: Array.from({ length: 9 }, (_, index) => ({ value: `q${index + 1}`, label: `Quality ${index + 1}` }))
		},
		{ id: 'strength', label: 'Strength', type: 'range', default: 8, minimum: 0, maximum: 15, step: 1 },
		{ id: 'generateAudio', label: 'Generate Audio', type: 'boolean', default: true },
		{
			id: 'shotType', label: 'Shot Type', type: 'enum', default: 'single',
			enabledWhen: {
				condition: { kind: 'parameter', parameterId: 'generateAudio', operator: 'equals', value: true },
				reason: 'Shot type requires generated audio.'
			},
			options: [{ value: 'single', label: 'Single' }, { value: 'multi', label: 'Multi' }]
		},
		{
			id: 'hiddenDetail', label: 'Hidden detail', type: 'boolean', default: false,
			visibleWhen: { kind: 'parameter', parameterId: 'generateAudio', operator: 'equals', value: true }
		}
	];
}

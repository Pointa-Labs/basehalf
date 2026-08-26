/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BaseHalfVideoGenerationMode,
	BaseHalfVideoInputState,
	BaseHalfVideoModelScalar,
	BaseHalfVideoSettings,
	BaseHalfVideoSettingsNormalization,
	IBaseHalfReadyVideoSettingsNormalization,
	IBaseHalfResolvedVideoParameter,
	IBaseHalfSupportedVideoCapabilityResolution,
	IBaseHalfUnavailableVideoSettingsNormalization,
	IBaseHalfVideoModeCapability,
	IBaseHalfVideoModelDescriptor,
	IBaseHalfVideoSettingAdjustment,
	normalizeBaseHalfVideoSettingsForCapability
} from './basehalfVideoModels.js';

const SHORT_OPTION_LABEL_LENGTH = 24;

export type BaseHalfVideoModelAvailability = 'available' | 'connection-required' | 'unavailable';
export type BaseHalfVideoModelRowAction = 'none' | 'select' | 'connect';
export type BaseHalfVideoModelConnectionState = 'configured' | 'missing' | 'needs-attention' | 'rebind-required' | 'unavailable';

export interface IBaseHalfVideoModelChoice {
	readonly recipeId: string;
	readonly catalogId: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly modelId: string;
	readonly revision: string;
	readonly connectionSpecId?: string;
	readonly connectionServiceId?: string;
}

export type BaseHalfVideoModelCapabilityToken =
	| { readonly kind: 'method'; readonly mode: BaseHalfVideoGenerationMode; readonly label: string }
	| { readonly kind: 'resolution'; readonly value: string | number; readonly label: string }
	| { readonly kind: 'duration'; readonly minimum: number; readonly maximum: number; readonly label: string }
	| { readonly kind: 'audio'; readonly label: string };

export interface IBaseHalfVideoModelPresentationEntry {
	readonly choice: IBaseHalfVideoModelChoice;
	readonly descriptor: IBaseHalfVideoModelDescriptor;
	readonly connectionState: BaseHalfVideoModelConnectionState;
	readonly providerLabel?: string;
	readonly deploymentLabel?: string;
	readonly groupLabel?: string;
}

export interface IBaseHalfStaleVideoModelSelection {
	readonly choice: IBaseHalfVideoModelChoice;
	readonly label: string;
	readonly reason: string;
}

export interface IBaseHalfVideoModelRowPresentation {
	readonly logicalKey: string;
	readonly choice: IBaseHalfVideoModelChoice;
	readonly label: string;
	readonly disambiguationLabel?: string;
	readonly groupLabel?: string;
	readonly capabilityTokens: readonly BaseHalfVideoModelCapabilityToken[];
	readonly availability: BaseHalfVideoModelAvailability;
	readonly action: BaseHalfVideoModelRowAction;
	readonly disabledReason?: string;
	readonly selected: boolean;
	readonly typeaheadText: string;
}

export interface IBaseHalfVideoModelPickerPresentation {
	readonly rows: readonly IBaseHalfVideoModelRowPresentation[];
	readonly showScopeHeadings: boolean;
	readonly pinnedUnavailableSelection?: IBaseHalfVideoModelRowPresentation;
}

export interface IBaseHalfVideoModelPickerPresentationInput {
	readonly entries: readonly IBaseHalfVideoModelPresentationEntry[];
	readonly selectedChoice?: IBaseHalfVideoModelChoice;
	readonly staleSelection?: IBaseHalfStaleVideoModelSelection;
}

export type BaseHalfVideoMethodControl = 'fixed' | 'segmented' | 'listbox';
export type BaseHalfVideoParameterControl = 'fixed' | 'segmented' | 'listbox' | 'range' | 'boolean';

export interface IBaseHalfVideoMethodPresentation {
	readonly mode: BaseHalfVideoGenerationMode;
	readonly label: string;
	readonly selected: boolean;
	readonly enabled: boolean;
	readonly disabledReason?: string;
}

export interface IBaseHalfVideoParameterOptionPresentation {
	readonly value: string | number;
	readonly label: string;
	readonly enabled: boolean;
	readonly unavailableReason?: string;
}

export interface IBaseHalfVideoParameterPresentation {
	readonly parameterId: string;
	readonly label: string;
	readonly description?: string;
	readonly control: BaseHalfVideoParameterControl;
	readonly enabled: boolean;
	readonly disabledReason?: string;
	readonly value?: BaseHalfVideoModelScalar;
	readonly valueLabel?: string;
	readonly options?: readonly IBaseHalfVideoParameterOptionPresentation[];
	readonly minimum?: number;
	readonly maximum?: number;
	readonly step?: number;
	readonly unit?: string;
}

export interface IBaseHalfVideoSettingAdjustmentPresentation {
	readonly parameterId: string;
	readonly parameterLabel: string;
	readonly kind: IBaseHalfVideoSettingAdjustment['kind'];
	readonly previousValueLabel?: string;
	readonly valueLabel?: string;
	readonly reason: string;
}

export interface IBaseHalfVideoSettingsSummaryToken {
	readonly kind: 'method' | 'aspect-ratio' | 'resolution' | 'duration' | 'audio';
	readonly parameterId?: string;
	readonly label: string;
	readonly value: string;
}

export interface IBaseHalfVideoModelSettingsPresentation {
	readonly modelLabel: string;
	readonly source: { readonly url: string; readonly verifiedAt: string };
	readonly methods: {
		readonly control: BaseHalfVideoMethodControl;
		readonly options: readonly IBaseHalfVideoMethodPresentation[];
	};
	readonly parameters: readonly IBaseHalfVideoParameterPresentation[];
	readonly settingsSummary: readonly IBaseHalfVideoSettingsSummaryToken[];
	readonly values: BaseHalfVideoSettings;
	readonly adjustments: readonly IBaseHalfVideoSettingAdjustmentPresentation[];
	readonly availabilityMessage?: IBaseHalfVideoModelAvailabilityMessage;
}

export interface IBaseHalfVideoModelAvailabilityMessage {
	readonly kind: 'settings-unavailable';
	readonly message: string;
}

export type BaseHalfVideoMessageKind =
	| 'transaction-failure'
	| 'attempt-problem'
	| 'model-selection-problem'
	| 'input-readiness-problem'
	| 'settings-adjustment'
	| 'information';

export interface IBaseHalfVideoMessageAction {
	readonly id: string;
	readonly label: string;
	readonly disabledReason?: string;
}

export interface IBaseHalfVideoMessage {
	readonly kind: BaseHalfVideoMessageKind;
	readonly message: string;
	readonly action?: IBaseHalfVideoMessageAction;
}

export interface IBaseHalfVideoMessagePrecedencePresentation {
	readonly messages: readonly IBaseHalfVideoMessage[];
	readonly primaryMessage?: IBaseHalfVideoMessage;
	readonly primaryAction?: IBaseHalfVideoMessageAction;
}

export type BaseHalfVideoModelPickerFocusTarget =
	| { readonly kind: 'row'; readonly logicalKey: string }
	| { readonly kind: 'trigger' };

export type BaseHalfVideoModelSettingsReconciliation =
	| {
		readonly status: 'ready';
		readonly descriptor: IBaseHalfVideoModelDescriptor;
		readonly capability: IBaseHalfVideoModeCapability;
		readonly mode: BaseHalfVideoGenerationMode;
		readonly previousMode?: BaseHalfVideoGenerationMode;
		readonly methodChanged: boolean;
		readonly normalization: IBaseHalfReadyVideoSettingsNormalization;
	}
	| {
		readonly status: 'unavailable';
		readonly reason: string;
		readonly descriptor?: IBaseHalfVideoModelDescriptor;
		readonly capability?: IBaseHalfVideoModeCapability;
		readonly mode?: BaseHalfVideoGenerationMode;
		readonly previousMode?: BaseHalfVideoGenerationMode;
		readonly methodChanged?: boolean;
		readonly normalization?: IBaseHalfUnavailableVideoSettingsNormalization;
	};

export function createBaseHalfVideoModelPickerPresentation(
	input: IBaseHalfVideoModelPickerPresentationInput
): IBaseHalfVideoModelPickerPresentation {
	const selectedKey = input.selectedChoice ? baseHalfVideoModelChoiceLogicalKey(input.selectedChoice) : undefined;
	const labelCounts = new Map<string, number>();
	for (const entry of input.entries) {
		const labelKey = normalizeTypeaheadText(entry.descriptor.label);
		labelCounts.set(labelKey, (labelCounts.get(labelKey) ?? 0) + 1);
	}
	const rows = input.entries.map(entry => createModelRow(
		entry,
		selectedKey,
		(labelCounts.get(normalizeTypeaheadText(entry.descriptor.label)) ?? 0) > 1
	));
	const staleKey = input.staleSelection ? baseHalfVideoModelChoiceLogicalKey(input.staleSelection.choice) : undefined;
	const pinnedUnavailableSelection = input.staleSelection && staleKey === selectedKey && !rows.some(row => row.logicalKey === staleKey)
		? createStaleModelRow(input.staleSelection)
		: undefined;
	const showScopeHeadings = new Set(input.entries.map(entry => modelConnectionScopeKey(entry.choice))).size > 1;
	return freeze({
		rows: freeze(rows),
		showScopeHeadings,
		...(pinnedUnavailableSelection ? { pinnedUnavailableSelection } : {})
	});
}

export function createBaseHalfVideoModelSettingsPresentation(
	resolution: IBaseHalfSupportedVideoCapabilityResolution,
	normalization: BaseHalfVideoSettingsNormalization,
	previousParameters: readonly IBaseHalfVideoParameterPresentation[] = []
): IBaseHalfVideoModelSettingsPresentation {
	const methodOptions = resolution.descriptor.modes.map(capability => freeze({
		mode: capability.mode,
		label: baseHalfVideoGenerationModeLabel(capability.mode),
		selected: capability.mode === resolution.selection.mode,
		enabled: !capability.availability,
		...(capability.availability ? { disabledReason: capability.availability.reason } : {})
	}));
	const parameters = normalization.parameters
		.filter(parameter => parameter.visible)
		.map(parameter => createParameterPresentation(parameter, normalization.values[parameter.id]));
	const result = {
		modelLabel: resolution.descriptor.label,
		source: freeze({ ...resolution.descriptor.source }),
		methods: freeze({
			control: methodControl(methodOptions),
			options: freeze(methodOptions)
		}),
		parameters: freeze(parameters),
		settingsSummary: createSettingsSummary(resolution, normalization),
		values: normalization.values,
		adjustments: createBaseHalfVideoSettingAdjustmentPresentations(normalization.adjustments, parameters, previousParameters),
		...(normalization.status === 'unavailable' ? {
			availabilityMessage: freeze({ kind: 'settings-unavailable' as const, message: normalization.reason })
		} : {})
	};
	return freeze(result);
}

/**
 * Applies the parent Video-node precedence without parsing localized copy.
 * Historical adjustments remain in the ordered detail list but cannot own the
 * primary action.
 */
export function createBaseHalfVideoMessagePrecedencePresentation(
	messages: readonly IBaseHalfVideoMessage[]
): IBaseHalfVideoMessagePrecedencePresentation {
	const ordered = messages.map((message, index) => ({ message: freezeMessage(message), index }))
		.sort((left, right) => messageRank(left.message.kind) - messageRank(right.message.kind) || left.index - right.index)
		.map(entry => entry.message);
	const primaryMessage = ordered[0];
	const primaryAction = primaryMessage && isBlockingMessage(primaryMessage.kind)
		? primaryMessage.action
		: undefined;
	return freeze({
		messages: freeze(ordered),
		...(primaryMessage ? { primaryMessage } : {}),
		...(primaryAction ? { primaryAction } : {})
	});
}

/** Restores logical focus after a reviewed-registry refresh. */
export function resolveBaseHalfVideoModelPickerFocus(
	previousRows: readonly IBaseHalfVideoModelRowPresentation[],
	nextRows: readonly IBaseHalfVideoModelRowPresentation[],
	focusedLogicalKey: string | undefined
): BaseHalfVideoModelPickerFocusTarget {
	if (focusedLogicalKey) {
		const exact = nextRows.find(row => row.logicalKey === focusedLogicalKey && row.availability !== 'unavailable');
		if (exact) {
			return freeze({ kind: 'row', logicalKey: exact.logicalKey });
		}
	}
	const previousIndex = focusedLogicalKey
		? previousRows.findIndex(row => row.logicalKey === focusedLogicalKey)
		: -1;
	const startIndex = previousIndex >= 0
		? Math.min(previousIndex, Math.max(0, nextRows.length - 1))
		: 0;
	for (let distance = 0; distance < nextRows.length; distance++) {
		for (const index of distance === 0 ? [startIndex] : [startIndex + distance, startIndex - distance]) {
			const candidate = nextRows[index];
			if (candidate?.availability !== 'unavailable') {
				return freeze({ kind: 'row', logicalKey: candidate.logicalKey });
			}
		}
	}
	return freeze({ kind: 'trigger' });
}

export function createBaseHalfVideoSettingAdjustmentPresentations(
	adjustments: readonly IBaseHalfVideoSettingAdjustment[],
	parameters: readonly IBaseHalfVideoParameterPresentation[],
	previousParameters: readonly IBaseHalfVideoParameterPresentation[] = []
): readonly IBaseHalfVideoSettingAdjustmentPresentation[] {
	return freeze(adjustments.map(adjustment => {
		const currentParameter = parameters.find(parameter => parameter.parameterId === adjustment.parameterId);
		const previousParameter = previousParameters.find(parameter => parameter.parameterId === adjustment.parameterId);
		const displayParameter = currentParameter ?? previousParameter;
		const generationMode = adjustment.parameterId === 'generationMode';
		const previousValueLabel = generationMode
			? generationModeValueLabel(adjustment.previousValue)
			: displayParameter && adjustment.previousValue !== undefined
				? baseHalfVideoParameterValueLabel(displayParameter, adjustment.previousValue)
				: adjustment.previousValue !== undefined ? 'Previous saved value' : undefined;
		const valueLabel = generationMode
			? generationModeValueLabel(adjustment.value)
			: currentParameter && adjustment.value !== undefined
				? baseHalfVideoParameterValueLabel(currentParameter, adjustment.value)
				: adjustment.value !== undefined ? 'Reviewed value' : undefined;
		return freeze({
			parameterId: adjustment.parameterId,
			parameterLabel: generationMode ? 'Generation method' : displayParameter?.label ?? 'Previous setting',
			kind: adjustment.kind,
			...(previousValueLabel ? { previousValueLabel } : {}),
			...(valueLabel ? { valueLabel } : {}),
			reason: adjustment.reason
		});
	}));
}

export function mergeBaseHalfVideoSettingAdjustments(
	current: readonly IBaseHalfVideoSettingAdjustment[],
	next: readonly IBaseHalfVideoSettingAdjustment[]
): readonly IBaseHalfVideoSettingAdjustment[] {
	const merged = current.map(adjustment => freeze({ ...adjustment }));
	const indexByParameter = new Map(merged.map((adjustment, index) => [adjustment.parameterId, index]));
	for (const adjustment of next) {
		const index = indexByParameter.get(adjustment.parameterId);
		if (index === undefined) {
			indexByParameter.set(adjustment.parameterId, merged.length);
			merged.push(freeze({ ...adjustment }));
			continue;
		}
		const previous = merged[index];
		merged[index] = freeze({
			...adjustment,
			...(previous.previousValue !== undefined ? { previousValue: previous.previousValue } : {})
		});
	}
	return freeze(merged);
}

export function baseHalfVideoParameterValueLabel(
	parameter: IBaseHalfVideoParameterPresentation,
	value: BaseHalfVideoModelScalar
): string | undefined {
	if (parameter.options) {
		return parameter.options.find(option => option.value === value)?.label;
	}
	if (parameter.control === 'boolean') {
		return value === true ? 'On' : value === false ? 'Off' : undefined;
	}
	return typeof value === 'number' ? `${formatNumber(value)}${parameter.unit ?? ''}` : undefined;
}

/**
 * Reconciles a model switch. The fallback is determined only by executable
 * catalog order. Input counts participate solely in declared setting
 * conditions and never select a generation method.
 */
export function reconcileBaseHalfVideoModelSettings(
	descriptor: IBaseHalfVideoModelDescriptor,
	previousMode: BaseHalfVideoGenerationMode | undefined,
	candidate: unknown,
	inputs: BaseHalfVideoInputState
): BaseHalfVideoModelSettingsReconciliation {
	const modes = executableVideoModes(descriptor);
	if (!modes.length) {
		return freeze({
			status: 'unavailable',
			reason: descriptor.availability?.reason ?? 'This model has no executable reviewed generation method.'
		});
	}
	const capability = modes.find(mode => mode.mode === previousMode) ?? modes[0];
	return reconcileSettings(descriptor, capability, previousMode, candidate, inputs);
}

/** Reconciles an explicit user-selected method without applying a fallback. */
export function reconcileBaseHalfVideoGenerationMethodSettings(
	descriptor: IBaseHalfVideoModelDescriptor,
	mode: BaseHalfVideoGenerationMode,
	previousMode: BaseHalfVideoGenerationMode | undefined,
	candidate: unknown,
	inputs: BaseHalfVideoInputState
): BaseHalfVideoModelSettingsReconciliation {
	const capability = executableVideoModes(descriptor).find(candidateMode => candidateMode.mode === mode);
	if (!capability) {
		return freeze({ status: 'unavailable', reason: `This model does not expose executable ${baseHalfVideoGenerationModeLabel(mode)}.` });
	}
	return reconcileSettings(descriptor, capability, previousMode, candidate, inputs);
}

export function baseHalfVideoModelChoiceLogicalKey(choice: IBaseHalfVideoModelChoice): string {
	return JSON.stringify([
		choice.recipeId,
		choice.catalogId,
		choice.providerId,
		choice.deploymentId,
		choice.region,
		choice.modelId,
		choice.revision,
		choice.connectionSpecId ?? ''
	]);
}

function modelConnectionScopeKey(choice: IBaseHalfVideoModelChoice): string {
	return choice.connectionSpecId ?? JSON.stringify([
		choice.providerId,
		choice.deploymentId,
		choice.region
	]);
}

export function baseHalfVideoGenerationModeLabel(mode: BaseHalfVideoGenerationMode): string {
	switch (mode) {
		case 'text-to-video': return 'Text to Video';
		case 'first-frame-to-video': return 'Start Frame';
		case 'first-last-frame-to-video': return 'Start + End Frames';
		case 'reference-to-video': return 'References';
		case 'video-edit': return 'Edit Video';
		case 'video-extension': return 'Extend Video';
	}
}

export function executableVideoModes(descriptor: IBaseHalfVideoModelDescriptor): readonly IBaseHalfVideoModeCapability[] {
	return descriptor.availability ? freeze([]) : freeze(descriptor.modes.filter(mode => !mode.availability));
}

function createModelRow(
	entry: IBaseHalfVideoModelPresentationEntry,
	selectedKey: string | undefined,
	showDisambiguation: boolean
): IBaseHalfVideoModelRowPresentation {
	const logicalKey = baseHalfVideoModelChoiceLogicalKey(entry.choice);
	const selected = logicalKey === selectedKey;
	const executableModes = executableVideoModes(entry.descriptor);
	let availability: BaseHalfVideoModelAvailability;
	let action: BaseHalfVideoModelRowAction;
	let disabledReason: string | undefined;
	if (entry.descriptor.availability || !executableModes.length) {
		availability = 'unavailable';
		action = 'none';
		disabledReason = entry.descriptor.availability?.reason ?? 'This model has no executable reviewed generation method.';
	} else if (entry.connectionState === 'unavailable'
		|| (entry.connectionState !== 'configured' && !entry.choice.connectionSpecId)) {
		availability = 'unavailable';
		action = 'none';
		disabledReason = 'No connection setup is available for this model.';
	} else if (entry.connectionState === 'rebind-required') {
		availability = 'available';
		action = 'select';
	} else if (entry.connectionState !== 'configured') {
		availability = 'connection-required';
		action = 'connect';
		disabledReason = connectionRequiredReason(entry.connectionState, selected);
	} else if (selected) {
		availability = 'available';
		action = 'none';
	} else {
		availability = 'available';
		action = 'select';
	}

	const capabilityTokens = createCapabilityTokens(entry.descriptor);
	const scopeLabel = [entry.providerLabel, entry.deploymentLabel].filter(Boolean).join(' · ') || undefined;
	const disambiguationLabel = showDisambiguation ? scopeLabel : undefined;
	const groupLabel = entry.groupLabel ?? scopeLabel;
	const typeaheadText = normalizeTypeaheadText([
		entry.descriptor.label,
		disambiguationLabel
	].filter((value): value is string => Boolean(value)).join(' '));
	return freeze({
		logicalKey,
		choice: freeze({ ...entry.choice }),
		label: entry.descriptor.label,
		...(disambiguationLabel ? { disambiguationLabel } : {}),
		...(groupLabel ? { groupLabel } : {}),
		capabilityTokens,
		availability,
		action,
		...(disabledReason ? { disabledReason } : {}),
		selected,
		typeaheadText
	});
}

function createStaleModelRow(selection: IBaseHalfStaleVideoModelSelection): IBaseHalfVideoModelRowPresentation {
	return freeze({
		logicalKey: baseHalfVideoModelChoiceLogicalKey(selection.choice),
		choice: freeze({ ...selection.choice }),
		label: selection.label,
		capabilityTokens: freeze([]),
		availability: 'unavailable',
		action: 'none',
		disabledReason: selection.reason,
		selected: true,
		typeaheadText: normalizeTypeaheadText(selection.label)
	});
}

function connectionRequiredReason(
	state: Extract<BaseHalfVideoModelConnectionState, 'missing' | 'needs-attention'>,
	selected: boolean
): string {
	if (state === 'missing') {
		return selected ? 'Connect this model to continue.' : 'Connect this model before selecting it.';
	}
	return selected ? 'Reconnect this model to continue.' : 'Reconnect this model before selecting it.';
}

function createCapabilityTokens(descriptor: IBaseHalfVideoModelDescriptor): readonly BaseHalfVideoModelCapabilityToken[] {
	const modes = executableVideoModes(descriptor);
	const tokens: BaseHalfVideoModelCapabilityToken[] = modes.map(capability => freeze({
		kind: 'method' as const,
		mode: capability.mode,
		label: baseHalfVideoGenerationModeLabel(capability.mode)
	}));
	const resolution = highestResolution(modes);
	if (resolution) {
		tokens.push(freeze({ kind: 'resolution', value: resolution.value, label: `Up to ${resolution.label}` }));
	}
	const duration = durationRange(modes);
	if (duration) {
		tokens.push(freeze({
			kind: 'duration',
			minimum: duration.minimum,
			maximum: duration.maximum,
			label: duration.label
		}));
	}
	if (modes.some(mode => supportsGeneratedAudio(mode))) {
		tokens.push(freeze({ kind: 'audio', label: 'Audio' }));
	}
	return freeze(tokens);
}

function highestResolution(modes: readonly IBaseHalfVideoModeCapability[]): { readonly value: string | number; readonly label: string } | undefined {
	let best: { value: string | number; label: string; rank: number; order: number } | undefined;
	let order = 0;
	for (const mode of modes) {
		const parameter = mode.parameters.find(candidate => candidate.id === 'resolution' && candidate.type === 'enum');
		if (!parameter || parameter.type !== 'enum' || parameter.availability) {
			continue;
		}
		for (const option of parameter.options) {
			if (option.availability) {
				continue;
			}
			const rank = resolutionRank(option.label, option.value);
			if (!best || rank > best.rank || (rank === best.rank && order > best.order)) {
				best = { value: option.value, label: option.label, rank, order };
			}
			order++;
		}
	}
	return best ? freeze({ value: best.value, label: best.label }) : undefined;
}

function resolutionRank(label: string, value: string | number): number {
	const text = `${label} ${String(value)}`;
	const match = /([0-9]+(?:\.[0-9]+)?)\s*([kp])?/i.exec(text);
	if (!match) {
		return Number.NEGATIVE_INFINITY;
	}
	const amount = Number(match[1]);
	return match[2]?.toLowerCase() === 'k' ? amount * 1000 : amount;
}

function durationRange(modes: readonly IBaseHalfVideoModeCapability[]): {
	readonly minimum: number;
	readonly maximum: number;
	readonly label: string;
} | undefined {
	const values: Array<{ readonly value: number; readonly label: string; readonly unit?: string }> = [];
	for (const mode of modes) {
		const parameter = mode.parameters.find(candidate => candidate.id === 'durationSeconds' || candidate.id === 'duration');
		if (!parameter || parameter.availability) {
			continue;
		}
		if (parameter.type === 'range') {
			values.push(
				{ value: parameter.minimum, label: `${formatNumber(parameter.minimum)}${parameter.unit ?? ''}`, unit: parameter.unit },
				{ value: parameter.maximum, label: `${formatNumber(parameter.maximum)}${parameter.unit ?? ''}`, unit: parameter.unit }
			);
		} else if (parameter.type === 'enum') {
			values.push(...parameter.options
				.filter(option => !option.availability && typeof option.value === 'number' && option.value > 0)
				.map(option => ({ value: option.value as number, label: option.label })));
		}
	}
	if (!values.length) {
		return undefined;
	}
	const ordered = [...values].sort((left, right) => left.value - right.value);
	const minimum = ordered[0];
	const maximum = ordered[ordered.length - 1];
	const label = minimum.value === maximum.value
		? maximum.label
		: minimum.unit && minimum.unit === maximum.unit
			? `${formatNumber(minimum.value)}–${formatNumber(maximum.value)}${minimum.unit}`
			: `${minimum.label}–${maximum.label}`;
	return freeze({
		minimum: minimum.value,
		maximum: maximum.value,
		label
	});
}

function supportsGeneratedAudio(mode: IBaseHalfVideoModeCapability): boolean {
	return mode.parameters.some(parameter => {
		if (parameter.availability) {
			return false;
		}
		if (parameter.id === 'generateAudio' && parameter.type === 'boolean') {
			return true;
		}
		return parameter.id === 'audioMode' && parameter.type === 'enum'
			&& parameter.options.some(option => !option.availability && option.value === 'generate');
	});
}

function createParameterPresentation(
	parameter: IBaseHalfResolvedVideoParameter,
	value: BaseHalfVideoModelScalar | undefined
): IBaseHalfVideoParameterPresentation {
	const control = parameterControl(parameter);
	const options: readonly IBaseHalfVideoParameterOptionPresentation[] | undefined = parameter.options
		? freeze(parameter.options.map(option => freeze({ ...option })))
		: parameter.type === 'range' && control !== 'range'
			? rangeOptions(parameter)
			: undefined;
	const presentation: IBaseHalfVideoParameterPresentation = {
		parameterId: parameter.id,
		label: parameter.label,
		...(parameter.description ? { description: parameter.description } : {}),
		control,
		enabled: parameter.enabled,
		...(parameter.unavailableReason ? { disabledReason: parameter.unavailableReason } : {}),
		...(value !== undefined ? { value } : {}),
		...(options ? { options } : {}),
		...(parameter.minimum !== undefined ? { minimum: parameter.minimum } : {}),
		...(parameter.maximum !== undefined ? { maximum: parameter.maximum } : {}),
		...(parameter.step !== undefined ? { step: parameter.step } : {}),
		...(parameter.unit ? { unit: parameter.unit } : {})
	};
	const valueLabel = value === undefined ? undefined : baseHalfVideoParameterValueLabel(presentation, value);
	return freeze({ ...presentation, ...(valueLabel ? { valueLabel } : {}) });
}

function parameterControl(parameter: IBaseHalfResolvedVideoParameter): BaseHalfVideoParameterControl {
	if (parameter.type === 'boolean') {
		return 'boolean';
	}
	if (parameter.type === 'enum') {
		if (parameter.options?.length === 1) {
			return 'fixed';
		}
		return parameter.options && parameter.options.length <= 8
			&& parameter.options.every(option => option.label.length <= SHORT_OPTION_LABEL_LENGTH)
			? 'segmented'
			: 'listbox';
	}
	const count = parameter.minimum !== undefined && parameter.maximum !== undefined && parameter.step
		? Math.floor(((parameter.maximum - parameter.minimum) / parameter.step) + 1)
		: Number.POSITIVE_INFINITY;
	return count <= 1 ? 'fixed' : count <= 15 ? 'segmented' : 'range';
}

function rangeOptions(parameter: IBaseHalfResolvedVideoParameter): readonly IBaseHalfVideoParameterOptionPresentation[] {
	if (parameter.minimum === undefined || parameter.maximum === undefined || parameter.step === undefined) {
		return freeze([]);
	}
	const options: IBaseHalfVideoParameterOptionPresentation[] = [];
	const count = Math.floor(((parameter.maximum - parameter.minimum) / parameter.step) + 1);
	for (let index = 0; index < count; index++) {
		const value = Number((parameter.minimum + index * parameter.step).toPrecision(12));
		options.push(freeze({ value, label: `${formatNumber(value)}${parameter.unit ?? ''}`, enabled: parameter.enabled }));
	}
	return freeze(options);
}

function methodControl(options: readonly IBaseHalfVideoMethodPresentation[]): BaseHalfVideoMethodControl {
	if (options.length <= 1) {
		return 'fixed';
	}
	return options.length <= 4 && options.every(option => option.label.length <= SHORT_OPTION_LABEL_LENGTH)
		? 'segmented'
		: 'listbox';
}

function createSettingsSummary(
	resolution: IBaseHalfSupportedVideoCapabilityResolution,
	normalization: BaseHalfVideoSettingsNormalization
): readonly IBaseHalfVideoSettingsSummaryToken[] {
	const tokens: IBaseHalfVideoSettingsSummaryToken[] = [freeze({
		kind: 'method',
		label: 'Method',
		value: baseHalfVideoGenerationModeLabel(resolution.selection.mode)
	})];
	for (const descriptor of [
		{ id: 'aspectRatio', kind: 'aspect-ratio' as const },
		{ id: 'resolution', kind: 'resolution' as const },
		{ id: 'durationSeconds', kind: 'duration' as const },
		{ id: 'duration', kind: 'duration' as const }
	]) {
		const parameter = normalization.parameters.find(candidate => candidate.id === descriptor.id && candidate.visible);
		const value = normalization.values[descriptor.id];
		if (!parameter || value === undefined || tokens.some(token => token.kind === descriptor.kind)) {
			continue;
		}
		const displayValue = parameterValueLabel(parameter, value);
		if (displayValue !== undefined) {
			tokens.push(freeze({ kind: descriptor.kind, parameterId: descriptor.id, label: parameter.label, value: displayValue }));
		}
	}
	for (const id of ['generateAudio', 'audioMode']) {
		const parameter = resolution.capability.parameters.find(candidate => candidate.id === id);
		const state = normalization.parameters.find(candidate => candidate.id === id && candidate.visible);
		const value = normalization.values[id];
		if (!parameter || !state || value === undefined || value === parameter.default) {
			continue;
		}
		const displayValue = parameterValueLabel(state, value);
		if (displayValue !== undefined) {
			tokens.push(freeze({ kind: 'audio', parameterId: id, label: state.label, value: displayValue }));
		}
		break;
	}
	return freeze(tokens);
}

function parameterValueLabel(parameter: IBaseHalfResolvedVideoParameter, value: BaseHalfVideoModelScalar): string | undefined {
	if (parameter.type === 'enum') {
		return parameter.options?.find(option => option.value === value)?.label;
	}
	if (parameter.type === 'boolean') {
		return value === true ? 'On' : value === false ? 'Off' : undefined;
	}
	if (typeof value !== 'number') {
		return undefined;
	}
	return `${formatNumber(value)}${parameter.unit ?? ''}`;
}

function generationModeValueLabel(value: BaseHalfVideoModelScalar | undefined): string | undefined {
	return typeof value === 'string' && [
		'text-to-video',
		'first-frame-to-video',
		'first-last-frame-to-video',
		'reference-to-video',
		'video-edit',
		'video-extension'
	].includes(value)
		? baseHalfVideoGenerationModeLabel(value as BaseHalfVideoGenerationMode)
		: value === undefined ? undefined : 'Previous generation method';
}

function messageRank(kind: BaseHalfVideoMessageKind): number {
	switch (kind) {
		case 'transaction-failure': return 0;
		case 'attempt-problem': return 1;
		case 'model-selection-problem': return 2;
		case 'input-readiness-problem': return 3;
		case 'settings-adjustment': return 4;
		case 'information': return 5;
	}
}

function isBlockingMessage(kind: BaseHalfVideoMessageKind): boolean {
	return kind !== 'settings-adjustment' && kind !== 'information';
}

function freezeMessage(message: IBaseHalfVideoMessage): IBaseHalfVideoMessage {
	return freeze({
		kind: message.kind,
		message: message.message,
		...(message.action ? { action: freeze({ ...message.action }) } : {})
	});
}

function formatNumber(value: number): string {
	return String(Number(value.toPrecision(12)));
}

function reconcileSettings(
	descriptor: IBaseHalfVideoModelDescriptor,
	capability: IBaseHalfVideoModeCapability,
	previousMode: BaseHalfVideoGenerationMode | undefined,
	candidate: unknown,
	inputs: BaseHalfVideoInputState
): BaseHalfVideoModelSettingsReconciliation {
	const resolution: IBaseHalfSupportedVideoCapabilityResolution = freeze({
		status: 'supported',
		descriptor,
		capability,
		selection: freeze({ ...descriptor.key, mode: capability.mode })
	});
	const candidateWithMode = previousMode
		? candidate && typeof candidate === 'object' && !Array.isArray(candidate)
			? { ...(candidate as Record<string, unknown>), generationMode: previousMode }
			: { generationMode: previousMode }
		: candidate;
	const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, inputs, candidateWithMode);
	if (normalization.status === 'unavailable') {
		return freeze({
			status: 'unavailable',
			reason: normalization.reason,
			descriptor,
			capability,
			mode: capability.mode,
			...(previousMode ? { previousMode } : {}),
			methodChanged: previousMode !== undefined && previousMode !== capability.mode,
			normalization
		});
	}
	return freeze({
		status: 'ready',
		descriptor,
		capability,
		mode: capability.mode,
		...(previousMode ? { previousMode } : {}),
		methodChanged: previousMode !== undefined && previousMode !== capability.mode,
		normalization
	});
}

function normalizeTypeaheadText(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function freeze<T extends object>(value: T): Readonly<T> {
	return Object.freeze(value);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral video-model capabilities. The host validates provider
 * catalogs at the extension boundary, then every consumer renders and
 * normalizes the same immutable contract. Provider model ids are data only;
 * this module deliberately contains no model-specific branches.
 */

export const BASEHALF_VIDEO_MODEL_CATALOG_SCHEMA_VERSION = 1 as const;
export const BASEHALF_VIDEO_MODEL_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID = 'generationMode';
/** Reserved recipe-parameter key for a host-owned, nested model selection snapshot. */
export const BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID = 'videoModelSnapshot';

export const BASEHALF_VIDEO_GENERATION_MODES = [
	'text-to-video',
	'first-frame-to-video',
	'first-last-frame-to-video',
	'reference-to-video',
	'video-edit',
	'video-extension'
] as const;

export const BASEHALF_VIDEO_INPUT_KINDS = [
	'text-prompt',
	'first-frame',
	'last-frame',
	'reference-image',
	'reference-video',
	'source-video',
	'audio'
] as const;

export type BaseHalfVideoGenerationMode = typeof BASEHALF_VIDEO_GENERATION_MODES[number];
export type BaseHalfVideoInputKind = typeof BASEHALF_VIDEO_INPUT_KINDS[number];
export type BaseHalfVideoModelScalar = string | number | boolean;
export type BaseHalfVideoSettings = Readonly<Record<string, BaseHalfVideoModelScalar>>;

export interface IBaseHalfVideoModelAvailability {
	readonly status: 'unavailable';
	readonly reason: string;
}

export interface IBaseHalfVideoModelKey {
	readonly provider: string;
	readonly deployment: string;
	readonly region: string;
	readonly modelId: string;
	readonly revision: string;
}

export interface IBaseHalfVideoModelSource {
	readonly url: string;
	/** ISO 8601 calendar date on which the capability data was verified. */
	readonly verifiedAt: string;
}

export interface IBaseHalfVideoInputDefinition {
	readonly kind: BaseHalfVideoInputKind;
	readonly minItems: number;
	readonly maxItems: number;
	/** Required for text prompts; measured after trimming, matching provider requests. */
	readonly maxCharacters?: number;
}

export type IBaseHalfVideoCondition =
	| { readonly kind: 'all'; readonly conditions: readonly IBaseHalfVideoCondition[] }
	| { readonly kind: 'any'; readonly conditions: readonly IBaseHalfVideoCondition[] }
	| { readonly kind: 'not'; readonly condition: IBaseHalfVideoCondition }
	| { readonly kind: 'parameter'; readonly parameterId: string; readonly operator: 'equals' | 'notEquals'; readonly value: BaseHalfVideoModelScalar }
	| { readonly kind: 'parameter'; readonly parameterId: string; readonly operator: 'in' | 'notIn'; readonly values: readonly BaseHalfVideoModelScalar[] }
	| { readonly kind: 'input'; readonly input: BaseHalfVideoInputKind; readonly operator: 'equals' | 'atLeast' | 'atMost'; readonly count: number };

export interface IBaseHalfVideoEnabledCondition {
	readonly condition: IBaseHalfVideoCondition;
	readonly reason: string;
}

interface IBaseHalfVideoParameterBase {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly availability?: IBaseHalfVideoModelAvailability;
	readonly visibleWhen?: IBaseHalfVideoCondition;
	readonly enabledWhen?: IBaseHalfVideoEnabledCondition;
}

export interface IBaseHalfVideoEnumOption {
	readonly value: string | number;
	readonly label: string;
	readonly availability?: IBaseHalfVideoModelAvailability;
}

export interface IBaseHalfVideoEnumParameter extends IBaseHalfVideoParameterBase {
	readonly type: 'enum';
	readonly default: string | number;
	readonly options: readonly IBaseHalfVideoEnumOption[];
}

export interface IBaseHalfVideoRangeParameter extends IBaseHalfVideoParameterBase {
	readonly type: 'range';
	readonly default: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly step: number;
}

export interface IBaseHalfVideoBooleanParameter extends IBaseHalfVideoParameterBase {
	readonly type: 'boolean';
	readonly default: boolean;
}

export type IBaseHalfVideoParameter = IBaseHalfVideoEnumParameter | IBaseHalfVideoRangeParameter | IBaseHalfVideoBooleanParameter;

export type BaseHalfVideoAllowedValues =
	| { readonly kind: 'values'; readonly values: readonly BaseHalfVideoModelScalar[] }
	| { readonly kind: 'range'; readonly minimum: number; readonly maximum: number; readonly step?: number };

/**
 * Narrows one parameter when `when` is true. Multiple active constraints are
 * intersected. This represents dependent matrices such as 1080P -> 6 seconds
 * without embedding provider or model ids in renderer code.
 */
export interface IBaseHalfVideoParameterConstraint {
	readonly id: string;
	readonly targetParameterId: string;
	readonly when?: IBaseHalfVideoCondition;
	readonly allowed: BaseHalfVideoAllowedValues;
	readonly reason: string;
}

export interface IBaseHalfVideoModeCapability {
	readonly mode: BaseHalfVideoGenerationMode;
	readonly availability?: IBaseHalfVideoModelAvailability;
	readonly inputs: readonly IBaseHalfVideoInputDefinition[];
	readonly parameters: readonly IBaseHalfVideoParameter[];
	readonly constraints: readonly IBaseHalfVideoParameterConstraint[];
}

export interface IBaseHalfVideoModelDescriptor {
	readonly key: IBaseHalfVideoModelKey;
	readonly label: string;
	readonly source: IBaseHalfVideoModelSource;
	readonly availability?: IBaseHalfVideoModelAvailability;
	readonly modes: readonly IBaseHalfVideoModeCapability[];
}

export interface IBaseHalfVideoModelCatalog {
	readonly schemaVersion: typeof BASEHALF_VIDEO_MODEL_CATALOG_SCHEMA_VERSION;
	readonly models: readonly IBaseHalfVideoModelDescriptor[];
}

export type BaseHalfVideoInputState = Readonly<Partial<Record<BaseHalfVideoInputKind, number>>>;

export interface IBaseHalfVideoModelSelection extends IBaseHalfVideoModelKey {
	readonly mode: BaseHalfVideoGenerationMode;
	readonly inputs: BaseHalfVideoInputState;
}

/** Structural subset of a configured model service used for exact catalog matching. */
export interface IBaseHalfVideoModelServiceScope {
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
}

/**
 * Host-owned persisted identity for revalidating an attempt immediately before
 * execution. Secrets, endpoints, service labels, and mutable UI state never
 * enter this snapshot.
 */
export interface IBaseHalfVideoModelSelectionSnapshot {
	readonly schemaVersion: typeof BASEHALF_VIDEO_MODEL_SNAPSHOT_SCHEMA_VERSION;
	readonly catalogId: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly modelId: string;
	readonly revision: string;
	readonly mode: BaseHalfVideoGenerationMode;
	readonly inputs: BaseHalfVideoInputState;
}

export interface IBaseHalfSupportedVideoModelResolution {
	readonly status: 'supported';
	readonly descriptor: IBaseHalfVideoModelDescriptor;
	readonly capability: IBaseHalfVideoModeCapability;
	readonly selection: IBaseHalfVideoModelSelection;
}

export interface IBaseHalfUnsupportedVideoModelResolution {
	readonly status: 'unsupported';
	readonly reason: string;
}

export interface IBaseHalfUnavailableVideoModelResolution {
	readonly status: 'unavailable';
	readonly reason: string;
	readonly descriptor: IBaseHalfVideoModelDescriptor;
	readonly capability?: IBaseHalfVideoModeCapability;
}

export type BaseHalfVideoModelResolution =
	| IBaseHalfSupportedVideoModelResolution
	| IBaseHalfUnsupportedVideoModelResolution
	| IBaseHalfUnavailableVideoModelResolution;

export interface IBaseHalfResolvedVideoEnumOption {
	readonly value: string | number;
	readonly label: string;
	readonly enabled: boolean;
	readonly unavailableReason?: string;
}

export interface IBaseHalfResolvedVideoParameter {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly type: IBaseHalfVideoParameter['type'];
	readonly visible: boolean;
	readonly enabled: boolean;
	readonly unavailableReason?: string;
	readonly options?: readonly IBaseHalfResolvedVideoEnumOption[];
	readonly minimum?: number;
	readonly maximum?: number;
	readonly step?: number;
}

export type BaseHalfVideoSettingAdjustmentKind = 'defaulted' | 'constrained' | 'removed';

export interface IBaseHalfVideoSettingAdjustment {
	readonly parameterId: string;
	readonly kind: BaseHalfVideoSettingAdjustmentKind;
	readonly reason: string;
	readonly previousValue?: BaseHalfVideoModelScalar;
	readonly value?: BaseHalfVideoModelScalar;
}

export interface IBaseHalfReadyVideoSettingsNormalization {
	readonly status: 'ready';
	/** Canonical execution/persistence map, including `generationMode`. */
	readonly values: BaseHalfVideoSettings;
	/** Presentation state derived from exactly the same canonical values. */
	readonly parameters: readonly IBaseHalfResolvedVideoParameter[];
	readonly adjustments: readonly IBaseHalfVideoSettingAdjustment[];
}

export interface IBaseHalfUnavailableVideoSettingsNormalization {
	readonly status: 'unavailable';
	readonly reason: string;
	readonly values: BaseHalfVideoSettings;
	readonly parameters: readonly IBaseHalfResolvedVideoParameter[];
	readonly adjustments: readonly IBaseHalfVideoSettingAdjustment[];
}

export type BaseHalfVideoSettingsNormalization = IBaseHalfReadyVideoSettingsNormalization | IBaseHalfUnavailableVideoSettingsNormalization;

export interface IBaseHalfVideoModelRegistry {
	readonly models: readonly IBaseHalfVideoModelDescriptor[];
	resolve(selection: IBaseHalfVideoModelSelection): BaseHalfVideoModelResolution;
}

export function getBaseHalfVideoPromptMaxCharacters(
	resolution: IBaseHalfSupportedVideoModelResolution
): number | undefined {
	return resolution.capability.inputs.find(input => input.kind === 'text-prompt')?.maxCharacters;
}

/** Validates the exact prompt representation sent by the provider adapters. */
export function getBaseHalfVideoPromptProblem(
	resolution: IBaseHalfSupportedVideoModelResolution,
	prompt: string
): string | undefined {
	const input = resolution.capability.inputs.find(candidate => candidate.kind === 'text-prompt');
	if (!input) {
		return undefined;
	}
	const normalized = prompt.trim();
	if (input.minItems > 0 && !normalized) {
		return 'Write a prompt for this generation method.';
	}
	if (input.maxCharacters !== undefined && normalized.length > input.maxCharacters) {
		return `Shorten the prompt to ${input.maxCharacters.toLocaleString('en-US')} characters or fewer for this generation method.`;
	}
	return undefined;
}

export class BaseHalfVideoModelContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfVideoModelContractError';
	}
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const CATALOG_SCOPE_ID_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const CATALOG_REGION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const PARAMETER_ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,63}$/;
const MAX_MODELS = 256;
const MAX_MODES = BASEHALF_VIDEO_GENERATION_MODES.length;
const MAX_INPUT_ITEMS = 32;
const MAX_PROMPT_CHARACTERS = 65_536;
const MAX_PARAMETERS = 48;
const MAX_OPTIONS = 128;
const MAX_CONSTRAINTS = 128;
const MAX_CONDITION_DEPTH = 12;
const MAX_CONDITION_NODES = 256;
const MAX_RANGE_STEPS = 10_000;

/** Parse untrusted extension contribution data and return a deep-frozen copy. */
export function parseBaseHalfVideoModelCatalog(value: unknown): IBaseHalfVideoModelCatalog {
	const catalog = requiredObject(value, 'catalog');
	assertOnlyKeys(catalog, ['schemaVersion', 'models'], 'catalog');
	if (catalog.schemaVersion !== BASEHALF_VIDEO_MODEL_CATALOG_SCHEMA_VERSION) {
		fail(`catalog.schemaVersion must be ${BASEHALF_VIDEO_MODEL_CATALOG_SCHEMA_VERSION}.`);
	}
	const models = requiredArray(catalog.models, 'catalog.models', 0, MAX_MODELS)
		.map((model, index) => parseDescriptor(model, `catalog.models[${index}]`));
	const keys = new Set<string>();
	for (const model of models) {
		const key = modelKey(model.key);
		if (keys.has(key)) {
			fail(`catalog.models contains duplicate exact model key '${formatModelKey(model.key)}'.`);
		}
		keys.add(key);
	}
	return deepFreeze({ schemaVersion: BASEHALF_VIDEO_MODEL_CATALOG_SCHEMA_VERSION, models });
}

/** Build an immutable exact-match registry from an untrusted catalog. */
export function createBaseHalfVideoModelRegistry(value: unknown): IBaseHalfVideoModelRegistry {
	const catalog = parseBaseHalfVideoModelCatalog(value);
	const index = new Map(catalog.models.map(model => [modelKey(model.key), model] as const));
	const registry: IBaseHalfVideoModelRegistry = {
		models: catalog.models,
		resolve(selection): BaseHalfVideoModelResolution {
			const normalizedSelection = normalizeSelection(selection);
			if (typeof normalizedSelection === 'string') {
				return deepFreeze({ status: 'unsupported', reason: normalizedSelection });
			}
			const descriptor = index.get(modelKey(normalizedSelection));
			if (!descriptor) {
				return deepFreeze({
					status: 'unsupported',
					reason: `No reviewed capability matches ${formatModelKey(normalizedSelection)}.`
				});
			}
			const capability = descriptor.modes.find(candidate => candidate.mode === normalizedSelection.mode);
			if (!capability) {
				return deepFreeze({
					status: 'unsupported',
					reason: `Model '${descriptor.label}' does not support mode '${normalizedSelection.mode}'.`
				});
			}
			if (descriptor.availability) {
				return deepFreeze({ status: 'unavailable', reason: descriptor.availability.reason, descriptor, capability });
			}
			if (capability.availability) {
				return deepFreeze({ status: 'unavailable', reason: capability.availability.reason, descriptor, capability });
			}
			const inputProblem = validateCurrentInputs(capability, normalizedSelection.inputs);
			if (inputProblem) {
				return deepFreeze({ status: 'unsupported', reason: inputProblem });
			}
			return deepFreeze({ status: 'supported', descriptor, capability, selection: normalizedSelection });
		}
	};
	return Object.freeze(registry);
}

/** Parse a complete exact selection from an untrusted host or persistence boundary. */
export function parseBaseHalfVideoModelSelection(value: unknown): IBaseHalfVideoModelSelection {
	const candidate = requiredObject(value, 'selection');
	assertOnlyKeys(candidate, ['provider', 'deployment', 'region', 'modelId', 'revision', 'mode', 'inputs'], 'selection');
	const key = parseModelKey({
		provider: candidate.provider,
		deployment: candidate.deployment,
		region: candidate.region,
		modelId: candidate.modelId,
		revision: candidate.revision
	}, 'selection');
	if (!isGenerationMode(candidate.mode)) {
		fail('selection.mode is not a supported generation mode.');
	}
	return deepFreeze({ ...key, mode: candidate.mode, inputs: parseInputState(candidate.inputs, 'selection.inputs') });
}

/** Parse the versioned, host-owned model selection persisted with a draft/attempt. */
export function parseBaseHalfVideoModelSelectionSnapshot(value: unknown, expectedCatalogId: string): IBaseHalfVideoModelSelectionSnapshot {
	const candidate = requiredObject(value, 'snapshot');
	assertOnlyKeys(candidate, ['schemaVersion', 'catalogId', 'providerId', 'deploymentId', 'region', 'modelId', 'revision', 'mode', 'inputs'], 'snapshot');
	if (candidate.schemaVersion !== BASEHALF_VIDEO_MODEL_SNAPSHOT_SCHEMA_VERSION) {
		fail(`snapshot.schemaVersion must be ${BASEHALF_VIDEO_MODEL_SNAPSHOT_SCHEMA_VERSION}.`);
	}
	if (!isGenerationMode(candidate.mode)) {
		fail('snapshot.mode is not a supported generation mode.');
	}
	const catalogId = contributionIdentifier(candidate.catalogId, 'snapshot.catalogId');
	const expected = contributionIdentifier(expectedCatalogId, 'expectedCatalogId');
	if (catalogId !== expected) {
		fail(`snapshot.catalogId must match expected catalog '${expected}'.`);
	}
	return deepFreeze({
		schemaVersion: BASEHALF_VIDEO_MODEL_SNAPSHOT_SCHEMA_VERSION,
		catalogId,
		providerId: catalogScopeIdentifier(candidate.providerId, 'snapshot.providerId'),
		deploymentId: catalogScopeIdentifier(candidate.deploymentId, 'snapshot.deploymentId'),
		region: catalogRegion(candidate.region, 'snapshot.region'),
		modelId: identifier(candidate.modelId, 'snapshot.modelId'),
		revision: identifier(candidate.revision, 'snapshot.revision'),
		mode: candidate.mode,
		inputs: parseInputState(candidate.inputs, 'snapshot.inputs')
	});
}

/** Create the canonical persistence snapshot from a successfully resolved capability. */
export function createBaseHalfVideoModelSelectionSnapshot(
	catalogId: string,
	resolution: IBaseHalfSupportedVideoModelResolution
): IBaseHalfVideoModelSelectionSnapshot {
	return deepFreeze({
		schemaVersion: BASEHALF_VIDEO_MODEL_SNAPSHOT_SCHEMA_VERSION,
		catalogId: contributionIdentifier(catalogId, 'catalogId'),
		providerId: resolution.selection.provider,
		deploymentId: resolution.selection.deployment,
		region: resolution.selection.region,
		modelId: resolution.selection.modelId,
		revision: resolution.selection.revision,
		mode: resolution.selection.mode,
		inputs: resolution.selection.inputs
	});
}

/** Exact structural match between a reviewed descriptor and a configured service scope. */
export function baseHalfVideoModelMatchesServiceScope(
	descriptor: IBaseHalfVideoModelDescriptor,
	scope: IBaseHalfVideoModelServiceScope
): boolean {
	const normalizedScope = normalizeServiceScope(scope);
	return normalizedScope !== undefined
		&& descriptor.key.provider === normalizedScope.providerId
		&& descriptor.key.deployment === normalizedScope.deploymentId
		&& descriptor.key.region === normalizedScope.region;
}

/**
 * Revalidate a persisted selection against both the current service scope and
 * the current reviewed catalog. Invalid/stale data resolves as unsupported;
 * reviewed rollout state remains distinguishable as unavailable.
 */
export function resolveBaseHalfVideoModelSelectionSnapshot(
	registry: IBaseHalfVideoModelRegistry,
	expectedCatalogId: string,
	scope: IBaseHalfVideoModelServiceScope,
	value: unknown
): BaseHalfVideoModelResolution {
	let snapshot: IBaseHalfVideoModelSelectionSnapshot;
	try {
		snapshot = parseBaseHalfVideoModelSelectionSnapshot(value, expectedCatalogId);
	} catch (error) {
		return deepFreeze({
			status: 'unsupported',
			reason: error instanceof BaseHalfVideoModelContractError ? error.message : 'The persisted video model selection is invalid.'
		});
	}
	const normalizedScope = normalizeServiceScope(scope);
	if (!normalizedScope) {
		return deepFreeze({ status: 'unsupported', reason: 'The configured video model service has an invalid catalog scope.' });
	}
	if (snapshot.providerId !== normalizedScope.providerId
		|| snapshot.deploymentId !== normalizedScope.deploymentId
		|| snapshot.region !== normalizedScope.region) {
		return deepFreeze({ status: 'unsupported', reason: 'The persisted video model selection does not match the configured service scope.' });
	}
	return registry.resolve({
		provider: snapshot.providerId,
		deployment: snapshot.deploymentId,
		region: snapshot.region,
		modelId: snapshot.modelId,
		revision: snapshot.revision,
		mode: snapshot.mode,
		inputs: snapshot.inputs
	});
}

/**
 * Preserve compatible candidate values and deterministically repair every
 * incompatible value from schema defaults/declaration order. An impossible
 * constraint intersection fails closed instead of emitting a guessed request.
 */
export function normalizeBaseHalfVideoSettings(
	resolution: IBaseHalfSupportedVideoModelResolution,
	candidate: unknown
): BaseHalfVideoSettingsNormalization {
	const capability = resolution.capability;
	const candidateValues = scalarRecord(candidate);
	const working: Record<string, BaseHalfVideoModelScalar> = {};
	for (const parameter of capability.parameters) {
		const proposed = candidateValues[parameter.id];
		working[parameter.id] = proposed !== undefined && isBaseValue(parameter, proposed) && isStaticallyAvailable(parameter, proposed)
			? proposed
			: parameter.default;
	}

	let failure: { parameterId: string; reason: string } | undefined;
	const iterationLimit = Math.max(8, capability.parameters.length * 4);
	for (let iteration = 0; iteration < iterationLimit; iteration++) {
		let changed = false;
		for (const parameter of capability.parameters) {
			const state = basicParameterState(parameter, working, resolution.selection.inputs);
			if (!state.visible || !state.enabled) {
				continue;
			}
			const constraints = activeConstraints(capability, parameter.id, working, resolution.selection.inputs);
			if (isAllowed(parameter, working[parameter.id], constraints)) {
				continue;
			}
			const replacement = firstAllowedValue(parameter, constraints);
			if (replacement === undefined) {
				failure = {
					parameterId: parameter.id,
					reason: constraints.map(constraint => constraint.reason).join(' ') || `No available value remains for '${parameter.label}'.`
				};
				break;
			}
			if (!scalarEquals(working[parameter.id], replacement)) {
				working[parameter.id] = replacement;
				changed = true;
			}
		}
		if (failure || !changed) {
			break;
		}
		if (iteration === iterationLimit - 1) {
			failure = { parameterId: '', reason: 'Video settings did not converge under the declared capability constraints.' };
		}
	}

	const parameterStates = capability.parameters.map(parameter => resolvedParameterState(
		parameter,
		working,
		resolution.selection.inputs,
		activeConstraints(capability, parameter.id, working, resolution.selection.inputs)
	));
	const values: Record<string, BaseHalfVideoModelScalar> = {
		[BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID]: resolution.selection.mode
	};
	for (let index = 0; index < capability.parameters.length; index++) {
		if (parameterStates[index].visible && parameterStates[index].enabled) {
			values[capability.parameters[index].id] = working[capability.parameters[index].id];
		}
	}
	const adjustments = buildAdjustments(capability, candidateValues, values, parameterStates, resolution.selection.mode);
	const frozenValues = deepFreeze(values);
	const frozenParameters = deepFreeze(parameterStates);
	const frozenAdjustments = deepFreeze(adjustments);
	if (failure) {
		return deepFreeze({
			status: 'unavailable',
			reason: failure.parameterId ? `${failure.parameterId}: ${failure.reason}` : failure.reason,
			values: frozenValues,
			parameters: frozenParameters,
			adjustments: frozenAdjustments
		});
	}
	return deepFreeze({ status: 'ready', values: frozenValues, parameters: frozenParameters, adjustments: frozenAdjustments });
}

function parseDescriptor(value: unknown, path: string): IBaseHalfVideoModelDescriptor {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['key', 'label', 'source', 'availability', 'modes'], path);
	const key = parseModelKey(candidate.key, `${path}.key`);
	const label = boundedText(candidate.label, `${path}.label`, 100);
	const source = parseSource(candidate.source, `${path}.source`);
	const availability = candidate.availability === undefined ? undefined : parseAvailability(candidate.availability, `${path}.availability`);
	const modes = requiredArray(candidate.modes, `${path}.modes`, 1, MAX_MODES)
		.map((mode, index) => parseMode(mode, `${path}.modes[${index}]`));
	assertUnique(modes.map(mode => mode.mode), `${path}.modes`);
	return { key, label, source, ...(availability ? { availability } : {}), modes };
}

function parseModelKey(value: unknown, path: string): IBaseHalfVideoModelKey {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['provider', 'deployment', 'region', 'modelId', 'revision'], path);
	return {
		provider: catalogScopeIdentifier(candidate.provider, `${path}.provider`),
		deployment: catalogScopeIdentifier(candidate.deployment, `${path}.deployment`),
		region: catalogRegion(candidate.region, `${path}.region`),
		modelId: identifier(candidate.modelId, `${path}.modelId`),
		revision: identifier(candidate.revision, `${path}.revision`)
	};
}

function parseSource(value: unknown, path: string): IBaseHalfVideoModelSource {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['url', 'verifiedAt'], path);
	const rawUrl = boundedText(candidate.url, `${path}.url`, 2_048);
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		fail(`${path}.url must be an absolute HTTPS URL.`);
	}
	if (url!.protocol !== 'https:' || url!.username || url!.password) {
		fail(`${path}.url must be an HTTPS URL without embedded credentials.`);
	}
	const verifiedAt = boundedText(candidate.verifiedAt, `${path}.verifiedAt`, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt) || Number.isNaN(Date.parse(`${verifiedAt}T00:00:00Z`))) {
		fail(`${path}.verifiedAt must be an ISO 8601 calendar date.`);
	}
	return { url: url!.toString(), verifiedAt };
}

function parseAvailability(value: unknown, path: string): IBaseHalfVideoModelAvailability {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['status', 'reason'], path);
	if (candidate.status !== 'unavailable') {
		fail(`${path}.status must be 'unavailable'. Omit availability for supported values.`);
	}
	return { status: 'unavailable', reason: boundedText(candidate.reason, `${path}.reason`, 300) };
}

function parseMode(value: unknown, path: string): IBaseHalfVideoModeCapability {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['mode', 'availability', 'inputs', 'parameters', 'constraints'], path);
	if (!isGenerationMode(candidate.mode)) {
		fail(`${path}.mode is not a supported generation mode.`);
	}
	const availability = candidate.availability === undefined ? undefined : parseAvailability(candidate.availability, `${path}.availability`);
	const inputs = requiredArray(candidate.inputs, `${path}.inputs`, 0, BASEHALF_VIDEO_INPUT_KINDS.length)
		.map((input, index) => parseInput(input, `${path}.inputs[${index}]`));
	assertUnique(inputs.map(input => input.kind), `${path}.inputs`);
	const parameters = requiredArray(candidate.parameters, `${path}.parameters`, 0, MAX_PARAMETERS)
		.map((parameter, index) => parseParameter(parameter, `${path}.parameters[${index}]`));
	assertUnique(parameters.map(parameter => parameter.id), `${path}.parameters`);
	const reservedParameter = parameters.find(parameter => parameter.id === BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID
		|| parameter.id === BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID);
	if (reservedParameter) {
		fail(`${path}.parameters must not redefine reserved parameter '${reservedParameter.id}'.`);
	}
	const constraints = candidate.constraints === undefined
		? []
		: requiredArray(candidate.constraints, `${path}.constraints`, 0, MAX_CONSTRAINTS)
			.map((constraint, index) => parseConstraint(constraint, `${path}.constraints[${index}]`));
	assertUnique(constraints.map(constraint => constraint.id), `${path}.constraints`);
	validateModeReferences(parameters, inputs, constraints, path);
	return { mode: candidate.mode, ...(availability ? { availability } : {}), inputs, parameters, constraints };
}

function parseInput(value: unknown, path: string): IBaseHalfVideoInputDefinition {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['kind', 'minItems', 'maxItems', 'maxCharacters'], path);
	if (!isInputKind(candidate.kind)) {
		fail(`${path}.kind is not a supported video input kind.`);
	}
	const minItems = boundedInteger(candidate.minItems, `${path}.minItems`, 0, MAX_INPUT_ITEMS);
	const maxItems = boundedInteger(candidate.maxItems, `${path}.maxItems`, 0, MAX_INPUT_ITEMS);
	if (maxItems < minItems) {
		fail(`${path}.maxItems must be greater than or equal to minItems.`);
	}
	if (candidate.kind === 'text-prompt') {
		const maxCharacters = boundedInteger(candidate.maxCharacters, `${path}.maxCharacters`, 1, MAX_PROMPT_CHARACTERS);
		return { kind: candidate.kind, minItems, maxItems, maxCharacters };
	}
	if (candidate.maxCharacters !== undefined) {
		fail(`${path}.maxCharacters is supported only for text-prompt inputs.`);
	}
	return { kind: candidate.kind, minItems, maxItems };
}

function parseParameter(value: unknown, path: string): IBaseHalfVideoParameter {
	const candidate = requiredObject(value, path);
	const type = candidate.type;
	const commonKeys = ['id', 'label', 'description', 'availability', 'visibleWhen', 'enabledWhen', 'type', 'default'];
	const id = parameterId(candidate.id, `${path}.id`);
	const label = boundedText(candidate.label, `${path}.label`, 100);
	const description = candidate.description === undefined ? undefined : boundedText(candidate.description, `${path}.description`, 300);
	const availability = candidate.availability === undefined ? undefined : parseAvailability(candidate.availability, `${path}.availability`);
	const visibleWhen = candidate.visibleWhen === undefined ? undefined : parseCondition(candidate.visibleWhen, `${path}.visibleWhen`);
	const enabledWhen = candidate.enabledWhen === undefined ? undefined : parseEnabledWhen(candidate.enabledWhen, `${path}.enabledWhen`);
	const common = { id, label, ...(description ? { description } : {}), ...(availability ? { availability } : {}), ...(visibleWhen ? { visibleWhen } : {}), ...(enabledWhen ? { enabledWhen } : {}) };
	if (type === 'enum') {
		assertOnlyKeys(candidate, [...commonKeys, 'options'], path);
		const defaultValue = stringOrNumber(candidate.default, `${path}.default`);
		const options = requiredArray(candidate.options, `${path}.options`, 1, MAX_OPTIONS)
			.map((option, index) => parseEnumOption(option, `${path}.options[${index}]`));
		assertUnique(options.map(option => scalarKey(option.value)), `${path}.options`);
		const defaultOption = options.find(option => scalarEquals(option.value, defaultValue));
		if (!defaultOption || defaultOption.availability) {
			fail(`${path}.default must identify an available declared option.`);
		}
		return { ...common, type, default: defaultValue, options };
	}
	if (type === 'range') {
		assertOnlyKeys(candidate, [...commonKeys, 'minimum', 'maximum', 'step'], path);
		const minimum = finiteNumber(candidate.minimum, `${path}.minimum`);
		const maximum = finiteNumber(candidate.maximum, `${path}.maximum`);
		const step = finiteNumber(candidate.step, `${path}.step`);
		const defaultValue = finiteNumber(candidate.default, `${path}.default`);
		if (maximum < minimum || step <= 0 || (maximum - minimum) / step > MAX_RANGE_STEPS || !onRangeGrid(defaultValue, minimum, maximum, step)) {
			fail(`${path} must declare a finite ordered range, at most ${MAX_RANGE_STEPS} steps, and an on-grid default.`);
		}
		return { ...common, type, default: defaultValue, minimum, maximum, step };
	}
	if (type === 'boolean') {
		assertOnlyKeys(candidate, commonKeys, path);
		if (typeof candidate.default !== 'boolean') {
			fail(`${path}.default must be a boolean.`);
		}
		return { ...common, type, default: candidate.default };
	}
	fail(`${path}.type must be 'enum', 'range', or 'boolean'.`);
}

function parseEnumOption(value: unknown, path: string): IBaseHalfVideoEnumOption {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['value', 'label', 'availability'], path);
	const optionValue = stringOrNumber(candidate.value, `${path}.value`);
	const label = boundedText(candidate.label, `${path}.label`, 100);
	const availability = candidate.availability === undefined ? undefined : parseAvailability(candidate.availability, `${path}.availability`);
	return { value: optionValue, label, ...(availability ? { availability } : {}) };
}

function parseEnabledWhen(value: unknown, path: string): IBaseHalfVideoEnabledCondition {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['condition', 'reason'], path);
	return {
		condition: parseCondition(candidate.condition, `${path}.condition`),
		reason: boundedText(candidate.reason, `${path}.reason`, 300)
	};
}

function parseCondition(value: unknown, path: string, depth = 0, budget = { nodes: 0 }): IBaseHalfVideoCondition {
	if (depth > MAX_CONDITION_DEPTH || ++budget.nodes > MAX_CONDITION_NODES) {
		fail(`${path} exceeds the condition complexity limit.`);
	}
	const candidate = requiredObject(value, path);
	if (candidate.kind === 'all' || candidate.kind === 'any') {
		assertOnlyKeys(candidate, ['kind', 'conditions'], path);
		const conditions = requiredArray(candidate.conditions, `${path}.conditions`, 1, MAX_CONDITION_NODES)
			.map((condition, index) => parseCondition(condition, `${path}.conditions[${index}]`, depth + 1, budget));
		return { kind: candidate.kind, conditions };
	}
	if (candidate.kind === 'not') {
		assertOnlyKeys(candidate, ['kind', 'condition'], path);
		return { kind: 'not', condition: parseCondition(candidate.condition, `${path}.condition`, depth + 1, budget) };
	}
	if (candidate.kind === 'parameter') {
		const id = parameterId(candidate.parameterId, `${path}.parameterId`);
		if (candidate.operator === 'equals' || candidate.operator === 'notEquals') {
			assertOnlyKeys(candidate, ['kind', 'parameterId', 'operator', 'value'], path);
			return { kind: 'parameter', parameterId: id, operator: candidate.operator, value: scalar(candidate.value, `${path}.value`) };
		}
		if (candidate.operator === 'in' || candidate.operator === 'notIn') {
			assertOnlyKeys(candidate, ['kind', 'parameterId', 'operator', 'values'], path);
			const values = requiredArray(candidate.values, `${path}.values`, 1, MAX_OPTIONS).map((entry, index) => scalar(entry, `${path}.values[${index}]`));
			assertUnique(values.map(scalarKey), `${path}.values`);
			return { kind: 'parameter', parameterId: id, operator: candidate.operator, values };
		}
		fail(`${path}.operator is invalid for a parameter condition.`);
	}
	if (candidate.kind === 'input') {
		assertOnlyKeys(candidate, ['kind', 'input', 'operator', 'count'], path);
		if (!isInputKind(candidate.input) || (candidate.operator !== 'equals' && candidate.operator !== 'atLeast' && candidate.operator !== 'atMost')) {
			fail(`${path} is not a valid input condition.`);
		}
		return {
			kind: 'input',
			input: candidate.input,
			operator: candidate.operator,
			count: boundedInteger(candidate.count, `${path}.count`, 0, MAX_INPUT_ITEMS)
		};
	}
	fail(`${path}.kind is not a supported condition kind.`);
}

function parseConstraint(value: unknown, path: string): IBaseHalfVideoParameterConstraint {
	const candidate = requiredObject(value, path);
	assertOnlyKeys(candidate, ['id', 'targetParameterId', 'when', 'allowed', 'reason'], path);
	const when = candidate.when === undefined ? undefined : parseCondition(candidate.when, `${path}.when`);
	return {
		id: parameterId(candidate.id, `${path}.id`),
		targetParameterId: parameterId(candidate.targetParameterId, `${path}.targetParameterId`),
		...(when ? { when } : {}),
		allowed: parseAllowed(candidate.allowed, `${path}.allowed`),
		reason: boundedText(candidate.reason, `${path}.reason`, 300)
	};
}

function parseAllowed(value: unknown, path: string): BaseHalfVideoAllowedValues {
	const candidate = requiredObject(value, path);
	if (candidate.kind === 'values') {
		assertOnlyKeys(candidate, ['kind', 'values'], path);
		const values = requiredArray(candidate.values, `${path}.values`, 1, MAX_OPTIONS).map((entry, index) => scalar(entry, `${path}.values[${index}]`));
		assertUnique(values.map(scalarKey), `${path}.values`);
		return { kind: 'values', values };
	}
	if (candidate.kind === 'range') {
		assertOnlyKeys(candidate, ['kind', 'minimum', 'maximum', 'step'], path);
		const minimum = finiteNumber(candidate.minimum, `${path}.minimum`);
		const maximum = finiteNumber(candidate.maximum, `${path}.maximum`);
		const step = candidate.step === undefined ? undefined : finiteNumber(candidate.step, `${path}.step`);
		if (maximum < minimum || (step !== undefined && step <= 0)) {
			fail(`${path} must be an ordered finite range with a positive optional step.`);
		}
		return { kind: 'range', minimum, maximum, ...(step !== undefined ? { step } : {}) };
	}
	fail(`${path}.kind must be 'values' or 'range'.`);
}

function validateModeReferences(
	parameters: readonly IBaseHalfVideoParameter[],
	inputs: readonly IBaseHalfVideoInputDefinition[],
	constraints: readonly IBaseHalfVideoParameterConstraint[],
	path: string
): void {
	const parameterMap = new Map(parameters.map(parameter => [parameter.id, parameter] as const));
	const inputSet = new Set(inputs.map(input => input.kind));
	for (const parameter of parameters) {
		if (parameter.visibleWhen) {
			validateConditionReferences(parameter.visibleWhen, parameterMap, inputSet, `${path}.parameters.${parameter.id}.visibleWhen`);
		}
		if (parameter.enabledWhen) {
			validateConditionReferences(parameter.enabledWhen.condition, parameterMap, inputSet, `${path}.parameters.${parameter.id}.enabledWhen`);
		}
	}
	for (const constraint of constraints) {
		const target = parameterMap.get(constraint.targetParameterId);
		if (!target) {
			fail(`${path}.constraints.${constraint.id} references unknown target '${constraint.targetParameterId}'.`);
		}
		if (constraint.when) {
			validateConditionReferences(constraint.when, parameterMap, inputSet, `${path}.constraints.${constraint.id}.when`);
		}
		validateAllowedForParameter(constraint.allowed, target!, `${path}.constraints.${constraint.id}.allowed`);
	}
}

function validateConditionReferences(
	condition: IBaseHalfVideoCondition,
	parameters: ReadonlyMap<string, IBaseHalfVideoParameter>,
	inputs: ReadonlySet<BaseHalfVideoInputKind>,
	path: string
): void {
	if (condition.kind === 'all' || condition.kind === 'any') {
		condition.conditions.forEach((child, index) => validateConditionReferences(child, parameters, inputs, `${path}.conditions[${index}]`));
		return;
	}
	if (condition.kind === 'not') {
		validateConditionReferences(condition.condition, parameters, inputs, `${path}.condition`);
		return;
	}
	if (condition.kind === 'input') {
		if (!inputs.has(condition.input)) {
			fail(`${path} references undeclared input '${condition.input}'.`);
		}
		return;
	}
	const parameter = parameters.get(condition.parameterId);
	if (!parameter) {
		fail(`${path} references unknown parameter '${condition.parameterId}'.`);
	}
	let values: readonly BaseHalfVideoModelScalar[];
	switch (condition.operator) {
		case 'equals':
		case 'notEquals':
			values = [condition.value];
			break;
		case 'in':
		case 'notIn':
			values = condition.values;
			break;
	}
	if (values.some(value => !isBaseValue(parameter!, value))) {
		fail(`${path} compares '${condition.parameterId}' with a value outside its declared type/domain.`);
	}
}

function validateAllowedForParameter(allowed: BaseHalfVideoAllowedValues, parameter: IBaseHalfVideoParameter, path: string): void {
	if (allowed.kind === 'range') {
		if (parameter.type !== 'range'
			|| allowed.minimum < parameter.minimum
			|| allowed.maximum > parameter.maximum
			|| !onRangeGrid(allowed.minimum, parameter.minimum, parameter.maximum, parameter.step)
			|| !onRangeGrid(allowed.maximum, parameter.minimum, parameter.maximum, parameter.step)
			|| (allowed.step !== undefined && !isStepMultiple(allowed.step, parameter.step))) {
			fail(`${path} must narrow the target range on its declared grid.`);
		}
		return;
	}
	if (allowed.values.some(value => !isBaseValue(parameter, value))) {
		fail(`${path} contains a value outside the target parameter domain.`);
	}
}

function normalizeSelection(selection: IBaseHalfVideoModelSelection): IBaseHalfVideoModelSelection | string {
	try {
		return parseBaseHalfVideoModelSelection(selection);
	} catch (error) {
		return error instanceof BaseHalfVideoModelContractError ? error.message : 'Video model selection is invalid.';
	}
}

function parseInputState(value: unknown, path: string): BaseHalfVideoInputState {
	const candidate = requiredObject(value, path);
	const inputs: Partial<Record<BaseHalfVideoInputKind, number>> = {};
	for (const [kind, count] of Object.entries(candidate)) {
		if (!isInputKind(kind)) {
			fail(`${path}.${kind} is not a supported video input kind.`);
		}
		const normalizedCount = boundedInteger(count, `${path}.${kind}`, 0, MAX_INPUT_ITEMS);
		if (normalizedCount > 0) {
			inputs[kind] = normalizedCount;
		}
	}
	return deepFreeze(inputs);
}

function normalizeServiceScope(value: IBaseHalfVideoModelServiceScope): IBaseHalfVideoModelServiceScope | undefined {
	if (!value || typeof value !== 'object'
		|| typeof value.providerId !== 'string' || !CATALOG_SCOPE_ID_PATTERN.test(value.providerId)
		|| typeof value.deploymentId !== 'string' || !CATALOG_SCOPE_ID_PATTERN.test(value.deploymentId)
		|| typeof value.region !== 'string' || !CATALOG_REGION_PATTERN.test(value.region)) {
		return undefined;
	}
	return deepFreeze({ providerId: value.providerId, deploymentId: value.deploymentId, region: value.region });
}

function validateCurrentInputs(capability: IBaseHalfVideoModeCapability, inputs: BaseHalfVideoInputState): string | undefined {
	const definitions = new Map(capability.inputs.map(input => [input.kind, input] as const));
	for (const kind of BASEHALF_VIDEO_INPUT_KINDS) {
		const count = inputs[kind] ?? 0;
		const definition = definitions.get(kind);
		if (!definition && count > 0) {
			return `Mode '${capability.mode}' does not support input '${kind}'.`;
		}
		if (definition && (count < definition.minItems || count > definition.maxItems)) {
			return `Mode '${capability.mode}' requires '${kind}' count between ${definition.minItems} and ${definition.maxItems}; received ${count}.`;
		}
	}
	return undefined;
}

function basicParameterState(
	parameter: IBaseHalfVideoParameter,
	values: BaseHalfVideoSettings,
	inputs: BaseHalfVideoInputState
): { visible: boolean; enabled: boolean; unavailableReason?: string } {
	const visible = parameter.visibleWhen ? evaluateCondition(parameter.visibleWhen, values, inputs) : true;
	if (!visible) {
		return { visible: false, enabled: false };
	}
	if (parameter.availability) {
		return { visible: true, enabled: false, unavailableReason: parameter.availability.reason };
	}
	if (parameter.enabledWhen && !evaluateCondition(parameter.enabledWhen.condition, values, inputs)) {
		return { visible: true, enabled: false, unavailableReason: parameter.enabledWhen.reason };
	}
	return { visible: true, enabled: true };
}

function resolvedParameterState(
	parameter: IBaseHalfVideoParameter,
	values: BaseHalfVideoSettings,
	inputs: BaseHalfVideoInputState,
	constraints: readonly IBaseHalfVideoParameterConstraint[]
): IBaseHalfResolvedVideoParameter {
	const state = basicParameterState(parameter, values, inputs);
	const common = {
		id: parameter.id,
		label: parameter.label,
		...(parameter.description ? { description: parameter.description } : {}),
		type: parameter.type,
		visible: state.visible,
		enabled: state.enabled,
		...(state.unavailableReason ? { unavailableReason: state.unavailableReason } : {})
	};
	if (parameter.type === 'enum') {
		return {
			...common,
			options: parameter.options.map(option => {
				const constraintReason = constraints.find(constraint => !allowedBy(constraint.allowed, option.value))?.reason;
				const reason = option.availability?.reason ?? constraintReason;
				return {
					value: option.value,
					label: option.label,
					enabled: state.enabled && !reason,
					...(reason ? { unavailableReason: reason } : {})
				};
			})
		};
	}
	if (parameter.type === 'range') {
		const ranges = constraints.filter(constraint => constraint.allowed.kind === 'range').map(constraint => constraint.allowed as Extract<BaseHalfVideoAllowedValues, { kind: 'range' }>);
		return {
			...common,
			minimum: Math.max(parameter.minimum, ...ranges.map(range => range.minimum)),
			maximum: Math.min(parameter.maximum, ...ranges.map(range => range.maximum)),
			step: parameter.step
		};
	}
	return common;
}

function activeConstraints(
	capability: IBaseHalfVideoModeCapability,
	parameterIdValue: string,
	values: BaseHalfVideoSettings,
	inputs: BaseHalfVideoInputState
): readonly IBaseHalfVideoParameterConstraint[] {
	return capability.constraints.filter(constraint => constraint.targetParameterId === parameterIdValue
		&& (!constraint.when || evaluateCondition(constraint.when, values, inputs)));
}

function evaluateCondition(condition: IBaseHalfVideoCondition, values: BaseHalfVideoSettings, inputs: BaseHalfVideoInputState): boolean {
	if (condition.kind === 'all') {
		return condition.conditions.every(child => evaluateCondition(child, values, inputs));
	}
	if (condition.kind === 'any') {
		return condition.conditions.some(child => evaluateCondition(child, values, inputs));
	}
	if (condition.kind === 'not') {
		return !evaluateCondition(condition.condition, values, inputs);
	}
	if (condition.kind === 'input') {
		const count = inputs[condition.input] ?? 0;
		return condition.operator === 'equals' ? count === condition.count
			: condition.operator === 'atLeast' ? count >= condition.count
				: count <= condition.count;
	}
	const value = values[condition.parameterId];
	switch (condition.operator) {
		case 'equals':
			return scalarEquals(value, condition.value);
		case 'notEquals':
			return !scalarEquals(value, condition.value);
		case 'in': {
			return condition.values.some(candidate => scalarEquals(candidate, value));
		}
		case 'notIn':
			return !condition.values.some(candidate => scalarEquals(candidate, value));
	}
}

function firstAllowedValue(
	parameter: IBaseHalfVideoParameter,
	constraints: readonly IBaseHalfVideoParameterConstraint[]
): BaseHalfVideoModelScalar | undefined {
	if (isAllowed(parameter, parameter.default, constraints)) {
		return parameter.default;
	}
	if (parameter.type === 'enum') {
		return parameter.options.find(option => !option.availability && isAllowed(parameter, option.value, constraints))?.value;
	}
	if (parameter.type === 'boolean') {
		return [false, true].find(value => isAllowed(parameter, value, constraints));
	}
	const valueConstraints = constraints.filter(constraint => constraint.allowed.kind === 'values');
	if (valueConstraints.length) {
		for (const value of (valueConstraints[0].allowed as Extract<BaseHalfVideoAllowedValues, { kind: 'values' }>).values) {
			if (isAllowed(parameter, value, constraints)) {
				return value;
			}
		}
		return undefined;
	}
	for (let index = 0; index <= MAX_RANGE_STEPS; index++) {
		const value = normalizedNumber(parameter.minimum + index * parameter.step);
		if (value > parameter.maximum + Number.EPSILON) {
			break;
		}
		if (isAllowed(parameter, value, constraints)) {
			return value;
		}
	}
	return undefined;
}

function isAllowed(
	parameter: IBaseHalfVideoParameter,
	value: BaseHalfVideoModelScalar,
	constraints: readonly IBaseHalfVideoParameterConstraint[]
): boolean {
	return isBaseValue(parameter, value)
		&& isStaticallyAvailable(parameter, value)
		&& constraints.every(constraint => allowedBy(constraint.allowed, value));
}

function allowedBy(allowed: BaseHalfVideoAllowedValues, value: BaseHalfVideoModelScalar): boolean {
	if (allowed.kind === 'values') {
		return allowed.values.some(candidate => scalarEquals(candidate, value));
	}
	return typeof value === 'number'
		&& value >= allowed.minimum - Number.EPSILON
		&& value <= allowed.maximum + Number.EPSILON
		&& (allowed.step === undefined || onRangeGrid(value, allowed.minimum, allowed.maximum, allowed.step));
}

function isBaseValue(parameter: IBaseHalfVideoParameter, value: BaseHalfVideoModelScalar): boolean {
	if (parameter.type === 'enum') {
		return (typeof value === 'string' || typeof value === 'number')
			&& parameter.options.some(option => scalarEquals(option.value, value));
	}
	if (parameter.type === 'range') {
		return typeof value === 'number' && onRangeGrid(value, parameter.minimum, parameter.maximum, parameter.step);
	}
	return typeof value === 'boolean';
}

function isStaticallyAvailable(parameter: IBaseHalfVideoParameter, value: BaseHalfVideoModelScalar): boolean {
	return parameter.type !== 'enum' || !parameter.options.find(option => scalarEquals(option.value, value))?.availability;
}

function buildAdjustments(
	capability: IBaseHalfVideoModeCapability,
	candidate: BaseHalfVideoSettings,
	values: BaseHalfVideoSettings,
	states: readonly IBaseHalfResolvedVideoParameter[],
	mode: BaseHalfVideoGenerationMode
): IBaseHalfVideoSettingAdjustment[] {
	const adjustments: IBaseHalfVideoSettingAdjustment[] = [];
	const known = new Set([BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID, ...capability.parameters.map(parameter => parameter.id)]);
	for (const [id, previousValue] of Object.entries(candidate)) {
		if (!known.has(id)) {
			adjustments.push({ parameterId: id, kind: 'removed', reason: 'The selected model does not declare this setting.', previousValue });
		}
	}
	const candidateMode = candidate[BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID];
	if (candidateMode !== undefined && !scalarEquals(candidateMode, mode)) {
		adjustments.push({ parameterId: BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID, kind: 'constrained', reason: 'Generation mode is fixed by the resolved model capability.', previousValue: candidateMode, value: mode });
	}
	for (let index = 0; index < capability.parameters.length; index++) {
		const parameter = capability.parameters[index];
		const previousValue = candidate[parameter.id];
		const value = values[parameter.id];
		if (value === undefined) {
			if (previousValue !== undefined) {
				const state = states[index];
				adjustments.push({
					parameterId: parameter.id,
					kind: 'removed',
					reason: state.visible ? (state.unavailableReason ?? 'The setting is disabled in this context.') : 'The setting is not supported in this context.',
					previousValue
				});
			}
			continue;
		}
		if (previousValue === undefined) {
			adjustments.push({ parameterId: parameter.id, kind: 'defaulted', reason: 'No compatible saved value was present.', value });
		} else if (!scalarEquals(previousValue, value)) {
			adjustments.push({ parameterId: parameter.id, kind: 'constrained', reason: 'The saved value is incompatible with the resolved model capability.', previousValue, value });
		}
	}
	return adjustments;
}

function scalarRecord(value: unknown): BaseHalfVideoSettings {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return Object.freeze({});
	}
	const result: Record<string, BaseHalfVideoModelScalar> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (PARAMETER_ID_PATTERN.test(key) && (typeof entry === 'string' || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)))) {
			result[key] = entry;
		}
	}
	return Object.freeze(result);
}

function modelKey(value: IBaseHalfVideoModelKey): string {
	return JSON.stringify([value.provider, value.deployment, value.region, value.modelId, value.revision]);
}

function formatModelKey(value: IBaseHalfVideoModelKey): string {
	return `${value.provider}/${value.deployment}/${value.region}/${value.modelId}@${value.revision}`;
}

function onRangeGrid(value: number, minimum: number, maximum: number, step: number): boolean {
	if (!Number.isFinite(value) || value < minimum - Number.EPSILON || value > maximum + Number.EPSILON) {
		return false;
	}
	const steps = (value - minimum) / step;
	return Math.abs(steps - Math.round(steps)) <= 1e-8;
}

function isStepMultiple(value: number, base: number): boolean {
	const multiple = value / base;
	return Math.abs(multiple - Math.round(multiple)) <= 1e-8;
}

function normalizedNumber(value: number): number {
	return Number(value.toPrecision(12));
}

function scalarEquals(left: BaseHalfVideoModelScalar | undefined, right: BaseHalfVideoModelScalar | undefined): boolean {
	return typeof left === typeof right && left === right;
}

function scalarKey(value: BaseHalfVideoModelScalar): string {
	return `${typeof value}:${String(value)}`;
}

function isGenerationMode(value: unknown): value is BaseHalfVideoGenerationMode {
	return typeof value === 'string' && (BASEHALF_VIDEO_GENERATION_MODES as readonly string[]).includes(value);
}

function isInputKind(value: unknown): value is BaseHalfVideoInputKind {
	return typeof value === 'string' && (BASEHALF_VIDEO_INPUT_KINDS as readonly string[]).includes(value);
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		fail(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requiredArray(value: unknown, path: string, minimum: number, maximum: number): unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		fail(`${path} must contain between ${minimum} and ${maximum} items.`);
	}
	return value;
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	const allowed = new Set(keys);
	const unknown = Object.keys(value).find(key => !allowed.has(key));
	if (unknown) {
		fail(`${path}.${unknown} is not part of the video model contract.`);
	}
}

function assertUnique(values: readonly string[], path: string): void {
	if (new Set(values).size !== values.length) {
		fail(`${path} contains duplicate identifiers or values.`);
	}
}

function identifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
		fail(`${path} must be a non-empty exact identifier.`);
	}
	return value;
}

function catalogScopeIdentifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || !CATALOG_SCOPE_ID_PATTERN.test(value)) {
		fail(`${path} must be a canonical lowercase provider or deployment identifier.`);
	}
	return value;
}

function catalogRegion(value: unknown, path: string): string {
	if (typeof value !== 'string' || !CATALOG_REGION_PATTERN.test(value)) {
		fail(`${path} must be a canonical lowercase region identifier.`);
	}
	return value;
}

function contributionIdentifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length > 128 || !CONTRIBUTION_ID_PATTERN.test(value)) {
		fail(`${path} must be a canonical complete contribution identifier.`);
	}
	return value;
}

function parameterId(value: unknown, path: string): string {
	if (typeof value !== 'string' || !PARAMETER_ID_PATTERN.test(value)) {
		fail(`${path} must be a lower-camel-case parameter identifier.`);
	}
	return value;
}

function boundedText(value: unknown, path: string, maximum: number): string {
	if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(value)) {
		fail(`${path} must be non-empty, trimmed text of at most ${maximum} characters.`);
	}
	return value;
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		fail(`${path} must be an integer between ${minimum} and ${maximum}.`);
	}
	return value as number;
}

function finiteNumber(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		fail(`${path} must be a finite number.`);
	}
	return value;
}

function stringOrNumber(value: unknown, path: string): string | number {
	if ((typeof value !== 'string' || !value || value.length > 100) && (typeof value !== 'number' || !Number.isFinite(value))) {
		fail(`${path} must be a bounded string or finite number.`);
	}
	return value as string | number;
}

function scalar(value: unknown, path: string): BaseHalfVideoModelScalar {
	if (typeof value === 'boolean') {
		return value;
	}
	return stringOrNumber(value, path);
}

function fail(message: string): never {
	throw new BaseHalfVideoModelContractError(message);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}

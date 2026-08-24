/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type VideoProviderScalar = string | number | boolean;

export interface VideoProviderModelSelection {
	readonly provider: string;
	readonly deployment: string;
	readonly region: string;
	readonly modelId: string;
	readonly revision: string;
}

export interface VideoProviderInputSnapshot {
	readonly prompt: string;
	readonly firstFrame?: string;
	readonly lastFrame?: string;
	/** Provider-visible order is preserved for character/reference numbering. */
	readonly references?: readonly {
		readonly kind: 'image' | 'video';
		readonly resource: string;
	}[];
	readonly sourceVideo?: string;
	readonly audio?: readonly string[];
}

export interface VideoProviderSubmission {
	readonly selection: VideoProviderModelSelection;
	/** Host-normalized values. `generationMode` is the reserved mode discriminator. */
	readonly settings: Readonly<Record<string, VideoProviderScalar>>;
	readonly inputs: VideoProviderInputSnapshot;
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

// Two bounded (<20 MB) image snapshots may be represented as base64 data URLs.
// Video/audio data URLs are intentionally not supported by the current executor.
const MAX_PROVIDER_RESOURCE_CHARACTERS = 28_000_000;

export interface SerializedVideoProviderRequest {
	readonly provider: string;
	readonly endpointPath: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Readonly<Record<string, JsonValue>>;
}

type VideoGenerationMode =
	| 'text-to-video'
	| 'first-frame-to-video'
	| 'first-last-frame-to-video'
	| 'reference-to-video'
	| 'video-edit'
	| 'video-extension';

type VideoInputKind =
	| 'text-prompt'
	| 'first-frame'
	| 'last-frame'
	| 'reference-image'
	| 'reference-video'
	| 'source-video'
	| 'audio';

interface CatalogModelDescriptor {
	readonly key: VideoProviderModelSelection;
	readonly availability?: Availability;
	readonly modes: readonly CatalogModeDescriptor[];
}

interface CatalogModeDescriptor {
	readonly mode: VideoGenerationMode;
	readonly availability?: Availability;
	readonly inputs: readonly CatalogInputDescriptor[];
	readonly parameters: readonly CatalogParameterDescriptor[];
	readonly constraints: readonly CatalogConstraintDescriptor[];
}

interface CatalogInputDescriptor {
	readonly kind: VideoInputKind;
	readonly minItems: number;
	readonly maxItems: number;
}

type CatalogParameterDescriptor = CatalogEnumParameter | CatalogRangeParameter | CatalogBooleanParameter;

interface CatalogParameterBase {
	readonly id: string;
	readonly availability?: Availability;
	readonly visibleWhen?: CatalogCondition;
	readonly enabledWhen?: {
		readonly condition: CatalogCondition;
		readonly reason: string;
	};
}

interface CatalogEnumParameter extends CatalogParameterBase {
	readonly type: 'enum';
	readonly options: readonly { readonly value: VideoProviderScalar; readonly availability?: Availability }[];
}

interface CatalogRangeParameter extends CatalogParameterBase {
	readonly type: 'range';
	readonly minimum: number;
	readonly maximum: number;
	readonly step: number;
}

interface CatalogBooleanParameter extends CatalogParameterBase {
	readonly type: 'boolean';
}

interface Availability {
	readonly status: 'unavailable';
	readonly reason: string;
}

type CatalogCondition =
	| { readonly kind: 'all'; readonly conditions: readonly CatalogCondition[] }
	| { readonly kind: 'any'; readonly conditions: readonly CatalogCondition[] }
	| { readonly kind: 'not'; readonly condition: CatalogCondition }
	| { readonly kind: 'parameter'; readonly parameterId: string; readonly operator: 'equals' | 'notEquals'; readonly value: VideoProviderScalar }
	| { readonly kind: 'parameter'; readonly parameterId: string; readonly operator: 'in' | 'notIn'; readonly values: readonly VideoProviderScalar[] }
	| { readonly kind: 'input'; readonly input: VideoInputKind; readonly operator: 'equals' | 'atLeast' | 'atMost'; readonly count: number };

interface CatalogConstraintDescriptor {
	readonly id: string;
	readonly targetParameterId: string;
	readonly when?: CatalogCondition;
	readonly allowed:
		| { readonly kind: 'values'; readonly values: readonly VideoProviderScalar[] }
		| { readonly kind: 'range'; readonly minimum: number; readonly maximum: number; readonly step?: number };
	readonly reason: string;
}

const BYTEPLUS_ENDPOINT = '/api/v3/contents/generations/tasks';
const MINIMAX_ENDPOINT = '/v1/video_generation';
const WAN_ENDPOINT = '/api/v1/services/aigc/video-generation/video-synthesis';

const WAN_SIZES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
	'720P': Object.freeze({
		'16:9': '1280*720',
		'9:16': '720*1280',
		'1:1': '960*960',
		'4:3': '1088*832',
		'3:4': '832*1088'
	}),
	'1080P': Object.freeze({
		'16:9': '1920*1080',
		'9:16': '1080*1920',
		'1:1': '1440*1440',
		'4:3': '1632*1248',
		'3:4': '1248*1632'
	})
});

/**
 * Serializes only a catalog-supported, host-normalized combination. This is a
 * final fail-closed boundary before credentials and network transport are used.
 */
export function serializeVideoProviderRequest(catalog: unknown, submission: VideoProviderSubmission): SerializedVideoProviderRequest {
	const descriptor = resolveCatalogModel(catalog, submission.selection);
	assertAvailable(descriptor.availability, `Model '${submission.selection.modelId}'`);
	const mode = requiredMode(submission.settings.generationMode);
	const modeDescriptor = descriptor.modes.find(candidate => candidate.mode === mode);
	if (!modeDescriptor) {
		throw new Error(`Model '${submission.selection.modelId}' does not support generation mode '${mode}'.`);
	}
	assertAvailable(modeDescriptor.availability, `Generation mode '${mode}'`);
	const inputCounts = validateInputs(modeDescriptor, submission.inputs);
	validateNormalizedSettings(modeDescriptor, submission.settings, inputCounts);

	switch (submission.selection.provider) {
		case 'byteplus':
			return serializeBytePlusRequest(submission, mode);
		case 'minimax':
			return serializeMiniMaxRequest(submission, mode);
		case 'alibaba-cloud':
			return serializeWanRequest(submission, mode);
		default:
			throw new Error(`No reviewed video request adapter exists for provider '${submission.selection.provider}'.`);
	}
}

function serializeBytePlusRequest(submission: VideoProviderSubmission, mode: VideoGenerationMode): SerializedVideoProviderRequest {
	const content: JsonValue[] = [];
	if (submission.inputs.prompt.trim()) {
		content.push({ type: 'text', text: boundedPrompt(submission.inputs.prompt, 16_000, 'Seedance') });
	}
	switch (mode) {
		case 'text-to-video':
			break;
		case 'first-frame-to-video':
			content.push(imageContent(requiredResource(submission.inputs.firstFrame, 'first frame'), 'first_frame'));
			break;
		case 'first-last-frame-to-video':
			content.push(imageContent(requiredResource(submission.inputs.firstFrame, 'first frame'), 'first_frame'));
			content.push(imageContent(requiredResource(submission.inputs.lastFrame, 'last frame'), 'last_frame'));
			break;
		case 'reference-to-video':
			for (const reference of submission.inputs.references ?? []) {
				content.push(reference.kind === 'image'
					? imageContent(requiredResource(reference.resource, 'reference image'), 'reference_image')
					: videoContent(requiredResource(reference.resource, 'reference video'), 'reference_video'));
			}
			for (const audio of submission.inputs.audio ?? []) {
				content.push(audioContent(requiredResource(audio, 'reference audio'), 'reference_audio'));
			}
			break;
		case 'video-edit':
		case 'video-extension':
			content.push(videoContent(requiredResource(submission.inputs.sourceVideo, 'source video'), 'source_video'));
			break;
	}
	const body: Record<string, JsonValue> = {
		model: submission.selection.modelId,
		content
	};
	copySetting(body, submission.settings, 'aspectRatio', 'ratio');
	copySetting(body, submission.settings, 'resolution', 'resolution');
	copySetting(body, submission.settings, 'durationSeconds', 'duration');
	copySetting(body, submission.settings, 'generateAudio', 'generate_audio');
	copySetting(body, submission.settings, 'cameraFixed', 'camera_fixed');
	return frozenRequest('byteplus', BYTEPLUS_ENDPOINT, {}, body);
}

function serializeMiniMaxRequest(submission: VideoProviderSubmission, mode: VideoGenerationMode): SerializedVideoProviderRequest {
	if (mode !== 'text-to-video' && mode !== 'first-frame-to-video' && mode !== 'first-last-frame-to-video') {
		throw new Error(`MiniMax adapter does not support generation mode '${mode}'.`);
	}
	const body: Record<string, JsonValue> = {
		model: submission.selection.modelId,
		duration: requiredNumber(submission.settings, 'durationSeconds'),
		resolution: requiredString(submission.settings, 'resolution'),
		prompt_optimizer: requiredBoolean(submission.settings, 'promptOptimizer')
	};
	if (submission.inputs.prompt.trim() || mode === 'text-to-video') {
		body.prompt = boundedPrompt(submission.inputs.prompt, 2_000, 'MiniMax');
	}
	if (mode === 'first-frame-to-video' || mode === 'first-last-frame-to-video') {
		body.first_frame_image = requiredResource(submission.inputs.firstFrame, 'first frame');
	}
	if (mode === 'first-last-frame-to-video') {
		body.last_frame_image = requiredResource(submission.inputs.lastFrame, 'last frame');
	}
	return frozenRequest('minimax', MINIMAX_ENDPOINT, {}, body);
}

function serializeWanRequest(submission: VideoProviderSubmission, mode: VideoGenerationMode): SerializedVideoProviderRequest {
	const input: Record<string, JsonValue> = {};
	if (submission.inputs.prompt.trim() || mode !== 'first-frame-to-video') {
		input.prompt = boundedPrompt(submission.inputs.prompt, 1_500, 'Wan');
	}
	const parameters: Record<string, JsonValue> = {
		duration: requiredNumber(submission.settings, 'durationSeconds')
	};
	if (mode === 'text-to-video') {
		parameters.size = wanSize(submission.settings);
		serializeWanAudio(submission, input);
		const promptExtend = requiredBoolean(submission.settings, 'promptExtend');
		parameters.prompt_extend = promptExtend;
		if (promptExtend) {
			parameters.shot_type = requiredString(submission.settings, 'shotType');
		}
		parameters.watermark = requiredBoolean(submission.settings, 'watermark');
	} else if (mode === 'first-frame-to-video') {
		input.img_url = requiredResource(submission.inputs.firstFrame, 'first frame');
		parameters.resolution = requiredString(submission.settings, 'resolution');
		serializeWanAudio(submission, input);
		const promptExtend = requiredBoolean(submission.settings, 'promptExtend');
		parameters.prompt_extend = promptExtend;
		if (promptExtend) {
			parameters.shot_type = requiredString(submission.settings, 'shotType');
		}
		parameters.watermark = requiredBoolean(submission.settings, 'watermark');
	} else if (mode === 'reference-to-video') {
		const referenceUrls = (submission.inputs.references ?? []).map(reference => requiredResource(reference.resource, 'reference media'));
		if (referenceUrls.length < 1 || referenceUrls.length > 5) {
			throw new Error('Wan 2.6 reference-to-video requires 1-5 total reference images and videos.');
		}
		input.reference_urls = referenceUrls;
		parameters.size = wanSize(submission.settings);
		parameters.shot_type = requiredString(submission.settings, 'shotType');
		parameters.watermark = requiredBoolean(submission.settings, 'watermark');
	} else {
		throw new Error(`Wan 2.6 adapter does not support generation mode '${mode}'.`);
	}
	return frozenRequest('alibaba-cloud', WAN_ENDPOINT, { 'X-DashScope-Async': 'enable' }, {
		model: submission.selection.modelId,
		input,
		parameters
	});
}

function serializeWanAudio(submission: VideoProviderSubmission, input: Record<string, JsonValue>): void {
	const audioMode = requiredString(submission.settings, 'audioMode');
	const audio = submission.inputs.audio ?? [];
	if (audioMode === 'generate') {
		if (audio.length !== 0) {
			throw new Error('Wan generated-audio mode cannot submit a custom audio input.');
		}
	} else if (audioMode === 'custom') {
		if (audio.length !== 1) {
			throw new Error('Wan custom-audio mode requires exactly one audio input.');
		}
		input.audio_url = requiredResource(audio[0], 'custom audio');
	} else {
		throw new Error(`Wan 2.6 does not support audio mode '${audioMode}'.`);
	}
}

function resolveCatalogModel(catalog: unknown, selection: VideoProviderModelSelection): CatalogModelDescriptor {
	const root = asRecord(catalog, 'video model catalog');
	if (root.schemaVersion !== 1 || !Array.isArray(root.models)) {
		throw new Error('The video model catalog does not use the supported version 1 envelope.');
	}
	const matches: CatalogModelDescriptor[] = [];
	for (const candidate of root.models) {
		const descriptor = parseCatalogModel(candidate);
		if (sameSelection(descriptor.key, selection)) {
			matches.push(descriptor);
		}
	}
	if (matches.length !== 1) {
		throw new Error(matches.length === 0
			? `No reviewed capability matches model '${selection.modelId}' in '${selection.region}'.`
			: `The video model catalog contains duplicate capabilities for '${selection.modelId}'.`);
	}
	return matches[0];
}

function parseCatalogModel(value: unknown): CatalogModelDescriptor {
	const descriptor = asRecord(value, 'video model descriptor');
	const key = asRecord(descriptor.key, 'video model key');
	if (!Array.isArray(descriptor.modes)) {
		throw new Error('A video model descriptor has no mode list.');
	}
	return {
		key: {
			provider: catalogString(key.provider, 'provider'),
			deployment: catalogString(key.deployment, 'deployment'),
			region: catalogString(key.region, 'region'),
			modelId: catalogString(key.modelId, 'modelId'),
			revision: catalogString(key.revision, 'revision')
		},
		availability: parseAvailability(descriptor.availability),
		modes: descriptor.modes.map(parseCatalogMode)
	};
}

function parseCatalogMode(value: unknown): CatalogModeDescriptor {
	const mode = asRecord(value, 'video model mode');
	if (!isVideoGenerationMode(mode.mode) || !Array.isArray(mode.inputs) || !Array.isArray(mode.parameters)) {
		throw new Error('A video model mode has an invalid mode, input list, or parameter list.');
	}
	return {
		mode: mode.mode,
		availability: parseAvailability(mode.availability),
		inputs: mode.inputs.map(parseCatalogInput),
		parameters: mode.parameters.map(parseCatalogParameter),
		constraints: Array.isArray(mode.constraints) ? mode.constraints.map(parseCatalogConstraint) : []
	};
}

function parseCatalogInput(value: unknown): CatalogInputDescriptor {
	const input = asRecord(value, 'video model input');
	if (!isVideoInputKind(input.kind) || !isNonNegativeInteger(input.minItems) || !isNonNegativeInteger(input.maxItems) || input.maxItems < input.minItems) {
		throw new Error('A video model input requirement is invalid.');
	}
	return { kind: input.kind, minItems: input.minItems, maxItems: input.maxItems };
}

function parseCatalogParameter(value: unknown): CatalogParameterDescriptor {
	const parameter = asRecord(value, 'video model parameter');
	const id = catalogString(parameter.id, 'parameter id');
	const availability = parseAvailability(parameter.availability);
	const visibleWhen = parameter.visibleWhen === undefined ? undefined : parseCatalogCondition(parameter.visibleWhen);
	const enabledWhen = parameter.enabledWhen === undefined ? undefined : parseCatalogEnabledWhen(parameter.enabledWhen);
	const common = { id, availability, visibleWhen, enabledWhen };
	if (parameter.type === 'enum' && Array.isArray(parameter.options)) {
		return {
			type: 'enum',
			...common,
			options: parameter.options.map(option => {
				const parsed = asRecord(option, `parameter '${id}' option`);
				if (!isScalar(parsed.value)) {
					throw new Error(`Video model parameter '${id}' has a non-scalar option.`);
				}
				return { value: parsed.value, availability: parseAvailability(parsed.availability) };
			})
		};
	}
	if (parameter.type === 'range' && typeof parameter.minimum === 'number' && typeof parameter.maximum === 'number' && typeof parameter.step === 'number') {
		return { type: 'range', ...common, minimum: parameter.minimum, maximum: parameter.maximum, step: parameter.step };
	}
	if (parameter.type === 'boolean') {
		return { type: 'boolean', ...common };
	}
	throw new Error(`Video model parameter '${id}' has an unsupported schema.`);
}

function parseCatalogEnabledWhen(value: unknown): NonNullable<CatalogParameterBase['enabledWhen']> {
	const enabledWhen = asRecord(value, 'video model enabled condition');
	return {
		condition: parseCatalogCondition(enabledWhen.condition),
		reason: catalogString(enabledWhen.reason, 'enabled condition reason')
	};
}

function parseCatalogConstraint(value: unknown): CatalogConstraintDescriptor {
	const constraint = asRecord(value, 'video model constraint');
	const allowed = asRecord(constraint.allowed, 'video model constraint domain');
	let parsedAllowed: CatalogConstraintDescriptor['allowed'];
	if (allowed.kind === 'values' && Array.isArray(allowed.values) && allowed.values.every(isScalar)) {
		parsedAllowed = { kind: 'values', values: allowed.values };
	} else if (allowed.kind === 'range' && typeof allowed.minimum === 'number' && typeof allowed.maximum === 'number'
		&& (allowed.step === undefined || typeof allowed.step === 'number')) {
		parsedAllowed = { kind: 'range', minimum: allowed.minimum, maximum: allowed.maximum, step: allowed.step };
	} else {
		throw new Error('A video model constraint has an invalid allowed domain.');
	}
	return {
		id: catalogString(constraint.id, 'constraint id'),
		targetParameterId: catalogString(constraint.targetParameterId, 'constraint target'),
		when: constraint.when === undefined ? undefined : parseCatalogCondition(constraint.when),
		allowed: parsedAllowed,
		reason: catalogString(constraint.reason, 'constraint reason')
	};
}

function parseCatalogCondition(value: unknown): CatalogCondition {
	const condition = asRecord(value, 'video model condition');
	if ((condition.kind === 'all' || condition.kind === 'any') && Array.isArray(condition.conditions)) {
		return { kind: condition.kind, conditions: condition.conditions.map(parseCatalogCondition) };
	}
	if (condition.kind === 'not') {
		return { kind: 'not', condition: parseCatalogCondition(condition.condition) };
	}
	if (condition.kind === 'parameter') {
		const parameterId = catalogString(condition.parameterId, 'condition parameter');
		if ((condition.operator === 'equals' || condition.operator === 'notEquals') && isScalar(condition.value)) {
			return { kind: 'parameter', parameterId, operator: condition.operator, value: condition.value };
		}
		if ((condition.operator === 'in' || condition.operator === 'notIn') && Array.isArray(condition.values) && condition.values.every(isScalar)) {
			return { kind: 'parameter', parameterId, operator: condition.operator, values: condition.values };
		}
	}
	if (condition.kind === 'input' && isVideoInputKind(condition.input)
		&& (condition.operator === 'equals' || condition.operator === 'atLeast' || condition.operator === 'atMost')
		&& isNonNegativeInteger(condition.count)) {
		return { kind: 'input', input: condition.input, operator: condition.operator, count: condition.count };
	}
	throw new Error('A video model condition is invalid.');
}

function validateInputs(mode: CatalogModeDescriptor, inputs: VideoProviderInputSnapshot): Readonly<Record<VideoInputKind, number>> {
	const references = inputs.references ?? [];
	if (references.some(reference => reference.kind !== 'image' && reference.kind !== 'video')) {
		throw new Error(`Generation mode '${mode.mode}' received an invalid ordered reference kind.`);
	}
	const counts: Record<VideoInputKind, number> = {
		'text-prompt': inputs.prompt.trim() ? 1 : 0,
		'first-frame': inputs.firstFrame ? 1 : 0,
		'last-frame': inputs.lastFrame ? 1 : 0,
		'reference-image': references.filter(reference => reference.kind === 'image').length,
		'reference-video': references.filter(reference => reference.kind === 'video').length,
		'source-video': inputs.sourceVideo ? 1 : 0,
		audio: inputs.audio?.length ?? 0
	};
	const requirements = new Map(mode.inputs.map(input => [input.kind, input]));
	for (const [kind, count] of Object.entries(counts) as [VideoInputKind, number][]) {
		const requirement = requirements.get(kind);
		if (!requirement && count !== 0) {
			throw new Error(`Generation mode '${mode.mode}' does not accept input '${kind}'.`);
		}
		if (requirement && (count < requirement.minItems || count > requirement.maxItems)) {
			throw new Error(`Generation mode '${mode.mode}' input '${kind}' requires ${requirement.minItems}-${requirement.maxItems} items; received ${count}.`);
		}
	}
	return Object.freeze(counts);
}

function validateNormalizedSettings(mode: CatalogModeDescriptor, settings: Readonly<Record<string, VideoProviderScalar>>, inputCounts: Readonly<Record<VideoInputKind, number>>): void {
	const expected = new Set(['generationMode', ...mode.parameters.map(parameter => parameter.id)]);
	for (const key of Object.keys(settings)) {
		if (!expected.has(key)) {
			throw new Error(`Generation mode '${mode.mode}' received unsupported setting '${key}'.`);
		}
	}
	for (const parameter of mode.parameters) {
		const value = settings[parameter.id];
		const visible = !parameter.visibleWhen || conditionMatches(parameter.visibleWhen, settings, inputCounts);
		const enabled = visible && !parameter.availability
			&& (!parameter.enabledWhen || conditionMatches(parameter.enabledWhen.condition, settings, inputCounts));
		if (!enabled) {
			if (value !== undefined) {
				throw new Error(`Host-normalized settings must omit disabled parameter '${parameter.id}'.`);
			}
			continue;
		}
		if (value === undefined) {
			throw new Error(`Host-normalized settings are missing '${parameter.id}'.`);
		}
		if (parameter.type === 'boolean') {
			if (typeof value !== 'boolean') {
				throw new Error(`Parameter '${parameter.id}' must be boolean.`);
			}
		} else if (parameter.type === 'enum') {
			const option = parameter.options.find(candidate => candidate.value === value);
			if (!option) {
				throw new Error(`Parameter '${parameter.id}' has unsupported value '${String(value)}'.`);
			}
			assertAvailable(option.availability, `Parameter '${parameter.id}' value '${String(value)}'`);
		} else if (typeof value !== 'number' || !inRange(value, parameter.minimum, parameter.maximum, parameter.step)) {
			throw new Error(`Parameter '${parameter.id}' is outside its supported range.`);
		}
	}
	for (const constraint of mode.constraints) {
		if (constraint.when && !conditionMatches(constraint.when, settings, inputCounts)) {
			continue;
		}
		const value = settings[constraint.targetParameterId];
		if (value === undefined) {
			continue;
		}
		const accepted = constraint.allowed.kind === 'values'
			? constraint.allowed.values.includes(value)
			: typeof value === 'number' && inRange(value, constraint.allowed.minimum, constraint.allowed.maximum, constraint.allowed.step ?? 1);
		if (!accepted) {
			throw new Error(constraint.reason);
		}
	}
}

function conditionMatches(condition: CatalogCondition, settings: Readonly<Record<string, VideoProviderScalar>>, inputs: Readonly<Record<VideoInputKind, number>>): boolean {
	switch (condition.kind) {
		case 'all': return condition.conditions.every(candidate => conditionMatches(candidate, settings, inputs));
		case 'any': return condition.conditions.some(candidate => conditionMatches(candidate, settings, inputs));
		case 'not': return !conditionMatches(condition.condition, settings, inputs);
		case 'input': {
			const count = inputs[condition.input];
			return condition.operator === 'equals' ? count === condition.count
				: condition.operator === 'atLeast' ? count >= condition.count
					: count <= condition.count;
		}
		case 'parameter': {
			const value = settings[condition.parameterId];
			if (condition.operator === 'equals') { return value === condition.value; }
			if (condition.operator === 'notEquals') { return value !== condition.value; }
			if ('values' in condition) {
				return condition.operator === 'in' ? condition.values.includes(value) : !condition.values.includes(value);
			}
			return false;
		}
	}
}

function wanSize(settings: Readonly<Record<string, VideoProviderScalar>>): string {
	const resolution = requiredString(settings, 'resolution');
	const aspectRatio = requiredString(settings, 'aspectRatio');
	const size = WAN_SIZES[resolution]?.[aspectRatio];
	if (!size) {
		throw new Error(`Wan 2.6 has no reviewed size for '${resolution}' at '${aspectRatio}'.`);
	}
	return size;
}

function imageContent(resource: string, role: string): JsonValue {
	return { type: 'image_url', image_url: { url: resource }, role };
}

function videoContent(resource: string, role: string): JsonValue {
	return { type: 'video_url', video_url: { url: resource }, role };
}

function audioContent(resource: string, role: string): JsonValue {
	return { type: 'audio_url', audio_url: { url: resource }, role };
}

function copySetting(target: Record<string, JsonValue>, settings: Readonly<Record<string, VideoProviderScalar>>, source: string, destination: string): void {
	const value = settings[source];
	if (value !== undefined) {
		target[destination] = value;
	}
}

function requiredMode(value: VideoProviderScalar | undefined): VideoGenerationMode {
	if (!isVideoGenerationMode(value)) {
		throw new Error('Host-normalized settings have no supported generationMode.');
	}
	return value;
}

function requiredString(values: Readonly<Record<string, VideoProviderScalar>>, key: string): string {
	const value = values[key];
	if (typeof value !== 'string') {
		throw new Error(`Host-normalized setting '${key}' must be a string.`);
	}
	return value;
}

function requiredNumber(values: Readonly<Record<string, VideoProviderScalar>>, key: string): number {
	const value = values[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Host-normalized setting '${key}' must be a finite number.`);
	}
	return value;
}

function requiredBoolean(values: Readonly<Record<string, VideoProviderScalar>>, key: string): boolean {
	const value = values[key];
	if (typeof value !== 'boolean') {
		throw new Error(`Host-normalized setting '${key}' must be boolean.`);
	}
	return value;
}

function requiredResource(value: string | undefined, label: string): string {
	if (!value?.trim() || value.length > MAX_PROVIDER_RESOURCE_CHARACTERS) {
		throw new Error(`The ${label} resource is missing or exceeds the request limit.`);
	}
	return value;
}

function boundedPrompt(value: string, maximum: number, provider: string): string {
	const prompt = value.trim();
	if (!prompt || prompt.length > maximum) {
		throw new Error(`${provider} prompt must contain 1-${maximum} characters.`);
	}
	return prompt;
}

function frozenRequest(provider: string, endpointPath: string, headers: Record<string, string>, body: Record<string, JsonValue>): SerializedVideoProviderRequest {
	return Object.freeze({
		provider,
		endpointPath,
		headers: Object.freeze({ ...headers }),
		body: deepFreezeJson(body)
	});
}

function deepFreezeJson<T extends JsonValue>(value: T): T {
	if (Array.isArray(value)) {
		for (const item of value) { deepFreezeJson(item); }
		return Object.freeze(value) as T;
	}
	if (typeof value === 'object' && value !== null) {
		for (const item of Object.values(value)) { deepFreezeJson(item); }
		return Object.freeze(value) as T;
	}
	return value;
}

function assertAvailable(availability: Availability | undefined, subject: string): void {
	if (availability?.status === 'unavailable') {
		throw new Error(`${subject} is unavailable: ${availability.reason}`);
	}
}

function parseAvailability(value: unknown): Availability | undefined {
	if (value === undefined) { return undefined; }
	const availability = asRecord(value, 'availability');
	if (availability.status !== 'unavailable' || typeof availability.reason !== 'string' || !availability.reason.trim()) {
		throw new Error('A video model availability entry is invalid.');
	}
	return { status: 'unavailable', reason: availability.reason };
}

function sameSelection(left: VideoProviderModelSelection, right: VideoProviderModelSelection): boolean {
	return left.provider === right.provider
		&& left.deployment === right.deployment
		&& left.region === right.region
		&& left.modelId === right.modelId
		&& left.revision === right.revision;
}

function isVideoGenerationMode(value: unknown): value is VideoGenerationMode {
	return value === 'text-to-video' || value === 'first-frame-to-video' || value === 'first-last-frame-to-video'
		|| value === 'reference-to-video' || value === 'video-edit' || value === 'video-extension';
}

function isVideoInputKind(value: unknown): value is VideoInputKind {
	return value === 'text-prompt' || value === 'first-frame' || value === 'last-frame' || value === 'reference-image'
		|| value === 'reference-video' || value === 'source-video' || value === 'audio';
}

function inRange(value: number, minimum: number, maximum: number, step: number): boolean {
	if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || !Number.isFinite(step) || step <= 0) {
		return false;
	}
	const steps = (value - minimum) / step;
	return value >= minimum && value <= maximum && Math.abs(steps - Math.round(steps)) < 1e-9;
}

function catalogString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Video model catalog ${label} must be a non-empty string.`);
	}
	return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`The ${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function isScalar(value: unknown): value is VideoProviderScalar {
	return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

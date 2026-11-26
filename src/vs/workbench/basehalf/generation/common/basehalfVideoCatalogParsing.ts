/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_AUDIO_FORMATS, BASEHALF_AUDIO_MAKES, BASEHALF_MODEL_KINDS, BASEHALF_VIDEO_MODE_IDS, BaseHalfModelKind, BaseHalfVideoCatalogParameter, BaseHalfVideoImageFormat, BaseHalfVideoModeId, BaseHalfVideoSlotUse, IBaseHalfVideoBooleanParameter, IBaseHalfVideoCatalog, IBaseHalfVideoCatalogCredential, IBaseHalfVideoCatalogMode, IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider, IBaseHalfVideoCatalogRegion, IBaseHalfVideoCatalogVoiceOption, IBaseHalfVideoCheckLimit, IBaseHalfVideoCheckResult, IBaseHalfVideoChoiceParameter, IBaseHalfVideoCountSlot, IBaseHalfVideoModeLimits, IBaseHalfVideoNumberParameter, IBaseHalfVideoTextParameter, IBaseHalfVideoVoiceParameter } from './basehalfVideoCatalog.js';
import { BASEHALF_VIDEO_SENT_PROMPT_MAX_LENGTH } from './basehalfGenerationInputs.js';
import { isVoiceId, MAX_VOICE_ID_LENGTH } from '../../../../platform/basehalfProviders/common/basehalfProviderVoices.js';

// Reading what the provider service answers about its catalog and about a check: nothing of an answer is trusted
// to have the shape it should, and what does not is refused with what was wrong.

/**
 * Reads the catalog that the provider service answered, keeping only what the window
 * knows. A provider, model, mode, or parameter that is not well formed is
 * left out and named in `problems`; a catalog that is not one at all is
 * refused with an error.
 */
export function parseBaseHalfVideoCatalog(value: unknown): { readonly catalog: IBaseHalfVideoCatalog; readonly problems: readonly string[] } {
	if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.providers)) {
		throw new Error('The video model catalog is not in the form this BaseHalf reads.');
	}
	const problems: string[] = [];
	const providers: IBaseHalfVideoCatalogProvider[] = [];
	value.providers.forEach((candidate, index) => {
		const provider = parseProvider(candidate, `providers[${index}]`, problems);
		if (provider && providers.some(existing => existing.id === provider.id)) {
			problems.push(`providers[${index}].id '${provider.id}' is listed twice.`);
		} else if (provider) {
			providers.push(provider);
		}
	});
	return Object.freeze({ catalog: Object.freeze({ schema: 1 as const, providers: Object.freeze(providers) }), problems: Object.freeze(problems) });
}

/** Reads what `check` answered. */
export function parseBaseHalfVideoCheckResult(value: unknown): IBaseHalfVideoCheckResult | undefined {
	if (!isRecord(value) || !Array.isArray(value.problems) || !value.problems.every(problem => typeof problem === 'string')) {
		return undefined;
	}
	if (typeof value.prompt !== 'string' || value.prompt.length > BASEHALF_VIDEO_SENT_PROMPT_MAX_LENGTH) {
		return undefined;
	}
	const providerModel = typeof value.providerModel === 'string' && /^\S{1,256}$/.test(value.providerModel) ? value.providerModel : undefined;
	const limits = parseCheckLimits(value.limits);
	return Object.freeze({
		problems: Object.freeze(value.problems.map(problem => plainText(problem, 1000)).filter(problem => problem.length > 0)),
		prompt: value.prompt,
		...(providerModel ? { providerModel } : {}),
		...(limits ? { limits } : {})
	});
}

/** The limits of a check's answer that can be used: a finite end, a reason, and room between the ends. */
function parseCheckLimits(value: unknown): IBaseHalfVideoCheckResult['limits'] {
	if (!isRecord(value)) {
		return undefined;
	}
	const limits: Record<string, IBaseHalfVideoCheckLimit> = {};
	for (const [name, limit] of Object.entries(value)) {
		if (!PARAMETER_NAME_PATTERN.test(name) || !isRecord(limit) || typeof limit.reason !== 'string') {
			continue;
		}
		const finite = (end: unknown): end is number => typeof end === 'number' && Number.isFinite(end);
		const min = finite(limit.min) ? limit.min : undefined;
		const max = finite(limit.max) ? limit.max : undefined;
		const reason = plainText(limit.reason, 500);
		if ((min === undefined && max === undefined) || !reason || (min !== undefined && max !== undefined && min > max)) {
			continue;
		}
		limits[name] = Object.freeze({ ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), reason });
	}
	return Object.keys(limits).length ? Object.freeze(limits) : undefined;
}

/** The image formats a mode takes when it declares none. */
export const BASEHALF_VIDEO_IMAGE_FORMATS: readonly BaseHalfVideoImageFormat[] = Object.freeze(['png', 'jpeg', 'webp']);

/** A provider id that can name a stored secret: lowercase letters, digits, and hyphens. */
export const BASEHALF_VIDEO_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,57}$/;

/** A model or credential id, as a node's file and a request carry it. */
const CATALOG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

function parseProvider(value: unknown, path: string, problems: string[]): IBaseHalfVideoCatalogProvider | undefined {
	try {
		const record = requireRecord(value, path);
		const id = requireText(record.id, `${path}.id`);
		if (!BASEHALF_VIDEO_PROVIDER_ID_PATTERN.test(id)) {
			throw new Error(`${path}.id '${id}' must be lowercase letters, digits, and hyphens.`);
		}
		const regions = requireArray(record.regions, `${path}.regions`).map((region, index) => parseRegion(region, `${path}.regions[${index}]`));
		if (!regions.length || new Set(regions.map(region => region.id)).size !== regions.length) {
			throw new Error(`${path}.regions must list at least one region, each once.`);
		}
		const credentials = requireArray(record.credentials, `${path}.credentials`).map((credential, index) => parseCredential(credential, `${path}.credentials[${index}]`));
		if (!credentials.length || new Set(credentials.map(credential => credential.id)).size !== credentials.length) {
			throw new Error(`${path}.credentials must list at least one value, each once.`);
		}
		const models: IBaseHalfVideoCatalogModel[] = [];
		requireArray(record.models, `${path}.models`).forEach((candidate, index) => {
			const model = parseModel(candidate, `${path}.models[${index}]`, problems);
			if (model && models.some(existing => existing.id === model.id)) {
				problems.push(`${path}.models[${index}].id '${model.id}' is listed twice.`);
			} else if (model) {
				models.push(model);
			}
		});
		return Object.freeze({
			id,
			label: requireText(record.label, `${path}.label`),
			regions: Object.freeze(regions),
			credentials: Object.freeze(credentials),
			models: Object.freeze(models)
		});
	} catch (error) {
		problems.push(error instanceof Error ? error.message : String(error));
		return undefined;
	}
}

function parseRegion(value: unknown, path: string): IBaseHalfVideoCatalogRegion {
	const record = requireRecord(value, path);
	const id = requireText(record.id, `${path}.id`);
	if (!CATALOG_ID_PATTERN.test(id)) {
		throw new Error(`${path}.id '${id}' contains unsupported characters.`);
	}
	const baseUrl = requireText(record.baseUrl, `${path}.baseUrl`);
	if (!isWebUrl(baseUrl)) {
		throw new Error(`${path}.baseUrl must be an http or https URL.`);
	}
	const console = record.console === undefined ? undefined : requireText(record.console, `${path}.console`);
	return Object.freeze({
		id,
		label: requireText(record.label, `${path}.label`),
		baseUrl,
		...(console !== undefined && isWebUrl(console) ? { console } : {})
	});
}

function parseCredential(value: unknown, path: string): IBaseHalfVideoCatalogCredential {
	const record = requireRecord(value, path);
	const id = requireText(record.id, `${path}.id`);
	if (!CATALOG_ID_PATTERN.test(id)) {
		throw new Error(`${path}.id '${id}' contains unsupported characters.`);
	}
	const placeholder = typeof record.placeholder === 'string' && record.placeholder.trim() ? record.placeholder.trim() : undefined;
	return Object.freeze({ id, label: requireText(record.label, `${path}.label`), ...(placeholder !== undefined ? { placeholder } : {}) });
}

function parseModel(value: unknown, path: string, problems: string[]): IBaseHalfVideoCatalogModel | undefined {
	try {
		const record = requireRecord(value, path);
		const id = requireText(record.id, `${path}.id`);
		if (!CATALOG_ID_PATTERN.test(id)) {
			throw new Error(`${path}.id '${id}' contains unsupported characters.`);
		}
		const providerModels = requireRecord(record.providerModels, `${path}.providerModels`);
		const offered: Record<string, string> = {};
		for (const [region, providerModel] of Object.entries(providerModels)) {
			if (typeof providerModel === 'string' && providerModel.trim()) {
				offered[region] = providerModel.trim();
			}
		}
		const prompt = requireRecord(record.prompt, `${path}.prompt`);
		if (prompt.required !== 'always' && prompt.required !== 'withoutMedia' && prompt.required !== 'never') {
			throw new Error(`${path}.prompt.required must be always, withoutMedia, or never.`);
		}
		if (!Number.isSafeInteger(prompt.maxLength) || (prompt.maxLength as number) < 1) {
			throw new Error(`${path}.prompt.maxLength must be a whole number of at least 1.`);
		}
		const modes = requireArray(record.modes, `${path}.modes`).map((mode, index) => parseMode(mode, `${path}.modes[${index}]`));
		if (!modes.length || new Set(modes.map(mode => mode.id)).size !== modes.length) {
			throw new Error(`${path}.modes must list at least one mode, each once.`);
		}
		const parameters: BaseHalfVideoCatalogParameter[] = [];
		requireArray(record.parameters, `${path}.parameters`).forEach((candidate, index) => {
			try {
				const parameter = parseParameter(candidate, `${path}.parameters[${index}]`);
				if (parameters.some(existing => existing.name === parameter.name)) {
					throw new Error(`${path}.parameters[${index}].name '${parameter.name}' is declared twice.`);
				}
				parameters.push(parameter);
			} catch (error) {
				problems.push(error instanceof Error ? error.message : String(error));
			}
		});
		const description = typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined;
		const kind: BaseHalfModelKind = record.kind === undefined ? 'video' : BASEHALF_MODEL_KINDS.includes(record.kind as BaseHalfModelKind) ? record.kind as BaseHalfModelKind : (() => { throw new Error(`${path}.kind must be image, video, or audio.`); })();
		// A draft takes its extension from the format an image or an audio model delivers (providers, "Model").
		const outputFormat = kind === 'image'
			? BASEHALF_VIDEO_IMAGE_FORMATS.find(format => format === record.outputFormat)
			: kind === 'audio' ? BASEHALF_AUDIO_FORMATS.find(format => format === record.outputFormat) : undefined;
		if (kind === 'image' && outputFormat === undefined) {
			throw new Error(`${path}.outputFormat must be png, jpeg, or webp for an image model.`);
		}
		if (kind === 'audio' && outputFormat === undefined) {
			throw new Error(`${path}.outputFormat must be mp3 or wav for an audio model.`);
		}
		const makes = kind === 'audio' ? BASEHALF_AUDIO_MAKES.find(candidate => candidate === record.makes) : undefined;
		if (kind === 'audio' && makes === undefined) {
			throw new Error(`${path}.makes must be speech, music, or sound for an audio model.`);
		}
		const deprecatedIn = Array.isArray(record.deprecatedIn) ? record.deprecatedIn.filter((region): region is string => typeof region === 'string' && offered[region] !== undefined) : [];
		return Object.freeze({
			id,
			label: requireText(record.label, `${path}.label`),
			...(description !== undefined ? { description } : {}),
			providerModels: Object.freeze(offered),
			prompt: Object.freeze({ required: prompt.required, maxLength: prompt.maxLength as number }),
			modes: Object.freeze(modes),
			parameters: Object.freeze(parameters),
			...(record.deprecated === true ? { deprecated: true } : {}),
			kind,
			...(makes !== undefined ? { makes } : {}),
			...(outputFormat !== undefined ? { outputFormat } : {}),
			...(record.answersAtOnce === true ? { answersAtOnce: true } : {}),
			...(deprecatedIn.length ? { deprecatedIn: Object.freeze(deprecatedIn) } : {})
		});
	} catch (error) {
		problems.push(error instanceof Error ? error.message : String(error));
		return undefined;
	}
}

function parseMode(value: unknown, path: string): IBaseHalfVideoCatalogMode {
	const record = requireRecord(value, path);
	if (!BASEHALF_VIDEO_MODE_IDS.includes(record.id as BaseHalfVideoModeId)) {
		throw new Error(`${path}.id must be one of ${BASEHALF_VIDEO_MODE_IDS.join(', ')}.`);
	}
	const inputs = requireRecord(record.inputs, `${path}.inputs`);
	const slotUse = (slot: unknown, slotPath: string): BaseHalfVideoSlotUse => {
		if (slot !== 'none' && slot !== 'optional' && slot !== 'required') {
			throw new Error(`${slotPath} must be none, optional, or required.`);
		}
		return slot;
	};
	const count = (slot: unknown, slotPath: string): IBaseHalfVideoCountSlot => {
		const candidate = requireRecord(slot, slotPath);
		const min = candidate.min;
		const max = candidate.max;
		if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || (min as number) < 0 || (max as number) < (min as number)) {
			throw new Error(`${slotPath} must have whole numbers min and max, with min at most max.`);
		}
		return Object.freeze({ min: min as number, max: max as number });
	};
	if (inputs.source !== 'none' && inputs.source !== 'required') {
		throw new Error(`${path}.inputs.source must be none or required.`);
	}
	const regions = Array.isArray(record.regions) && record.regions.length && record.regions.every(region => typeof region === 'string' && region.length > 0)
		? Object.freeze([...new Set(record.regions as string[])])
		: undefined;
	const limits = isRecord(record.limits) ? record.limits : {};
	const keptLimits: Record<string, unknown> = {};
	for (const [key, limit] of Object.entries(limits)) {
		if (key === 'imageFormats') {
			const formats = Array.isArray(limit) ? [...new Set(limit)] : [];
			if (formats.length && formats.every(format => BASEHALF_VIDEO_IMAGE_FORMATS.includes(format)) && formats.includes('png')) {
				keptLimits[key] = Object.freeze(formats);
			}
			continue;
		}
		if ((typeof limit === 'number' && Number.isFinite(limit))
			|| (Array.isArray(limit) && limit.length === 2 && limit.every(entry => typeof entry === 'number' && Number.isFinite(entry)))) {
			keptLimits[key] = Array.isArray(limit) ? Object.freeze([limit[0], limit[1]]) : limit;
		}
	}
	return Object.freeze({
		id: record.id as BaseHalfVideoModeId,
		label: requireText(record.label, `${path}.label`),
		inputs: Object.freeze({
			startFrame: slotUse(inputs.startFrame, `${path}.inputs.startFrame`),
			endFrame: slotUse(inputs.endFrame, `${path}.inputs.endFrame`),
			images: count(inputs.images, `${path}.inputs.images`),
			videos: count(inputs.videos, `${path}.inputs.videos`),
			audios: count(inputs.audios, `${path}.inputs.audios`),
			source: inputs.source
		}),
		limits: Object.freeze(keptLimits) as IBaseHalfVideoModeLimits,
		...(regions ? { regions } : {})
	});
}

function parseParameter(value: unknown, path: string): BaseHalfVideoCatalogParameter {
	const record = requireRecord(value, path);
	const name = requireText(record.name, `${path}.name`);
	if (!PARAMETER_NAME_PATTERN.test(name)) {
		throw new Error(`${path}.name '${name}' contains unsupported characters.`);
	}
	const modes = record.modes === undefined ? undefined : requireArray(record.modes, `${path}.modes`);
	if (modes && !modes.every(mode => BASEHALF_VIDEO_MODE_IDS.includes(mode as BaseHalfVideoModeId))) {
		throw new Error(`${path}.modes must list mode ids.`);
	}
	const tooltip = typeof record.tooltip === 'string' && record.tooltip.trim() ? record.tooltip.trim() : undefined;
	const base = {
		name,
		label: requireText(record.label, `${path}.label`),
		...(tooltip !== undefined ? { tooltip } : {}),
		...(modes ? { modes: Object.freeze([...modes] as BaseHalfVideoModeId[]) } : {}),
		...(record.advanced === true ? { advanced: true } : {}),
		...(record.optional === true ? { optional: true } : {}),
		...(record.setByStartFrame === true ? { setByStartFrame: true } : {})
	};
	switch (record.kind) {
		case 'choice': {
			const options = requireArray(record.options, `${path}.options`).map((option, index) => {
				const candidate = requireRecord(option, `${path}.options[${index}]`);
				if ((typeof candidate.value !== 'string' && typeof candidate.value !== 'number') || (typeof candidate.value === 'number' && !Number.isFinite(candidate.value))) {
					throw new Error(`${path}.options[${index}].value must be text or a number.`);
				}
				return Object.freeze({ value: candidate.value, label: requireText(candidate.label, `${path}.options[${index}].label`) });
			});
			if (!options.length || new Set(options.map(option => option.value)).size !== options.length) {
				throw new Error(`${path}.options must list at least one value, each once.`);
			}
			const parameter: IBaseHalfVideoChoiceParameter = Object.freeze({
				...base,
				kind: 'choice',
				options: Object.freeze(options),
				...(record.display === 'ratio' ? { display: 'ratio' as const } : {}),
				...(options.some(option => option.value === record.default) ? { default: record.default as string | number } : {})
			});
			return parameter;
		}
		case 'integer':
		case 'number': {
			const { min, max, step } = record;
			if (typeof min !== 'number' || typeof max !== 'number' || typeof step !== 'number'
				|| !Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || max < min || step <= 0) {
				throw new Error(`${path} must have finite min, max, and step, with min at most max and a step above 0.`);
			}
			const auto = isRecord(record.auto) && typeof record.auto.value === 'number' && Number.isFinite(record.auto.value) && typeof record.auto.label === 'string' && record.auto.label.trim()
				? Object.freeze({ value: record.auto.value, label: record.auto.label.trim() })
				: undefined;
			const parameter: IBaseHalfVideoNumberParameter = Object.freeze({
				...base,
				kind: record.kind,
				min,
				max,
				step,
				...(record.unit === 'seconds' ? { unit: 'seconds' as const } : {}),
				...(auto ? { auto } : {}),
				...(typeof record.default === 'number' && Number.isFinite(record.default) ? { default: record.default } : {})
			});
			return parameter;
		}
		case 'boolean': {
			const parameter: IBaseHalfVideoBooleanParameter = Object.freeze({
				...base,
				kind: 'boolean',
				...(typeof record.default === 'boolean' ? { default: record.default } : {})
			});
			return parameter;
		}
		case 'text': {
			if (!Number.isSafeInteger(record.maxLength) || (record.maxLength as number) < 1) {
				throw new Error(`${path}.maxLength must be a whole number of at least 1.`);
			}
			const parameter: IBaseHalfVideoTextParameter = Object.freeze({
				...base,
				kind: 'text',
				maxLength: record.maxLength as number,
				...(record.multiline === true ? { multiline: true } : {}),
				...(typeof record.default === 'string' ? { default: record.default } : {})
			});
			return parameter;
		}
		case 'voice': {
			// The voices the catalog declares for a speech model, at least its default (providers, "Voices").
			const options = requireArray(record.options, `${path}.options`).map((option, index): IBaseHalfVideoCatalogVoiceOption => {
				const candidate = requireRecord(option, `${path}.options[${index}]`);
				if (typeof candidate.value !== 'string' || !isVoiceId(candidate.value)) {
					throw new Error(`${path}.options[${index}].value must be a voice id of 1 to ${MAX_VOICE_ID_LENGTH} characters without control characters.`);
				}
				const description = typeof candidate.description === 'string' && candidate.description.trim() ? plainText(candidate.description, 200) : undefined;
				// The regions that offer the voice, read as a mode's are; without them, every region of the model does.
				const regions = Array.isArray(candidate.regions) && candidate.regions.length && candidate.regions.every(region => typeof region === 'string' && region.length > 0)
					? Object.freeze([...new Set(candidate.regions as string[])])
					: undefined;
				return Object.freeze({ value: candidate.value, label: requireText(candidate.label, `${path}.options[${index}].label`), ...(description ? { description } : {}), ...(regions ? { regions } : {}) });
			});
			if (!options.length || new Set(options.map(option => option.value)).size !== options.length) {
				throw new Error(`${path}.options must list at least one voice, each once.`);
			}
			const parameter: IBaseHalfVideoVoiceParameter = Object.freeze({
				...base,
				kind: 'voice',
				options: Object.freeze(options),
				// The default is one of the voices; a default that is not stands for the first.
				default: options.find(option => option.value === record.default)?.value ?? options[0].value,
				...(record.listed === true ? { listed: true } : {})
			});
			return parameter;
		}
		default:
			throw new Error(`${path}.kind must be choice, integer, number, boolean, text, or voice.`);
	}
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${path} must be an object.`);
	}
	return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${path} must be an array.`);
	}
	return value;
}

function requireText(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 1024 || value.includes('\u0000')) {
		throw new Error(`${path} must be text of 1 to 1024 characters.`);
	}
	return value.trim();
}

function isWebUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

/** Plain text of at most `maxLength` characters, without control characters or markup. */
function plainText(value: string, maxLength: number): string {
	const text = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BYTEDANCE } from './bytedance.ts';
import { KLING } from './kling.ts';
import { ALIBABA } from './alibaba.ts';
import { MINIMAX } from './minimax.ts';
import { VIDU } from './vidu.ts';
import { GOOGLE } from './google.ts';
import { PIXVERSE } from './pixverse.ts';
import { LUMA } from './luma.ts';
import { RUNWAY } from './runway.ts';
import { XAI } from './xai.ts';
import { LTX } from './ltx.ts';
import { BFL } from './bfl.ts';
import { OPENAI } from './openai.ts';
import type { ProviderModule } from './module.ts';
import type { Catalog, CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CountSlot, ImageFormat, ModeId } from './types.ts';

/**
 * The provider modules of AI Video, in the order the window lists them. A
 * provider is in the catalog when its module is here, and nowhere else
 * (video providers, "Phases").
 */
export const PROVIDER_MODULES: readonly ProviderModule[] = Object.freeze([BYTEDANCE, KLING, ALIBABA, MINIMAX, VIDU, GOOGLE, PIXVERSE, LUMA, RUNWAY, XAI, LTX, BFL, OPENAI]);

/** The most files one request makes: the largest `count` an image model may declare. */
export const MAX_OUTPUTS = 16;

const MODE_IDS: ReadonlySet<string> = new Set<ModeId>(['frames', 'reference', 'extend', 'edit']);
const SLOT_USES: ReadonlySet<string> = new Set(['none', 'optional', 'required']);
const IMAGE_FORMATS: ReadonlySet<string> = new Set<ImageFormat>(['png', 'jpeg', 'webp']);
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;

/** The catalog of the modules, after every declaration is validated. Throws on the first bad one, naming where it is. */
export function buildCatalog(modules: readonly ProviderModule[] = PROVIDER_MODULES): Catalog {
	const providers = modules.map(module => module.describe());
	const ids = new Set<string>();
	for (const provider of providers) {
		const at = `provider ${provider.id}`;
		check(ID.test(provider.id), `${at}: the id must be lowercase letters, digits, dots, dashes, or underscores`);
		check(!ids.has(provider.id), `${at}: declared twice`);
		ids.add(provider.id);
		validateProvider(provider);
	}
	// Every model of the answer says what it makes: a module may leave out `kind` for a video model.
	const answered = providers.map(provider => ({ ...provider, models: provider.models.map(model => ({ ...model, kind: model.kind ?? 'video' })) }));
	return deepFreeze({ schema: 1, providers: structuredClone(answered) });
}

/** Validates one provider's entry. Throws an error that names the declaration at fault. */
export function validateProvider(provider: CatalogProvider): void {
	const at = `provider ${provider.id}`;
	text(provider.label, `${at}: label`);
	check(provider.regions.length > 0, `${at}: at least one region is needed`);
	const regions = new Set<string>();
	for (const region of provider.regions) {
		const where = `${at}, region ${region.id}`;
		check(ID.test(region.id), `${where}: the id must be lowercase letters, digits, dots, dashes, or underscores`);
		check(!regions.has(region.id), `${where}: declared twice`);
		regions.add(region.id);
		text(region.label, `${where}: label`);
		check(isHttps(region.baseUrl) && !region.baseUrl.endsWith('/'), `${where}: the base URL must be an https address without a trailing slash`);
		check(region.console === undefined || isHttps(region.console), `${where}: the console must be an https address`);
	}
	check(provider.credentials.length > 0, `${at}: at least one credential is needed`);
	const credentials = new Set<string>();
	for (const credential of provider.credentials) {
		check(PARAMETER_NAME.test(credential.id) && !credentials.has(credential.id), `${at}, credential ${credential.id}: the id must be a unique name`);
		credentials.add(credential.id);
		text(credential.label, `${at}, credential ${credential.id}: label`);
	}
	check(provider.models.length > 0, `${at}: at least one model is needed`);
	const models = new Set<string>();
	for (const model of provider.models) {
		check(!models.has(model.id), `${at}, model ${model.id}: declared twice`);
		models.add(model.id);
		validateModel(model, regions, `${at}, model ${model.id}`);
	}
}

function validateModel(model: CatalogModel, regions: ReadonlySet<string>, at: string): void {
	check(ID.test(model.id), `${at}: the id must be lowercase letters, digits, dots, dashes, or underscores`);
	text(model.label, `${at}: label`);
	const offered = Object.entries(model.providerModels);
	check(offered.length > 0, `${at}: at least one region must offer it`);
	for (const [region, providerModel] of offered) {
		check(regions.has(region), `${at}: providerModels names the region ${region}, which the provider does not declare`);
		check(typeof providerModel === 'string' && /^\S{1,256}$/.test(providerModel), `${at}: the id sent in ${region} must be one word`);
	}
	const kind = model.kind ?? 'video';
	check(kind === 'image' || kind === 'video', `${at}: kind must be image or video`);
	if (kind === 'image') {
		check(model.outputFormat !== undefined && IMAGE_FORMATS.has(model.outputFormat), `${at}: an image model declares its outputFormat, png, jpeg, or webp`);
		check(model.modes.every(mode => mode.id === 'reference' && mode.inputs.startFrame === 'none' && mode.inputs.endFrame === 'none' && mode.inputs.videos.max === 0 && mode.inputs.audios.max === 0 && mode.inputs.source === 'none'), `${at}: an image model offers the one mode reference, with images only`);
	} else {
		check(model.outputFormat === undefined, `${at}: only an image model declares an outputFormat`);
	}
	check(model.answersAtOnce === undefined || typeof model.answersAtOnce === 'boolean', `${at}: answersAtOnce must be true or false`);
	if (model.deprecatedIn !== undefined) {
		check(model.deprecatedIn.length > 0 && new Set(model.deprecatedIn).size === model.deprecatedIn.length && model.deprecatedIn.every(region => model.providerModels[region] !== undefined), `${at}: deprecatedIn must name regions that offer the model, each once`);
	}
	const count = model.parameters.find(parameter => parameter.name === 'count');
	if (count) {
		check(kind === 'image' && count.kind === 'integer' && count.min >= 1 && count.max <= MAX_OUTPUTS && count.step === 1, `${at}: count is a whole number from 1 to at most ${MAX_OUTPUTS}, on an image model`);
	}
	check(['always', 'withoutMedia', 'never'].includes(model.prompt.required), `${at}: prompt.required must be always, withoutMedia, or never`);
	check(Number.isInteger(model.prompt.maxLength) && model.prompt.maxLength > 0, `${at}: prompt.maxLength must be a positive whole number`);
	check(model.modes.length > 0, `${at}: at least one mode is needed`);
	const modes = new Set<string>();
	for (const mode of model.modes) {
		check(MODE_IDS.has(mode.id), `${at}, mode ${mode.id}: the id must be frames, reference, extend, or edit`);
		check(!modes.has(mode.id), `${at}, mode ${mode.id}: declared twice`);
		modes.add(mode.id);
		validateMode(mode, `${at}, mode ${mode.id}`);
		if (mode.regions !== undefined) {
			check(mode.regions.length > 0 && new Set(mode.regions).size === mode.regions.length, `${at}, mode ${mode.id}: regions must name at least one region, each once`);
			for (const region of mode.regions) {
				check(model.providerModels[region] !== undefined, `${at}, mode ${mode.id}: regions names ${region}, which does not offer the model`);
			}
		}
	}
	const names = new Set<string>();
	for (const parameter of model.parameters) {
		const where = `${at}, parameter ${parameter.name}`;
		check(PARAMETER_NAME.test(parameter.name), `${where}: the name must be letters, digits, dots, or underscores`);
		check(!names.has(parameter.name), `${where}: declared twice`);
		names.add(parameter.name);
		validateParameter(parameter, modes, where);
		if (parameter.setByStartFrame !== undefined) {
			check(typeof parameter.setByStartFrame === 'boolean', `${where}: setByStartFrame must be true or false`);
			check(!parameter.setByStartFrame || model.modes.some(mode => (!parameter.modes || parameter.modes.includes(mode.id)) && mode.inputs.startFrame !== 'none'), `${where}: setByStartFrame needs a mode with a start frame`);
		}
	}
}

function validateSlot(slot: CountSlot, where: string): void {
	check(Number.isInteger(slot.min) && Number.isInteger(slot.max) && slot.min >= 0 && slot.min <= slot.max && slot.max <= 100, `${where}: min and max must be whole numbers with 0 ≤ min ≤ max ≤ 100`);
}

function validateRange(range: readonly [number, number] | undefined, where: string): void {
	if (range !== undefined) {
		check(range.length === 2 && range.every(value => Number.isFinite(value) && value > 0) && range[0] <= range[1], `${where}: the range must be two positive numbers, the smaller first`);
	}
}

function validatePositive(value: number | undefined, where: string): void {
	check(value === undefined || (Number.isFinite(value) && value > 0), `${where}: must be a positive number`);
}

function validateMode(mode: CatalogMode, at: string): void {
	text(mode.label, `${at}: label`);
	const inputs = mode.inputs;
	check(SLOT_USES.has(inputs.startFrame) && SLOT_USES.has(inputs.endFrame), `${at}: startFrame and endFrame must be none, optional, or required`);
	check(!(inputs.startFrame === 'none' && inputs.endFrame !== 'none'), `${at}: an end frame needs a start frame`);
	check(inputs.source === 'none' || inputs.source === 'required', `${at}: source must be none or required`);
	validateSlot(inputs.images, `${at}: images`);
	validateSlot(inputs.videos, `${at}: videos`);
	validateSlot(inputs.audios, `${at}: audios`);
	const limits = mode.limits;
	if (limits.imageFormats !== undefined) {
		const formats = new Set<string>(limits.imageFormats);
		check(formats.size === limits.imageFormats.length && [...formats].every(format => IMAGE_FORMATS.has(format)), `${at}: limits.imageFormats must name png, jpeg, or webp, each once`);
		check(formats.has('png'), `${at}: limits.imageFormats must include png, the format the window draws other images to`);
	}
	validatePositive(limits.imageMinSide, `${at}: limits.imageMinSide`);
	validatePositive(limits.imageMaxSide, `${at}: limits.imageMaxSide`);
	check(limits.imageMinSide === undefined || limits.imageMaxSide === undefined || limits.imageMinSide <= limits.imageMaxSide, `${at}: limits.imageMinSide must not exceed imageMaxSide`);
	validateRange(limits.imageAspect, `${at}: limits.imageAspect`);
	validatePositive(limits.imageMaxBytes, `${at}: limits.imageMaxBytes`);
	validateRange(limits.videoSeconds, `${at}: limits.videoSeconds`);
	validatePositive(limits.videoTotalSeconds, `${at}: limits.videoTotalSeconds`);
	validatePositive(limits.videoMaxBytes, `${at}: limits.videoMaxBytes`);
	validateRange(limits.audioSeconds, `${at}: limits.audioSeconds`);
	validatePositive(limits.audioTotalSeconds, `${at}: limits.audioTotalSeconds`);
	validatePositive(limits.audioMaxBytes, `${at}: limits.audioMaxBytes`);
}

function validateParameter(parameter: CatalogParameter, modes: ReadonlySet<string>, at: string): void {
	text(parameter.label, `${at}: label`);
	if (parameter.modes !== undefined) {
		check(parameter.modes.length > 0, `${at}: modes must name at least one mode`);
		for (const mode of parameter.modes) {
			check(modes.has(mode), `${at}: modes names ${mode}, which the model does not declare`);
		}
	}
	check(parameter.optional === true || parameter.default !== undefined, `${at}: a parameter that is not optional needs a default`);
	switch (parameter.kind) {
		case 'choice': {
			check(parameter.options.length > 0, `${at}: a choice needs options`);
			const values = new Set<string | number>();
			for (const option of parameter.options) {
				check(typeof option.value === 'string' || Number.isFinite(option.value), `${at}: an option value must be text or a number`);
				check(!values.has(option.value), `${at}: the option ${String(option.value)} is declared twice`);
				values.add(option.value);
				text(option.label, `${at}: the label of option ${String(option.value)}`);
			}
			check(parameter.default === undefined || values.has(parameter.default), `${at}: the default ${String(parameter.default)} is not one of the options`);
			check(parameter.display === undefined || parameter.display === 'ratio', `${at}: display must be ratio`);
			break;
		}
		case 'integer':
		case 'number': {
			const whole = parameter.kind === 'integer';
			const isValue = (value: number) => Number.isFinite(value) && (!whole || Number.isInteger(value));
			check(isValue(parameter.min) && isValue(parameter.max) && parameter.min <= parameter.max, `${at}: min and max must be ${whole ? 'whole ' : ''}numbers with min ≤ max`);
			check(isValue(parameter.step) && parameter.step > 0, `${at}: the step must be a positive ${whole ? 'whole ' : ''}number`);
			if (parameter.default !== undefined) {
				const isAuto = parameter.auto !== undefined && parameter.default === parameter.auto.value;
				check(isAuto || (isValue(parameter.default) && parameter.default >= parameter.min && parameter.default <= parameter.max), `${at}: the default ${parameter.default} is outside [${parameter.min}, ${parameter.max}]`);
				const steps = (parameter.default - parameter.min) / parameter.step;
				check(isAuto || Math.abs(steps - Math.round(steps)) < 1e-9, `${at}: the default ${parameter.default} is not a multiple of the step ${parameter.step} from ${parameter.min}`);
			}
			if (parameter.auto !== undefined) {
				check(isValue(parameter.auto.value) && (parameter.auto.value < parameter.min || parameter.auto.value > parameter.max), `${at}: the auto value must lie outside [${parameter.min}, ${parameter.max}]`);
				text(parameter.auto.label, `${at}: the auto label`);
			}
			check(parameter.unit === undefined || parameter.unit === 'seconds', `${at}: the unit must be seconds`);
			break;
		}
		case 'boolean':
			check(parameter.default === undefined || typeof parameter.default === 'boolean', `${at}: the default must be true or false`);
			break;
		case 'text':
			check(Number.isInteger(parameter.maxLength) && parameter.maxLength > 0, `${at}: maxLength must be a positive whole number`);
			check(parameter.default === undefined || (typeof parameter.default === 'string' && [...parameter.default].length <= parameter.maxLength), `${at}: the default is longer than maxLength`);
			break;
		default:
			throw new Error(`${at}: the kind must be choice, integer, number, boolean, or text`);
	}
}

function check(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(`Invalid video catalog: ${message}.`);
	}
}

function text(value: string | undefined, where: string): void {
	check(typeof value === 'string' && value.trim().length > 0 && value.length <= 200, `${where} must be text of 1 to 200 characters`);
}

function isHttps(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
	} catch {
		return false;
	}
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) {
			deepFreeze(child);
		}
	}
	return value;
}

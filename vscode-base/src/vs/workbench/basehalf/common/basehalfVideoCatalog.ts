/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { language } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';

/**
 * The model catalog as the window receives it from the AI Video extension,
 * and the payloads of the provider commands (D59, video providers and the
 * model catalog). The window draws the panel, the settings, the Video
 * Providers page, and the estimate from this catalog; nothing here names a
 * provider or a model. The extension mirrors these types in
 * `extensions/basehalf-ai-video/src/providers/types.ts`; the two must stay
 * the same.
 *
 * Below the types, the window's pure functions over the catalog: reading
 * it, normalizing a node's values, planning its inputs from a mode's slots,
 * building the prompt, summing up the settings, and the Generate blockers
 * (video node specification, "Settings", "Inputs", and "The panel"). They are
 * the window's alone and are not mirrored.
 */

// --- The catalog ------------------------------------------------------------------------------

export type BaseHalfVideoCurrency = 'CNY' | 'USD';

/** How a mode uses the node's inputs (video providers, "Modes and inputs"). */
export type BaseHalfVideoModeId = 'frames' | 'reference' | 'extend' | 'edit';

export type BaseHalfVideoSlotUse = 'none' | 'optional' | 'required';

export interface IBaseHalfVideoCatalog {
	/** Changes when the shape of the catalog changes. */
	readonly schema: 1;
	readonly providers: readonly IBaseHalfVideoCatalogProvider[];
}

export interface IBaseHalfVideoCatalogRegion {
	readonly id: string;
	readonly label: string;
	readonly baseUrl: string;
	readonly currency: BaseHalfVideoCurrency;
	/** Where the user gets credentials for this region. */
	readonly console?: string;
}

/** One value the provider needs to accept a request. Every value is a secret. */
export interface IBaseHalfVideoCatalogCredential {
	readonly id: string;
	readonly label: string;
	readonly placeholder?: string;
}

export interface IBaseHalfVideoCatalogProvider {
	/** Stable; what a node stores. */
	readonly id: string;
	readonly label: string;
	/** At least one. The first is the default. */
	readonly regions: readonly IBaseHalfVideoCatalogRegion[];
	/** At least one, in order. */
	readonly credentials: readonly IBaseHalfVideoCatalogCredential[];
	readonly models: readonly IBaseHalfVideoCatalogModel[];
}

export interface IBaseHalfVideoCatalogModel {
	/** Stable within its provider; what a node stores. */
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** For each region that offers the model, the id sent to the provider there. */
	readonly providerModels: Readonly<Record<string, string>>;
	readonly prompt: IBaseHalfVideoPromptRule;
	/** At least one. The first is the default. */
	readonly modes: readonly IBaseHalfVideoCatalogMode[];
	readonly parameters: readonly BaseHalfVideoCatalogParameter[];
	/** Whether `check` answers an estimate for this model. */
	readonly estimate: boolean;
	/** Listed only for nodes that already use it. */
	readonly deprecated?: boolean;
}

export interface IBaseHalfVideoPromptRule {
	/** `withoutMedia`: required when the mode sends no image and no video. */
	readonly required: 'always' | 'withoutMedia' | 'never';
	/** Characters of the prompt as sent, text inputs included. */
	readonly maxLength: number;
}

export interface IBaseHalfVideoCountSlot {
	readonly min: number;
	readonly max: number;
}

export interface IBaseHalfVideoModeInputs {
	readonly startFrame: BaseHalfVideoSlotUse;
	readonly endFrame: BaseHalfVideoSlotUse;
	/** Reference images. */
	readonly images: IBaseHalfVideoCountSlot;
	readonly videos: IBaseHalfVideoCountSlot;
	readonly audios: IBaseHalfVideoCountSlot;
	/** The clip of `extend` and `edit`. */
	readonly source: 'none' | 'required';
}

/** An image format a provider takes. */
export type BaseHalfVideoImageFormat = 'png' | 'jpeg' | 'webp';

/** Checked by `check` before anything is sent. Any may be absent. */
export interface IBaseHalfVideoModeLimits {
	/** The image formats the provider takes, PNG among them; all three when absent. The window draws any other image to PNG. */
	readonly imageFormats?: readonly BaseHalfVideoImageFormat[];
	readonly imageMinSide?: number;
	readonly imageMaxSide?: number;
	/** Width divided by height, inclusive. */
	readonly imageAspect?: readonly [number, number];
	readonly imageMaxBytes?: number;
	readonly videoSeconds?: readonly [number, number];
	readonly videoTotalSeconds?: number;
	readonly videoMaxBytes?: number;
	readonly audioSeconds?: readonly [number, number];
	readonly audioTotalSeconds?: number;
	readonly audioMaxBytes?: number;
}

export interface IBaseHalfVideoCatalogMode {
	readonly id: BaseHalfVideoModeId;
	readonly label: string;
	readonly inputs: IBaseHalfVideoModeInputs;
	readonly limits: IBaseHalfVideoModeLimits;
	/** The regions that offer the mode, when not every region that offers the model does. */
	readonly regions?: readonly string[];
}

export type BaseHalfVideoParamValue = string | number | boolean;
export type BaseHalfVideoParams = Readonly<Record<string, BaseHalfVideoParamValue>>;

interface IBaseHalfVideoParameterBase {
	/** The key in the node's `params`. */
	readonly name: string;
	readonly label: string;
	readonly tooltip?: string;
	/** The modes the parameter applies to; all when absent. */
	readonly modes?: readonly BaseHalfVideoModeId[];
	/** Shown under More. */
	readonly advanced?: boolean;
	/** May be left unset; nothing is sent then. A parameter that is not optional has a default. */
	readonly optional?: boolean;
	/** A start frame decides it: with a start frame, nothing is sent or recorded for it. */
	readonly setByStartFrame?: boolean;
}

export interface IBaseHalfVideoChoiceParameter extends IBaseHalfVideoParameterBase {
	readonly kind: 'choice';
	readonly options: readonly { readonly value: string | number; readonly label: string }[];
	readonly default?: string | number;
	/** `ratio` draws each value as a small ratio shape. */
	readonly display?: 'ratio';
}

export interface IBaseHalfVideoNumberParameter extends IBaseHalfVideoParameterBase {
	readonly kind: 'integer' | 'number';
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly default?: number;
	readonly unit?: 'seconds';
	/** A value outside the range that lets the provider decide, such as -1 for Auto. */
	readonly auto?: { readonly value: number; readonly label: string };
}

export interface IBaseHalfVideoBooleanParameter extends IBaseHalfVideoParameterBase {
	readonly kind: 'boolean';
	readonly default?: boolean;
}

export interface IBaseHalfVideoTextParameter extends IBaseHalfVideoParameterBase {
	readonly kind: 'text';
	readonly default?: string;
	readonly maxLength: number;
	readonly multiline?: boolean;
}

export type BaseHalfVideoCatalogParameter =
	| IBaseHalfVideoChoiceParameter
	| IBaseHalfVideoNumberParameter
	| IBaseHalfVideoBooleanParameter
	| IBaseHalfVideoTextParameter;

// --- The provider commands ---------------------------------------------------------------------

/** The internal commands of AI Video (video providers, "Requests"). */
export const BASEHALF_VIDEO_PROVIDER_COMMANDS = Object.freeze({
	catalog: 'basehalf.video.provider.catalog',
	check: 'basehalf.video.provider.check',
	submit: 'basehalf.video.provider.submit',
	poll: 'basehalf.video.provider.poll',
	download: 'basehalf.video.provider.download',
	cancel: 'basehalf.video.provider.cancel'
});

/** Where a request goes and with what: the provider, its region, the endpoint in use, and the credential values by id. */
export interface IBaseHalfVideoProviderAccess {
	readonly provider: string;
	readonly region: string;
	/** The region's base URL, or the one the user entered. */
	readonly endpoint: string;
	readonly credentials: Readonly<Record<string, string>>;
}

/** A file of the workspace, or an image the window drew (an SVG made a PNG). */
export type BaseHalfVideoMedia =
	| { readonly fsPath: string; readonly mimeType: string }
	| { readonly dataUrl: string };

/** The planned inputs of a generation, by the slots of its mode. */
export interface IBaseHalfVideoPlannedMedia {
	readonly startFrame?: BaseHalfVideoMedia;
	readonly endFrame?: BaseHalfVideoMedia;
	readonly images: readonly BaseHalfVideoMedia[];
	readonly videos: readonly BaseHalfVideoMedia[];
	readonly audios: readonly BaseHalfVideoMedia[];
	readonly source?: BaseHalfVideoMedia;
}

/** The planned inputs counted, for a check without files. */
export interface IBaseHalfVideoPlannedCounts {
	readonly startFrame: boolean;
	readonly endFrame: boolean;
	readonly images: number;
	readonly videos: number;
	readonly audios: number;
	readonly source: boolean;
}

export interface IBaseHalfVideoCheckRequest {
	readonly provider: string;
	readonly region: string;
	readonly model: string;
	readonly mode: BaseHalfVideoModeId;
	/** Every parameter that applies, with its value or default; optional ones only when set. */
	readonly params: BaseHalfVideoParams;
	/** The prompt as it would be sent, text inputs included. */
	readonly prompt: string;
	/** With media, the module measures the files; with counts, it checks counts only. */
	readonly inputs: IBaseHalfVideoPlannedMedia | IBaseHalfVideoPlannedCounts;
}

export interface IBaseHalfVideoEstimate {
	readonly currency: BaseHalfVideoCurrency;
	readonly min: number;
	/** Equal to `min` for a single amount. */
	readonly max: number;
	/** The date of the provider's price list, `YYYY-MM-DD`. */
	readonly priceDate: string;
}

export interface IBaseHalfVideoCheckResult {
	/** Plain sentences, the first being what blocks the generation. Empty when it can run. */
	readonly problems: readonly string[];
	readonly estimate?: IBaseHalfVideoEstimate;
	/** The id the request would be sent with, for a model whose modes and inputs choose among several. */
	readonly providerModel?: string;
}

export interface IBaseHalfVideoSubmitRequest extends IBaseHalfVideoProviderAccess {
	readonly model: string;
	readonly mode: BaseHalfVideoModeId;
	readonly params: BaseHalfVideoParams;
	readonly prompt: string;
	readonly inputs: IBaseHalfVideoPlannedMedia;
}

export interface IBaseHalfVideoSubmitResult {
	/** The provider's task id. */
	readonly remoteId: string;
}

export interface IBaseHalfVideoTaskRef extends IBaseHalfVideoProviderAccess {
	readonly model: string;
	readonly remoteId: string;
}

export type BaseHalfVideoPollState =
	| { readonly state: 'pending' | 'running'; readonly fraction?: number }
	| { readonly state: 'succeeded'; readonly videoUrl?: string }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

export interface IBaseHalfVideoDownloadRequest extends IBaseHalfVideoTaskRef {
	/** From the poll; without it, the provider module knows where the video is. */
	readonly videoUrl?: string;
	/** A new file whose name ends in `.part`. */
	readonly targetFsPath: string;
}

export interface IBaseHalfVideoDownloadResult {
	readonly size: number;
}

export interface IBaseHalfVideoCancelResult {
	readonly cancelled: boolean;
}

export type BaseHalfVideoProviderErrorCode =
	| 'auth'
	| 'rejected'
	| 'rateLimited'
	| 'balance'
	| 'unknownOutcome'
	| 'network'
	| 'invalidResponse'
	| 'notFound'
	| 'notVideo'
	| 'tooLarge'
	| 'unknownProvider';

export interface IBaseHalfVideoProviderError {
	readonly code: BaseHalfVideoProviderErrorCode;
	/** Plain text of at most 1,000 characters, without credentials, markup, or request bodies. */
	readonly message: string;
	readonly status?: number;
}

export type BaseHalfVideoProviderResponse<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: IBaseHalfVideoProviderError };

// ================================================================================================
// The window's functions over the catalog. Not mirrored by the extension.
// ================================================================================================

export const BASEHALF_VIDEO_MODE_IDS: readonly BaseHalfVideoModeId[] = Object.freeze(['frames', 'reference', 'extend', 'edit']);

/** What the window knows of the catalog: still asking, the answer, or why there is none. */
export type BaseHalfVideoCatalogState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready'; readonly catalog: IBaseHalfVideoCatalog }
	| { readonly kind: 'failed'; readonly message: string };

/** What a Video node's `generation` names: the next generation's provider, model, mode, and values. */
export interface IBaseHalfVideoGenerationChoice {
	readonly provider?: string;
	readonly model?: string;
	readonly mode?: BaseHalfVideoModeId;
	readonly params?: BaseHalfVideoParams;
}

/** A model of the catalog with its provider. */
export interface IBaseHalfVideoModelRef {
	readonly provider: IBaseHalfVideoCatalogProvider;
	readonly model: IBaseHalfVideoCatalogModel;
}

/** How a provider is set up on this computer, as far as the panel needs it. */
export interface IBaseHalfVideoProviderSetup {
	/** The region in use: the one the user chose, or the provider's first. */
	readonly region: IBaseHalfVideoCatalogRegion;
	/** Every declared credential value is set. */
	readonly setUp: boolean;
}

// --- Finding ---------------------------------------------------------------------------------------

export function findBaseHalfVideoProvider(catalog: IBaseHalfVideoCatalog | undefined, providerId: string | undefined): IBaseHalfVideoCatalogProvider | undefined {
	return providerId === undefined ? undefined : catalog?.providers.find(provider => provider.id === providerId);
}

export function findBaseHalfVideoModel(catalog: IBaseHalfVideoCatalog | undefined, providerId: string | undefined, modelId: string | undefined): IBaseHalfVideoModelRef | undefined {
	const provider = findBaseHalfVideoProvider(catalog, providerId);
	const model = modelId === undefined ? undefined : provider?.models.find(candidate => candidate.id === modelId);
	return provider && model ? Object.freeze({ provider, model }) : undefined;
}

/** The region with that id, or the provider's first when there is none. */
export function findBaseHalfVideoRegion(provider: IBaseHalfVideoCatalogProvider, regionId: string | undefined): IBaseHalfVideoCatalogRegion {
	return provider.regions.find(region => region.id === regionId) ?? provider.regions[0];
}

/** Whether the region offers the model: the model names the id sent to the provider there. */
export function baseHalfVideoRegionOffersModel(model: IBaseHalfVideoCatalogModel, regionId: string): boolean {
	return typeof model.providerModels[regionId] === 'string' && model.providerModels[regionId].length > 0;
}

/** Whether the region offers the mode: every region that offers the model does, unless the mode names its regions. */
export function baseHalfVideoRegionOffersMode(mode: IBaseHalfVideoCatalogMode, regionId: string): boolean {
	return !mode.regions || mode.regions.includes(regionId);
}

/**
 * The values a generation sends and records: the node's, made legal for the
 * model and mode, without those a start frame sets while the plan has one
 * (video providers, "Parameters").
 */
export function baseHalfVideoSentParams(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId, params: BaseHalfVideoParams, startFrame: boolean): BaseHalfVideoParams {
	if (!startFrame) {
		return params;
	}
	const sent: Record<string, BaseHalfVideoParamValue> = { ...params };
	for (const parameter of baseHalfVideoModeParameters(model, modeId)) {
		if (parameter.setByStartFrame) {
			delete sent[parameter.name];
		}
	}
	return Object.freeze(sent);
}

/** The mode a generation uses: the one asked for when the model offers it, otherwise the model's first. */
export function baseHalfVideoModeOf(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | string | undefined): IBaseHalfVideoCatalogMode {
	return model.modes.find(mode => mode.id === modeId) ?? model.modes[0];
}

/** The parameters that apply to a mode, in the order the model declares them. */
export function baseHalfVideoModeParameters(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId): readonly BaseHalfVideoCatalogParameter[] {
	return model.parameters.filter(parameter => !parameter.modes || parameter.modes.includes(modeId));
}

/** The models a menu lists for a node: those that are not deprecated, and the node's own. */
export function baseHalfVideoListedModels(provider: IBaseHalfVideoCatalogProvider, chosen: IBaseHalfVideoGenerationChoice | undefined): readonly IBaseHalfVideoCatalogModel[] {
	return provider.models.filter(model => !model.deprecated || (chosen?.provider === provider.id && chosen.model === model.id));
}

// --- Values ----------------------------------------------------------------------------------------

/** Whether a parameter takes a value: a choice of its options, a number in its range and on its steps (or its Auto), a boolean, or text within its length. */
export function isBaseHalfVideoParamValueAccepted(parameter: BaseHalfVideoCatalogParameter, value: unknown): value is BaseHalfVideoParamValue {
	switch (parameter.kind) {
		case 'choice':
			return (typeof value === 'string' || typeof value === 'number') && parameter.options.some(option => option.value === value);
		case 'integer':
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return false;
			}
			if (parameter.auto && value === parameter.auto.value) {
				return true;
			}
			if (parameter.kind === 'integer' && !Number.isInteger(value)) {
				return false;
			}
			return value >= parameter.min && value <= parameter.max && isOnStep(value, parameter.min, parameter.step);
		}
		case 'boolean':
			return typeof value === 'boolean';
		case 'text':
			return typeof value === 'string' && value.length <= parameter.maxLength && !value.includes('\u0000');
	}
}

/**
 * The value a parameter that is not optional has when the node gives none:
 * its default, or for one that declares none, its first choice, its lowest
 * number, off, or empty text. For an optional parameter, its declared
 * default, which is never filled in: an optional parameter the node leaves
 * unset sends nothing.
 */
export function baseHalfVideoParameterDefault(parameter: BaseHalfVideoCatalogParameter): BaseHalfVideoParamValue | undefined {
	if (parameter.default !== undefined && isBaseHalfVideoParamValueAccepted(parameter, parameter.default)) {
		return parameter.default;
	}
	if (parameter.optional) {
		return undefined;
	}
	switch (parameter.kind) {
		case 'choice': return parameter.options[0]?.value;
		case 'integer':
		case 'number': return parameter.min;
		case 'boolean': return false;
		case 'text': return '';
	}
}

/**
 * The values a generation uses: every value the model and mode accept is
 * kept, every other parameter that applies gets its default, unknown names
 * and parameters the mode does not use are dropped, and an optional
 * parameter is kept only when it is set to a value it accepts (empty text is
 * not set). This is what the panel shows, what the node stores after a
 * change, and what is sent.
 */
export function normalizeBaseHalfVideoParams(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | undefined, params: Readonly<Record<string, unknown>> | undefined): BaseHalfVideoParams {
	const mode = baseHalfVideoModeOf(model, modeId);
	const result: Record<string, BaseHalfVideoParamValue> = {};
	for (const parameter of baseHalfVideoModeParameters(model, mode.id)) {
		const value = params && Object.prototype.hasOwnProperty.call(params, parameter.name) ? params[parameter.name] : undefined;
		const accepted = value !== undefined && isBaseHalfVideoParamValueAccepted(parameter, value);
		if (parameter.optional) {
			if (accepted && !(parameter.kind === 'text' && value === '')) {
				result[parameter.name] = value;
			}
			continue;
		}
		const fallback = accepted ? value : baseHalfVideoParameterDefault(parameter);
		if (fallback !== undefined) {
			result[parameter.name] = fallback;
		}
	}
	return Object.freeze(result);
}

/** The generation after the user chose a model: every value the new model and mode accept is kept, the others take their defaults. */
export function baseHalfVideoChooseModel(generation: IBaseHalfVideoGenerationChoice | undefined, ref: IBaseHalfVideoModelRef): IBaseHalfVideoGenerationChoice {
	const mode = baseHalfVideoModeOf(ref.model, generation?.mode);
	return Object.freeze({
		provider: ref.provider.id,
		model: ref.model.id,
		mode: mode.id,
		params: normalizeBaseHalfVideoParams(ref.model, mode.id, generation?.params)
	});
}

/** The generation after the user chose a mode of its model. */
export function baseHalfVideoChooseMode(generation: IBaseHalfVideoGenerationChoice, model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId): IBaseHalfVideoGenerationChoice {
	const mode = baseHalfVideoModeOf(model, modeId);
	return Object.freeze({ ...generation, mode: mode.id, params: normalizeBaseHalfVideoParams(model, mode.id, generation.params) });
}

/** The generation after one value changed; `undefined` leaves an optional parameter unset. */
export function baseHalfVideoChangeParam(generation: IBaseHalfVideoGenerationChoice, model: IBaseHalfVideoCatalogModel, name: string, value: BaseHalfVideoParamValue | undefined): IBaseHalfVideoGenerationChoice {
	const mode = baseHalfVideoModeOf(model, generation.mode);
	const current = { ...normalizeBaseHalfVideoParams(model, mode.id, generation.params) };
	if (value === undefined) {
		delete current[name];
	} else {
		current[name] = value;
	}
	return Object.freeze({ ...generation, mode: mode.id, params: normalizeBaseHalfVideoParams(model, mode.id, current) });
}

/**
 * The generation a new Video node starts with: the last one on this
 * computer, made legal for its model. A model that is deprecated or no longer
 * in the catalog is not chosen. Without the catalog, the last values are
 * kept as they were stored: they were legal when they were used.
 */
export function baseHalfVideoInitialGeneration(lastUsed: IBaseHalfVideoGenerationChoice | undefined, catalog: IBaseHalfVideoCatalog | undefined): IBaseHalfVideoGenerationChoice | undefined {
	if (!lastUsed?.model) {
		return undefined;
	}
	if (!catalog) {
		return lastUsed;
	}
	const ref = findBaseHalfVideoModel(catalog, lastUsed.provider, lastUsed.model);
	if (!ref || ref.model.deprecated) {
		return undefined;
	}
	return baseHalfVideoChooseModel(lastUsed, ref);
}

/** The number of values a number parameter has from its lowest to its highest. */
export function baseHalfVideoNumberSteps(parameter: IBaseHalfVideoNumberParameter): number {
	if (!(parameter.step > 0) || parameter.max < parameter.min) {
		return 1;
	}
	return Math.floor((parameter.max - parameter.min) / parameter.step + 1e-9) + 1;
}

/** The values of a number parameter with few steps, lowest first. */
export function baseHalfVideoNumberValues(parameter: IBaseHalfVideoNumberParameter): readonly number[] {
	const count = Math.min(baseHalfVideoNumberSteps(parameter), 1000);
	const decimals = stepDecimals(parameter.step);
	return Object.freeze(Array.from({ length: count }, (_value, index) => Number((parameter.min + index * parameter.step).toFixed(decimals))));
}

function isOnStep(value: number, min: number, step: number): boolean {
	if (!(step > 0)) {
		return value === min;
	}
	const steps = (value - min) / step;
	return Math.abs(steps - Math.round(steps)) < 1e-6;
}

function stepDecimals(step: number): number {
	const text = String(step);
	const exponent = /e-(\d+)$/.exec(text);
	if (exponent) {
		return Math.min(10, Number(exponent[1]));
	}
	const dot = text.indexOf('.');
	return dot < 0 ? 0 : Math.min(10, text.length - dot - 1);
}

// --- What the settings say -------------------------------------------------------------------------

/** A number as its parameter writes it: at most as many decimals as its step has. */
export function formatBaseHalfVideoNumber(parameter: IBaseHalfVideoNumberParameter, value: number): string {
	return String(Number(value.toFixed(stepDecimals(parameter.step))));
}

/**
 * A value as the settings button and Card Detail say it: a choice by its
 * option's label, Auto by its label, seconds as `5s`, any other number as the
 * number, a boolean as on or off, and text with its whitespace collapsed.
 */
export function baseHalfVideoParamValueLabel(parameter: BaseHalfVideoCatalogParameter, value: BaseHalfVideoParamValue): string {
	switch (parameter.kind) {
		case 'choice':
			return parameter.options.find(option => option.value === value)?.label ?? String(value);
		case 'integer':
		case 'number':
			if (typeof value !== 'number') {
				return String(value);
			}
			if (parameter.auto && value === parameter.auto.value) {
				return parameter.auto.label;
			}
			return parameter.unit === 'seconds'
				? localize('basehalf.video.catalog.settings.seconds', "{0}s", formatBaseHalfVideoNumber(parameter, value))
				: formatBaseHalfVideoNumber(parameter, value);
		case 'boolean':
			return value === true
				? localize('basehalf.video.catalog.settings.on', "On")
				: localize('basehalf.video.catalog.settings.off', "Off");
		case 'text':
			return String(value).replace(/\s+/g, ' ').trim();
	}
}

/**
 * The summary of the settings (video node specification, "Settings"): the
 * mode, then each parameter that is not advanced and has a value, such as
 * `Frames · 720p · 5s · Sound`.
 */
export function baseHalfVideoSettingsSummary(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | undefined, params: BaseHalfVideoParams | undefined, startFrame = false): readonly string[] {
	const mode = baseHalfVideoModeOf(model, modeId);
	const values = normalizeBaseHalfVideoParams(model, mode.id, params);
	const parts = [mode.label];
	for (const parameter of baseHalfVideoModeParameters(model, mode.id)) {
		const value = values[parameter.name];
		if (parameter.advanced || value === undefined || (startFrame && parameter.setByStartFrame)) {
			continue;
		}
		const part = summaryPart(parameter, value);
		if (part) {
			parts.push(part);
		}
	}
	return Object.freeze(parts);
}

function summaryPart(parameter: BaseHalfVideoCatalogParameter, value: BaseHalfVideoParamValue): string {
	switch (parameter.kind) {
		case 'choice':
			return baseHalfVideoParamValueLabel(parameter, value);
		case 'integer':
		case 'number':
			if (typeof value === 'number' && !(parameter.auto && value === parameter.auto.value) && parameter.unit !== 'seconds') {
				return localize('basehalf.video.catalog.settings.numberPart', "{0} {1}", parameter.label, formatBaseHalfVideoNumber(parameter, value));
			}
			return baseHalfVideoParamValueLabel(parameter, value);
		case 'boolean':
			return value === true ? parameter.label : localize('basehalf.video.catalog.settings.offPart', "{0} off", parameter.label);
		case 'text': {
			const text = baseHalfVideoParamValueLabel(parameter, value);
			return text.length > 60 ? `${text.slice(0, 59)}…` : text;
		}
	}
}

/**
 * The estimate as the panel shows it: `≈ ¥7.56` for one amount, `¥3.00–¥9.00`
 * for a range, in the region's currency.
 */
export function formatBaseHalfVideoEstimate(estimate: IBaseHalfVideoEstimate): string {
	// Cents, half up: 7.555 is a little less than 7.555 in binary.
	const amount = (value: number) => `${estimate.currency === 'CNY' ? '¥' : '$'}${groupThousands((Math.round(value * 100 + 1e-6) / 100).toFixed(2))}`;
	return estimate.max > estimate.min
		? `${amount(estimate.min)}–${amount(estimate.max)}`
		: `≈ ${amount(estimate.min)}`;
}

/** What the estimate's tooltip says: where it comes from, and that the provider's bill counts. */
export function baseHalfVideoEstimateTooltip(estimate: IBaseHalfVideoEstimate, providerLabel: string): string {
	return localize('basehalf.video.catalog.estimateTooltip', "An estimate from the prices {0} published on {1}. What {0} bills is what counts.", providerLabel, estimate.priceDate);
}

function groupThousands(fixed: string): string {
	const [whole, fraction] = fixed.split('.');
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return fraction !== undefined ? `${grouped}.${fraction}` : grouped;
}

// --- Inputs ----------------------------------------------------------------------------------------

export type BaseHalfVideoInputKind = 'image' | 'video' | 'audio' | 'text' | 'other';

/** One upstream entry of a Video node, resolved: a `.bhnode` stands for the file it shows. */
export interface IBaseHalfVideoInputSource {
	/** The upstream entry, workspace-relative. */
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	/** False when the entry names nothing, or a node that shows no file yet. */
	readonly available: boolean;
}

/** What a generation does with an input: a frame, a reference, the clip of `extend` and `edit`, text for the prompt, or nothing. */
export type BaseHalfVideoInputUse = 'start-frame' | 'end-frame' | 'reference' | 'source' | 'text' | 'unused';

/**
 * Why an input is not used: `missing` names nothing; `kind` cannot be used,
 * such as a folder or a PDF; `mode` the mode takes no input of its kind;
 * `full` comes after what the mode takes.
 */
export type BaseHalfVideoInputUnusedReason = 'missing' | 'kind' | 'mode' | 'full';

export interface IBaseHalfVideoInputPlanItem {
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	readonly use: BaseHalfVideoInputUse;
	readonly reason?: BaseHalfVideoInputUnusedReason;
	/** The name a prompt uses for an image, video, or audio input, such as `图片1`. */
	readonly label?: string;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt']);

/** The input kind of an ordinary file, by its extension. A `.bhnode` is resolved by its owner. */
export function baseHalfVideoInputKindOfPath(path: string): BaseHalfVideoInputKind {
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	const dot = name.lastIndexOf('.');
	const extension = dot > 0 ? name.slice(dot + 1) : '';
	if (IMAGE_EXTENSIONS.has(extension)) {
		return 'image';
	}
	if (VIDEO_EXTENSIONS.has(extension)) {
		return 'video';
	}
	if (AUDIO_EXTENSIONS.has(extension)) {
		return 'audio';
	}
	if (TEXT_EXTENSIONS.has(extension)) {
		return 'text';
	}
	return 'other';
}

/**
 * The slots the panel and a generation assume while no model is chosen: a
 * start and an end frame. It is no model's declaration; Generate needs a
 * model of the catalog.
 */
export const BASEHALF_VIDEO_DEFAULT_MODE_INPUTS: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'optional',
	endFrame: 'optional',
	images: Object.freeze({ min: 0, max: 0 }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: 0 }),
	source: 'none'
});

/**
 * How a generation uses each input, in upstream order, from the slots the
 * mode declares (video node specification, "Inputs"). An image fills the
 * start frame, then the end frame, then the reference images, as far as the
 * mode has them; a video fills the clip, then the reference videos; audio
 * fills the reference audio. Text inputs join the prompt in every mode.
 * Images, videos, and audio are numbered by kind in upstream order, used or
 * not, so a name in the prompt keeps meaning the same input.
 */
export function planBaseHalfVideoInputs(
	inputs: IBaseHalfVideoModeInputs,
	sources: readonly IBaseHalfVideoInputSource[],
	displayLanguage: string = language
): readonly IBaseHalfVideoInputPlanItem[] {
	const ordinals = { image: 0, video: 0, audio: 0 };
	const taken = { startFrame: false, endFrame: false, source: false, image: 0, video: 0, audio: 0 };
	const hasStart = inputs.startFrame !== 'none';
	const hasEnd = inputs.endFrame !== 'none';
	const hasSource = inputs.source !== 'none';
	return Object.freeze(sources.map((source): IBaseHalfVideoInputPlanItem => {
		const label = source.kind === 'image' || source.kind === 'video' || source.kind === 'audio'
			? baseHalfVideoInputLabel(source.kind, ++ordinals[source.kind], displayLanguage)
			: undefined;
		const item = label !== undefined ? { path: source.path, kind: source.kind, label } : { path: source.path, kind: source.kind };
		const unused = (reason: BaseHalfVideoInputUnusedReason) => Object.freeze({ ...item, use: 'unused' as const, reason });
		const used = (use: BaseHalfVideoInputUse) => Object.freeze({ ...item, use });
		if (!source.available) {
			return unused('missing');
		}
		switch (source.kind) {
			case 'text':
				return used('text');
			case 'other':
				return unused('kind');
			case 'image':
				if (hasStart && !taken.startFrame) {
					taken.startFrame = true;
					return used('start-frame');
				}
				if (hasEnd && !taken.endFrame) {
					taken.endFrame = true;
					return used('end-frame');
				}
				if (taken.image < inputs.images.max) {
					taken.image++;
					return used('reference');
				}
				return unused(hasStart || hasEnd || inputs.images.max > 0 ? 'full' : 'mode');
			case 'video':
				if (hasSource && !taken.source) {
					taken.source = true;
					return used('source');
				}
				if (taken.video < inputs.videos.max) {
					taken.video++;
					return used('reference');
				}
				return unused(hasSource || inputs.videos.max > 0 ? 'full' : 'mode');
			case 'audio':
				if (taken.audio < inputs.audios.max) {
					taken.audio++;
					return used('reference');
				}
				return unused(inputs.audios.max > 0 ? 'full' : 'mode');
		}
	}));
}

/** The planned inputs counted, for a check without files. */
export function baseHalfVideoPlannedCounts(plan: readonly IBaseHalfVideoInputPlanItem[]): IBaseHalfVideoPlannedCounts {
	const references = (kind: BaseHalfVideoInputKind) => plan.filter(item => item.use === 'reference' && item.kind === kind).length;
	return Object.freeze({
		startFrame: plan.some(item => item.use === 'start-frame'),
		endFrame: plan.some(item => item.use === 'end-frame'),
		images: references('image'),
		videos: references('video'),
		audios: references('audio'),
		source: plan.some(item => item.use === 'source')
	});
}

/** Whether the plan sends an image, a video, or audio. */
export function baseHalfVideoPlanSendsMedia(plan: readonly IBaseHalfVideoInputPlanItem[]): boolean {
	return plan.some(item => item.use === 'start-frame' || item.use === 'end-frame' || item.use === 'reference' || item.use === 'source');
}

/** `图片1`, `视频2`, `音频1` in a Chinese display language; `Image 1`, `Video 2`, `Audio 1` otherwise. */
export function baseHalfVideoInputLabel(kind: 'image' | 'video' | 'audio', ordinal: number, displayLanguage: string = language): string {
	const chinese = displayLanguage.toLowerCase().startsWith('zh');
	switch (kind) {
		case 'image': return chinese ? `图片${ordinal}` : `Image ${ordinal}`;
		case 'video': return chinese ? `视频${ordinal}` : `Video ${ordinal}`;
		case 'audio': return chinese ? `音频${ordinal}` : `Audio ${ordinal}`;
	}
}

export interface IBaseHalfVideoLabelToken {
	readonly start: number;
	readonly end: number;
	readonly kind: 'image' | 'video' | 'audio';
	readonly ordinal: number;
}

const LABEL_TOKEN = /(图片|视频|音频)(\d{1,2})|\b(Image|Video|Audio) (\d{1,2})\b/g;

/** The input names a prompt contains, in both languages, so the panel can mark them. */
export function findBaseHalfVideoLabelTokens(prompt: string): readonly IBaseHalfVideoLabelToken[] {
	const tokens: IBaseHalfVideoLabelToken[] = [];
	for (const match of prompt.matchAll(LABEL_TOKEN)) {
		const word = match[1] ?? match[3];
		const digits = match[2] ?? match[4];
		const kind = word === '图片' || word === 'Image' ? 'image' : word === '视频' || word === 'Video' ? 'video' : 'audio';
		tokens.push(Object.freeze({ start: match.index, end: match.index + match[0].length, kind, ordinal: Number(digits) }));
	}
	return Object.freeze(tokens);
}

/** Removes a leading YAML front matter block, which holds a note's metadata, not its text. */
export function stripBaseHalfMarkdownFrontMatter(text: string): string {
	const normalized = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
	const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
	return match ? normalized.slice(match[0].length) : normalized;
}

/** The longest text one text input adds to the prompt. */
export const BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH = 16 * 1024;

/** The prompt sent: the node's prompt, then each text input in order, separated by a blank line. */
export function buildBaseHalfVideoPrompt(prompt: string, texts: readonly string[]): string {
	const parts = [prompt, ...texts.map(value => value.length > BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH ? value.slice(0, BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH) : value)]
		.map(part => part.trim())
		.filter(part => part.length > 0);
	return parts.join('\n\n');
}

// --- Whether the node can generate -------------------------------------------------------------------

/**
 * Why the node cannot generate now, checked in this order (video node
 * specification, "The panel"). The panel shows the first one next to a
 * disabled Generate button; the generation service refuses with the same.
 */
export type BaseHalfVideoGenerateBlocker =
	| { readonly kind: 'generating' }
	| { readonly kind: 'catalogLoading' }
	| { readonly kind: 'catalogFailed'; readonly message: string }
	| { readonly kind: 'noModel' }
	| { readonly kind: 'unknownModel'; readonly model: string }
	| { readonly kind: 'notSetUp'; readonly provider: IBaseHalfVideoCatalogProvider }
	| { readonly kind: 'region'; readonly model: IBaseHalfVideoCatalogModel; readonly region: IBaseHalfVideoCatalogRegion }
	/** The region offers the model, not its mode; `where` names the regions that do. */
	| { readonly kind: 'modeRegion'; readonly model: IBaseHalfVideoCatalogModel; readonly mode: IBaseHalfVideoCatalogMode; readonly where: string }
	/** The first problem the provider module reported for the planned generation. */
	| { readonly kind: 'check'; readonly message: string }
	| { readonly kind: 'nothingToSend' };

export interface IBaseHalfVideoGenerateBlockerInput {
	/** The node generates, in this window or in another one that its file names. */
	readonly generating: boolean;
	readonly catalog: BaseHalfVideoCatalogState;
	readonly generation: IBaseHalfVideoGenerationChoice | undefined;
	readonly setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup;
	/** What `check` reported for the planned generation, when it was asked. */
	readonly problems?: readonly string[];
	/** The node's prompt, as the panel holds it. */
	readonly prompt: string;
	readonly plan: readonly IBaseHalfVideoInputPlanItem[];
}

export function getBaseHalfVideoGenerateBlocker(input: IBaseHalfVideoGenerateBlockerInput): BaseHalfVideoGenerateBlocker | undefined {
	if (input.generating) {
		return { kind: 'generating' };
	}
	if (input.catalog.kind === 'loading') {
		return { kind: 'catalogLoading' };
	}
	if (input.catalog.kind === 'failed') {
		return { kind: 'catalogFailed', message: input.catalog.message };
	}
	const modelId = input.generation?.model;
	if (!modelId) {
		return { kind: 'noModel' };
	}
	const ref = findBaseHalfVideoModel(input.catalog.catalog, input.generation?.provider, modelId);
	if (!ref) {
		return { kind: 'unknownModel', model: modelId };
	}
	const setup = input.setup(ref.provider);
	if (!setup.setUp) {
		return { kind: 'notSetUp', provider: ref.provider };
	}
	if (!baseHalfVideoRegionOffersModel(ref.model, setup.region.id)) {
		return { kind: 'region', model: ref.model, region: setup.region };
	}
	const mode = baseHalfVideoModeOf(ref.model, input.generation?.mode);
	if (!baseHalfVideoRegionOffersMode(mode, setup.region.id)) {
		const where = ref.provider.regions.filter(region => baseHalfVideoRegionOffersMode(mode, region.id) && baseHalfVideoRegionOffersModel(ref.model, region.id)).map(region => region.label).join(', ');
		return { kind: 'modeRegion', model: ref.model, mode, where };
	}
	const problem = input.problems?.find(message => message.trim().length > 0);
	if (problem) {
		return { kind: 'check', message: problem.trim() };
	}
	if (!input.prompt.trim() && !input.plan.some(item => item.use !== 'unused')) {
		return { kind: 'nothingToSend' };
	}
	return undefined;
}

/** Whether a blocker is about the model or its provider: the model button is outlined for it. */
export function isBaseHalfVideoModelBlocker(blocker: BaseHalfVideoGenerateBlocker | undefined): boolean {
	return blocker?.kind === 'noModel' || blocker?.kind === 'unknownModel' || blocker?.kind === 'notSetUp' || blocker?.kind === 'region';
}

/** A blocker in words, as the Generate button, the model button, and a refused generation say it. */
export function baseHalfVideoGenerateBlockerText(blocker: BaseHalfVideoGenerateBlocker): string {
	switch (blocker.kind) {
		case 'generating':
			return localize('basehalf.video.catalog.blocker.generating', "This node is generating.");
		case 'catalogLoading':
			return localize('basehalf.video.catalog.blocker.catalogLoading', "The video models are still loading.");
		case 'catalogFailed':
			return localize('basehalf.video.catalog.blocker.catalogFailed', "BaseHalf could not load the video models: {0}", blocker.message);
		case 'noModel':
			return localize('basehalf.video.catalog.blocker.noModel', "Choose a model to generate.");
		case 'unknownModel':
			return localize('basehalf.video.catalog.blocker.unknownModel', "{0} is not a model BaseHalf offers. Choose another model.", blocker.model);
		case 'notSetUp':
			return localize('basehalf.video.catalog.blocker.notSetUp', "{0} is not set up. Set it up in Video Providers.", blocker.provider.label);
		case 'region':
			return localize('basehalf.video.catalog.blocker.region', "{0} is not offered in {1}. Choose another model, or another region in Video Providers.", blocker.model.label, blocker.region.label);
		case 'modeRegion':
			return localize('basehalf.video.catalog.blocker.modeRegion', "{0} offers {1} mode only in {2}. Choose another mode, or another region in Video Providers.", blocker.model.label, blocker.mode.label, blocker.where);
		case 'check':
			return blocker.message;
		case 'nothingToSend':
			return localize('basehalf.video.catalog.blocker.nothingToSend', "Write a prompt or connect an input to generate.");
	}
}

// --- What agents read of the catalog --------------------------------------------------------------

/**
 * The catalog as `basehalf --list-capabilities` gives it to agents (video
 * node specification, "Agents"): each provider with whether it is set up, its
 * regions and the one in use, and each model with the regions that offer it,
 * its prompt rule, its modes with their slots and limits, its parameters,
 * whether it has an estimate, and whether it is deprecated. It holds no
 * credential, endpoint, or id sent to a provider.
 */
export function baseHalfVideoCatalogForAgents(catalog: IBaseHalfVideoCatalog, setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup): readonly Readonly<Record<string, unknown>>[] {
	return Object.freeze(catalog.providers.map(provider => {
		const status = setup(provider);
		return Object.freeze({
			id: provider.id,
			label: provider.label,
			setUp: status.setUp,
			region: status.region.id,
			regions: provider.regions.map(region => ({ id: region.id, label: region.label, currency: region.currency })),
			models: provider.models.map(model => ({
				id: model.id,
				label: model.label,
				...(model.description ? { description: model.description } : {}),
				regions: provider.regions.filter(region => baseHalfVideoRegionOffersModel(model, region.id)).map(region => region.id),
				prompt: { required: model.prompt.required, maxLength: model.prompt.maxLength },
				modes: model.modes.map(mode => ({ id: mode.id, label: mode.label, inputs: mode.inputs, limits: mode.limits, ...(mode.regions ? { regions: mode.regions } : {}) })),
				parameters: model.parameters,
				estimate: model.estimate,
				...(model.deprecated ? { deprecated: true } : {})
			}))
		});
	}));
}

/** A generation an agent can copy: the first model that is not deprecated, of a provider set up on this computer when there is one, with its defaults. */
export function baseHalfVideoExampleGeneration(catalog: IBaseHalfVideoCatalog, setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup): IBaseHalfVideoGenerationChoice | undefined {
	const providers = [...catalog.providers.filter(provider => setup(provider).setUp), ...catalog.providers];
	for (const provider of providers) {
		const model = provider.models.find(candidate => !candidate.deprecated);
		if (model) {
			return baseHalfVideoChooseModel(undefined, { provider, model });
		}
	}
	return undefined;
}

// --- Reading what AI Video answers ----------------------------------------------------------------

/**
 * Reads the catalog that AI Video answered, keeping only what the window
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
	const estimate = parseEstimate(value.estimate);
	const providerModel = typeof value.providerModel === 'string' && /^\S{1,256}$/.test(value.providerModel) ? value.providerModel : undefined;
	return Object.freeze({
		problems: Object.freeze(value.problems.map(problem => plainText(problem, 1000)).filter(problem => problem.length > 0)),
		...(estimate ? { estimate } : {}),
		...(providerModel ? { providerModel } : {})
	});
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
	if (record.currency !== 'CNY' && record.currency !== 'USD') {
		throw new Error(`${path}.currency must be CNY or USD.`);
	}
	const console = record.console === undefined ? undefined : requireText(record.console, `${path}.console`);
	return Object.freeze({
		id,
		label: requireText(record.label, `${path}.label`),
		baseUrl,
		currency: record.currency,
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
		return Object.freeze({
			id,
			label: requireText(record.label, `${path}.label`),
			...(description !== undefined ? { description } : {}),
			providerModels: Object.freeze(offered),
			prompt: Object.freeze({ required: prompt.required, maxLength: prompt.maxLength as number }),
			modes: Object.freeze(modes),
			parameters: Object.freeze(parameters),
			estimate: record.estimate === true,
			...(record.deprecated === true ? { deprecated: true } : {})
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
		default:
			throw new Error(`${path}.kind must be choice, integer, number, boolean, or text.`);
	}
}

function parseEstimate(value: unknown): IBaseHalfVideoEstimate | undefined {
	if (!isRecord(value) || (value.currency !== 'CNY' && value.currency !== 'USD')
		|| typeof value.min !== 'number' || typeof value.max !== 'number' || !Number.isFinite(value.min) || !Number.isFinite(value.max)
		|| value.min < 0 || value.max < value.min || typeof value.priceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.priceDate)) {
		return undefined;
	}
	return Object.freeze({ currency: value.currency, min: value.min, max: value.max, priceDate: value.priceDate });
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

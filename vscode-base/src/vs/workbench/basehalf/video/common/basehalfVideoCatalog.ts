/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { language } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';

/**
 * The model catalog as the window receives it from the AI Video extension,
 * and the payloads of the provider commands (D59, video providers and the
 * model catalog). The window draws the panel, the settings, and the Video
 * Providers page from this catalog; nothing here names a provider or a
 * model. The extension mirrors these types in
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

/** How a mode uses the node's inputs (video providers, "Modes and inputs"). */
export type BaseHalfVideoModeId = 'frames' | 'reference' | 'extend' | 'edit';

export type BaseHalfVideoSlotUse = 'none' | 'optional' | 'required';

/** What a model makes (D64). */
export type BaseHalfModelKind = 'image' | 'video';

export interface IBaseHalfVideoCatalog {
	/** Changes when the shape of the catalog changes. */
	readonly schema: 1;
	readonly providers: readonly IBaseHalfVideoCatalogProvider[];
}

export interface IBaseHalfVideoCatalogRegion {
	readonly id: string;
	readonly label: string;
	readonly baseUrl: string;
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
	/** Listed only for cards that already use it. */
	readonly deprecated?: boolean;
	/** What the model makes. The extension writes it for every model. */
	readonly kind: BaseHalfModelKind;
	/** For an image model: the format its module asks the provider for, which a draft's extension follows. */
	readonly outputFormat?: BaseHalfVideoImageFormat;
	/** The provider answers the request with the files instead of a task (providers, "Requests"). */
	readonly answersAtOnce?: boolean;
	/** The regions that retire the model when not all of them do; it is deprecated only there. */
	readonly deprecatedIn?: readonly string[];
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
	cancel: 'basehalf.video.provider.cancel',
	place: 'basehalf.video.provider.place'
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

export interface IBaseHalfVideoCheckRequest {
	readonly provider: string;
	readonly region: string;
	readonly model: string;
	readonly mode: BaseHalfVideoModeId;
	/** Every parameter that applies, with its value or default; optional ones only when set. */
	readonly params: BaseHalfVideoParams;
	/** The prompt as it would be sent, text inputs included. */
	readonly prompt: string;
	/** The files a generation would send; the module measures them. */
	readonly inputs: IBaseHalfVideoPlannedMedia;
}

export interface IBaseHalfVideoCheckResult {
	/** Plain sentences, the first being what blocks the generation. Empty when it can run. */
	readonly problems: readonly string[];
	/** The id the request would be sent with, for a model whose modes and inputs choose among several. */
	readonly providerModel?: string;
}

export interface IBaseHalfVideoSubmitRequest extends IBaseHalfVideoProviderAccess {
	readonly model: string;
	readonly mode: BaseHalfVideoModeId;
	readonly params: BaseHalfVideoParams;
	readonly prompt: string;
	readonly inputs: IBaseHalfVideoPlannedMedia;
	/**
	 * One new file per output the request may make, each ending in `.part`,
	 * under `.bh/cache/generation/`. An output the provider answers inline is
	 * written there under the checks of a download.
	 */
	readonly targets?: readonly string[];
}

/** The format of a file a generation made. */
export type BaseHalfVideoOutputFormat = BaseHalfVideoImageFormat | 'mp4';

/** One file of a generation: an address to download, a target already written, or why the provider refused it alone. */
export type BaseHalfVideoOutput =
	| { readonly url: string }
	| { readonly written: string; readonly size: number; readonly format: BaseHalfVideoOutputFormat }
	| { readonly refused: string };

/** A task to poll, or the outputs of a provider that answers at once. */
export type IBaseHalfVideoSubmitResult =
	| { readonly remoteId: string }
	| { readonly outputs: readonly BaseHalfVideoOutput[] };

export interface IBaseHalfVideoTaskRef extends IBaseHalfVideoProviderAccess {
	readonly model: string;
	readonly remoteId: string;
	/** As in {@link IBaseHalfVideoSubmitRequest.targets}, for a poll whose answer holds the files themselves. */
	readonly targets?: readonly string[];
}

export type BaseHalfVideoPollState =
	| { readonly state: 'pending' | 'running'; readonly fraction?: number }
	| { readonly state: 'succeeded'; readonly videoUrl?: string; readonly outputs?: readonly BaseHalfVideoOutput[] }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

export interface IBaseHalfVideoDownloadRequest extends IBaseHalfVideoTaskRef {
	/** From the poll; without it, the provider module knows where the video is. */
	readonly videoUrl?: string;
	/** An output's address from the poll or the submit, for an image. */
	readonly url?: string;
	/** What is downloaded; `video` when absent. */
	readonly kind?: BaseHalfModelKind;
	/** A new file whose name ends in `.part`. */
	readonly targetFsPath: string;
}

export interface IBaseHalfVideoDownloadResult {
	readonly size: number;
	/** The format the bytes start like. */
	readonly format?: BaseHalfVideoOutputFormat;
}

export interface IBaseHalfVideoCancelResult {
	readonly cancelled: boolean;
}

/**
 * A file a generation received, to put into its card's place (generation
 * cards, "Landing"): `from` is a `.part` file directly in a
 * `.bh/cache/generation/` folder, and `to` a name of that workspace folder,
 * outside `.bh/`, that no file has. Both are absolute.
 */
export interface IBaseHalfVideoPlaceRequest {
	readonly from: string;
	readonly to: string;
}

export interface IBaseHalfVideoPlaceResult {
	readonly placed: true;
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
	| 'notImage'
	| 'tooLarge'
	| 'unknownProvider'
	/** Putting a file in place: a file already has the name. */
	| 'exists';

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

/** The width and the height that a ratio value such as `16:9` names, or undefined for another value, such as `adaptive`. */
export function baseHalfVideoRatioParts(value: unknown): { readonly width: number; readonly height: number } | undefined {
	const match = typeof value === 'string' ? /^(?<width>\d+(?:\.\d+)?):(?<height>\d+(?:\.\d+)?)$/.exec(value.trim()) : null;
	const width = Number(match?.groups?.width);
	const height = Number(match?.groups?.height);
	return match && width > 0 && height > 0 ? Object.freeze({ width, height }) : undefined;
}

/**
 * The ratio, width to height, that a generation with `choice` makes, as its
 * model's ratio setting chooses: the value of the setting drawn as ratios
 * that applies to its mode, or that setting's default. Undefined when the
 * model is not in the catalog, has no such setting, or follows an input with
 * it, such as Adaptive (canvas card placement, "The card of an image or a
 * video has its picture's shape").
 */
export function baseHalfVideoChoiceRatio(catalog: IBaseHalfVideoCatalog | undefined, choice: IBaseHalfVideoGenerationChoice): number | undefined {
	const model = findBaseHalfVideoModel(catalog, choice.provider, choice.model)?.model;
	const parameter = model && baseHalfVideoModeParameters(model, baseHalfVideoModeOf(model, choice.mode).id)
		.find((candidate): candidate is IBaseHalfVideoChoiceParameter => candidate.kind === 'choice' && candidate.display === 'ratio');
	const parts = parameter ? baseHalfVideoRatioParts(choice.params?.[parameter.name] ?? baseHalfVideoParameterDefault(parameter)) : undefined;
	return parts ? parts.width / parts.height : undefined;
}

/** The region with that id, or the provider's first when there is none. */
export function findBaseHalfVideoRegion(provider: IBaseHalfVideoCatalogProvider, regionId: string | undefined): IBaseHalfVideoCatalogRegion {
	return provider.regions.find(region => region.id === regionId) ?? provider.regions[0];
}

/** Whether the region offers the model: the model names the id sent to the provider there. */
export function baseHalfVideoRegionOffersModel(model: IBaseHalfVideoCatalogModel, regionId: string): boolean {
	return typeof model.providerModels[regionId] === 'string' && model.providerModels[regionId].length > 0;
}

/** The resolutions of the shared names, smallest first, to find a model's largest. */
/**
 * The `resolution` values of the catalog from the fewest pixels to the most,
 * so that the abilities line names a model's largest: a `p` value counts a
 * 16:9 frame of that height (1080p is 1920 × 1080, about 2.1 million pixels),
 * and a `k` value a square of that many thousand pixels a side (1k is
 * 1024 × 1024, about 1.0 million; 1.5k about 2.4 million). A value it does
 * not know counts as the smallest.
 */
const RESOLUTION_ORDER: readonly string[] = Object.freeze(['360p', '480p', '512p', '540p', '720p', '768p', '1k', '1080p', '1.5k', '2k', '3k', '4k']);

/**
 * A model's abilities in one line, from its declarations (generation cards,
 * "The panel"): for a video its modes, its longest duration, its largest
 * resolution, and Sound when it makes sound, such as `Frames · References ·
 * 15s · 1080p · Sound`; for an image its largest resolution and how many
 * images one generation can make, when more than one, such as `4K · Up to 4`.
 */
export function baseHalfVideoModelAbilities(model: IBaseHalfVideoCatalogModel): string {
	const image = model.kind === 'image';
	const parts = image ? [] : model.modes.map(mode => mode.label);
	const duration = model.parameters.find(parameter => parameter.name === 'duration' && (parameter.kind === 'integer' || parameter.kind === 'number'));
	if (!image && duration && (duration.kind === 'integer' || duration.kind === 'number')) {
		parts.push(localize('basehalf.video.catalog.abilitySeconds', "{0}s", duration.max));
	}
	const resolution = model.parameters.find(parameter => parameter.name === 'resolution' && parameter.kind === 'choice');
	if (resolution?.kind === 'choice' && resolution.options.length) {
		const largest = [...resolution.options].sort((a, b) => RESOLUTION_ORDER.indexOf(String(a.value)) - RESOLUTION_ORDER.indexOf(String(b.value))).at(-1)!;
		parts.push(largest.label);
	}
	if (!image && model.parameters.some(parameter => parameter.name === 'sound')) {
		parts.push(localize('basehalf.video.catalog.abilitySound', "Sound"));
	}
	const most = image ? baseHalfModelMostOutputs(model) : 1;
	if (most > 1) {
		parts.push(localize('basehalf.video.catalog.abilityCount', "Up to {0} images", most));
	}
	if (image) {
		// How many reference images the model takes is what tells image models apart when nothing else does.
		const references = Math.max(0, ...model.modes.map(mode => mode.inputs.images.max));
		if (references === 1) {
			parts.push(localize('basehalf.video.catalog.abilityReference', "1 reference"));
		} else if (references > 1) {
			parts.push(localize('basehalf.video.catalog.abilityReferences', "{0} references", references));
		}
	}
	return parts.join(' · ');
}

/** The most images one generation of a model makes: the highest `count` it declares, at most 16; 1 for a video model. */
export function baseHalfModelMostOutputs(model: IBaseHalfVideoCatalogModel): number {
	if (model.kind !== 'image') {
		return 1;
	}
	const count = model.parameters.find(parameter => parameter.name === 'count' && (parameter.kind === 'integer' || parameter.kind === 'number'));
	return count && (count.kind === 'integer' || count.kind === 'number') ? clampOutputs(Math.floor(count.max)) : 1;
}

/**
 * How many files a generation makes (providers, "Output"): a video model
 * one, an image model as many as its `count`, made legal for the model and
 * mode, from 1 to 16.
 */
export function baseHalfModelOutputCount(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | undefined, params: BaseHalfVideoParams | undefined): number {
	if (model.kind !== 'image') {
		return 1;
	}
	const count = normalizeBaseHalfVideoParams(model, modeId, params).count;
	return typeof count === 'number' ? clampOutputs(Math.floor(count)) : 1;
}

function clampOutputs(value: number): number {
	return Number.isFinite(value) ? Math.min(16, Math.max(1, value)) : 1;
}

/** The extension of the file a model makes: its image format's (`png`, `jpg`, `webp`), or `mp4`. */
export function baseHalfModelFileExtension(model: IBaseHalfVideoCatalogModel): string {
	if (model.kind !== 'image') {
		return 'mp4';
	}
	return model.outputFormat === 'jpeg' ? 'jpg' : model.outputFormat ?? 'png';
}

/** Whether the model is retired, everywhere or in the region given (providers, "Model"). */
export function isBaseHalfModelDeprecated(model: IBaseHalfVideoCatalogModel, regionId?: string): boolean {
	return model.deprecated === true || (regionId !== undefined && model.deprecatedIn?.includes(regionId) === true);
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

/**
 * The models a menu lists for a card: those of the card's kind, when one is
 * given, that are not deprecated, in the region in use when one is given, and
 * the card's own model in any case.
 */
export function baseHalfVideoListedModels(provider: IBaseHalfVideoCatalogProvider, chosen: IBaseHalfVideoGenerationChoice | undefined, kind?: BaseHalfModelKind, regionId?: string): readonly IBaseHalfVideoCatalogModel[] {
	return provider.models.filter(model => (kind === undefined || model.kind === kind)
		&& (!isBaseHalfModelDeprecated(model, regionId) || (chosen?.provider === provider.id && chosen.model === model.id)));
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
 * The generation a new card of a kind starts with (generation cards,
 * "Creating a generation card"): the last one of that kind on this computer,
 * made legal for its model. A model that is deprecated, in the region in use
 * when `region` tells it, of the other kind, or no longer in the catalog is
 * not chosen. Without the catalog, the last values are kept as they were
 * stored: they were legal when they were used.
 */
export function baseHalfVideoInitialGeneration(
	lastUsed: IBaseHalfVideoGenerationChoice | undefined,
	catalog: IBaseHalfVideoCatalog | undefined,
	kind?: BaseHalfModelKind,
	region?: (provider: IBaseHalfVideoCatalogProvider) => string
): IBaseHalfVideoGenerationChoice | undefined {
	if (!lastUsed?.model) {
		return undefined;
	}
	if (!catalog) {
		return lastUsed;
	}
	const ref = findBaseHalfVideoModel(catalog, lastUsed.provider, lastUsed.model);
	if (!ref || isBaseHalfModelDeprecated(ref.model, region?.(ref.provider)) || (kind !== undefined && ref.model.kind !== kind)) {
		return undefined;
	}
	return baseHalfVideoChooseModel(lastUsed, ref);
}

/**
 * The first value of an agent's generation that the model does not accept
 * (generation cards, "Starting", step 3): a name the model does not declare,
 * one the mode does not use, or a value off the parameter's options, range,
 * or steps. An agent's request stops with it instead of making it legal.
 */
export function baseHalfVideoRefusedParam(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | undefined, params: BaseHalfVideoParams | undefined): string | undefined {
	const mode = baseHalfVideoModeOf(model, modeId);
	if (modeId !== undefined && mode.id !== modeId) {
		return localize('basehalf.video.catalog.refused.mode', "{0} has no mode {1}.", model.label, modeId);
	}
	const applying = baseHalfVideoModeParameters(model, mode.id);
	for (const [name, value] of Object.entries(params ?? {})) {
		const parameter = applying.find(candidate => candidate.name === name);
		if (!parameter) {
			return model.parameters.some(candidate => candidate.name === name)
				? localize('basehalf.video.catalog.refused.notInMode', "{0} does not use {1} in {2} mode.", model.label, name, mode.label)
				: localize('basehalf.video.catalog.refused.unknown', "{0} has no setting {1}.", model.label, name);
		}
		if (!isBaseHalfVideoParamValueAccepted(parameter, value)) {
			return localize('basehalf.video.catalog.refused.value', "{0} does not accept {1} for {2}.", model.label, JSON.stringify(value), parameter.label);
		}
	}
	return undefined;
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

// --- Inputs ----------------------------------------------------------------------------------------

export type BaseHalfVideoInputKind = 'image' | 'video' | 'audio' | 'text' | 'other';

/** One upstream entry of a card, resolved. */
export interface IBaseHalfVideoInputSource {
	/** The upstream entry, workspace-relative. */
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	/** False when the entry names nothing, or a draft, which has no file yet. */
	readonly available: boolean;
	/** The entry names a draft: it is of the draft's kind and unavailable until the draft has its file. */
	readonly draft?: boolean;
}

/** What a generation does with an input: a frame, a reference, the clip of `extend` and `edit`, text for the prompt, or nothing. */
export type BaseHalfVideoInputUse = 'start-frame' | 'end-frame' | 'reference' | 'source' | 'text' | 'unused';

/**
 * Why an input is not used: `missing` names nothing; `draft` names a draft,
 * which has no file yet; `kind` cannot be used, such as a folder or a PDF;
 * `mode` the mode takes no input of its kind; `full` comes after what the
 * mode takes.
 */
export type BaseHalfVideoInputUnusedReason = 'missing' | 'draft' | 'kind' | 'mode' | 'full';

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

/** The input kind of a file, by its extension (generation cards, "Inputs"). */
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
 * What an image card assumes while no model is chosen: reference images, as
 * every image model takes, as many as are connected. It is no model's
 * declaration either.
 */
export const BASEHALF_IMAGE_DEFAULT_MODE_INPUTS: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'none',
	endFrame: 'none',
	images: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
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
			return unused(source.draft ? 'draft' : 'missing');
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
 * Why the card cannot generate now, checked in this order (generation cards,
 * "The panel"). The panel shows the first one next to a disabled Generate
 * button; the generation service refuses with the same.
 */
export type BaseHalfVideoGenerateBlocker =
	| { readonly kind: 'generating' }
	| { readonly kind: 'catalogLoading' }
	| { readonly kind: 'catalogFailed'; readonly message: string }
	| { readonly kind: 'noModel' }
	| { readonly kind: 'unknownModel'; readonly model: string }
	/** The model makes the other kind than the card's. */
	| { readonly kind: 'otherKind'; readonly model: IBaseHalfVideoCatalogModel }
	| { readonly kind: 'notSetUp'; readonly provider: IBaseHalfVideoCatalogProvider }
	| { readonly kind: 'region'; readonly model: IBaseHalfVideoCatalogModel; readonly region: IBaseHalfVideoCatalogRegion }
	/** The region offers the model, not its mode; `where` names the regions that do. */
	| { readonly kind: 'modeRegion'; readonly model: IBaseHalfVideoCatalogModel; readonly mode: IBaseHalfVideoCatalogMode; readonly where: string }
	/** An input names a draft, which has no file yet. */
	| { readonly kind: 'draftInput'; readonly path: string }
	/** The first problem the provider module reported for the planned generation. */
	| { readonly kind: 'check'; readonly message: string }
	| { readonly kind: 'nothingToSend' };

export interface IBaseHalfVideoGenerateBlockerInput {
	/** The card generates, in this window or in another one of this computer. */
	readonly generating: boolean;
	readonly catalog: BaseHalfVideoCatalogState;
	readonly generation: IBaseHalfVideoGenerationChoice | undefined;
	/** The card's kind; a model of the other kind blocks. */
	readonly kind?: BaseHalfModelKind;
	readonly setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup;
	/** What `check` reported for the planned generation, when it was asked. */
	readonly problems?: readonly string[];
	/** The card's prompt, as the panel holds it. */
	readonly prompt: string;
	/** The planned inputs; without them, the blockers that need the inputs are not checked. */
	readonly plan?: readonly IBaseHalfVideoInputPlanItem[];
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
	if (input.kind !== undefined && ref.model.kind !== input.kind) {
		return { kind: 'otherKind', model: ref.model };
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
	// Nothing written and nothing connected, as on a new card: the empty prompt says it, before what the model needs.
	if (input.plan?.length === 0 && !input.prompt.trim()) {
		return { kind: 'nothingToSend' };
	}
	const draft = input.plan?.find(item => item.reason === 'draft');
	if (draft) {
		return { kind: 'draftInput', path: draft.path };
	}
	const problem = input.problems?.find(message => message.trim().length > 0);
	if (problem) {
		return { kind: 'check', message: problem.trim() };
	}
	if (input.plan && !input.prompt.trim() && !input.plan.some(item => item.use !== 'unused')) {
		return { kind: 'nothingToSend' };
	}
	return undefined;
}

/** Whether a blocker is about the model or its provider: the model button is outlined for it. */
export function isBaseHalfVideoModelBlocker(blocker: BaseHalfVideoGenerateBlocker | undefined): boolean {
	return blocker?.kind === 'noModel' || blocker?.kind === 'unknownModel' || blocker?.kind === 'otherKind' || blocker?.kind === 'notSetUp' || blocker?.kind === 'region';
}

/** A blocker in words, as the Generate button, the model button, and a refused generation say it. */
export function baseHalfVideoGenerateBlockerText(blocker: BaseHalfVideoGenerateBlocker): string {
	switch (blocker.kind) {
		case 'generating':
			return localize('basehalf.video.catalog.blocker.generating', "This card is already generating.");
		case 'catalogLoading':
			return localize('basehalf.video.catalog.blocker.catalogLoading', "The models are still loading.");
		case 'catalogFailed':
			return localize('basehalf.video.catalog.blocker.catalogFailed', "BaseHalf could not load the models: {0}", blocker.message);
		case 'noModel':
			return localize('basehalf.video.catalog.blocker.noModel', "Choose a model to generate.");
		case 'unknownModel':
			return localize('basehalf.video.catalog.blocker.unknownModel', "{0} is not a model BaseHalf offers. Choose another model.", blocker.model);
		case 'otherKind':
			return blocker.model.kind === 'image'
				? localize('basehalf.video.catalog.blocker.imageModel', "{0} makes images. Choose a video model.", blocker.model.label)
				: localize('basehalf.video.catalog.blocker.videoModel', "{0} makes videos. Choose an image model.", blocker.model.label);
		case 'notSetUp':
			return localize('basehalf.video.catalog.blocker.notSetUp', "{0} is not set up. Set it up in Providers.", blocker.provider.label);
		case 'region':
			return localize('basehalf.video.catalog.blocker.region', "{0} is not offered in {1}. Choose another model, or another region in Providers.", blocker.model.label, blocker.region.label);
		case 'modeRegion':
			return localize('basehalf.video.catalog.blocker.modeRegion', "{0} offers {1} mode only in {2}. Choose another mode, or another region in Providers.", blocker.model.label, blocker.mode.label, blocker.where);
		case 'draftInput':
			return baseHalfVideoDraftInputText(blocker.path);
		case 'check':
			return blocker.message;
		case 'nothingToSend':
			return localize('basehalf.video.catalog.blocker.nothingToSend', "Write a prompt or connect an input to generate.");
	}
}

/** Why an input that names a draft keeps a card from generating. */
export function baseHalfVideoDraftInputText(path: string): string {
	return localize('basehalf.video.catalog.blocker.draftInput', "{0} has no file yet. Generate it first, or remove its connection.", path.slice(path.lastIndexOf('/') + 1) || path);
}

// --- What agents read of the catalog --------------------------------------------------------------

/**
 * The catalog as `basehalf --list-capabilities` gives it to agents
 * (generation cards, "Agents"): each provider with whether it is set up, its
 * regions and the one in use, and each model with its kind, the regions that
 * offer it and those that retire it, the format an image model delivers,
 * whether the provider answers with the files at once, its prompt rule, its
 * modes with their slots and limits, its parameters, and whether it is
 * deprecated. It holds no credential, endpoint, id sent to a provider, or
 * price.
 */
export function baseHalfVideoCatalogForAgents(catalog: IBaseHalfVideoCatalog, setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup): readonly Readonly<Record<string, unknown>>[] {
	return Object.freeze(catalog.providers.map(provider => {
		const status = setup(provider);
		return Object.freeze({
			id: provider.id,
			label: provider.label,
			setUp: status.setUp,
			region: status.region.id,
			regions: provider.regions.map(region => ({ id: region.id, label: region.label })),
			models: provider.models.map(model => ({
				id: model.id,
				kind: model.kind,
				label: model.label,
				...(model.description ? { description: model.description } : {}),
				regions: provider.regions.filter(region => baseHalfVideoRegionOffersModel(model, region.id)).map(region => region.id),
				...(model.deprecatedIn?.length ? { deprecatedIn: model.deprecatedIn } : {}),
				...(model.outputFormat ? { outputFormat: model.outputFormat } : {}),
				...(model.answersAtOnce ? { answersAtOnce: true } : {}),
				prompt: { required: model.prompt.required, maxLength: model.prompt.maxLength },
				modes: model.modes.map(mode => ({ id: mode.id, label: mode.label, inputs: mode.inputs, limits: mode.limits, ...(mode.regions ? { regions: mode.regions } : {}) })),
				parameters: model.parameters,
				...(model.deprecated ? { deprecated: true } : {})
			}))
		});
	}));
}

/** A generation an agent can copy: the first model of the kind that is not deprecated, of a provider set up on this computer when there is one, with its defaults. */
export function baseHalfVideoExampleGeneration(catalog: IBaseHalfVideoCatalog, setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup, kind: BaseHalfModelKind = 'video'): IBaseHalfVideoGenerationChoice | undefined {
	const providers = [...catalog.providers.filter(provider => setup(provider).setUp), ...catalog.providers];
	for (const provider of providers) {
		const model = provider.models.find(candidate => candidate.kind === kind && !isBaseHalfModelDeprecated(candidate, setup(provider).region.id));
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
	const providerModel = typeof value.providerModel === 'string' && /^\S{1,256}$/.test(value.providerModel) ? value.providerModel : undefined;
	return Object.freeze({
		problems: Object.freeze(value.problems.map(problem => plainText(problem, 1000)).filter(problem => problem.length > 0)),
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
		const kind: BaseHalfModelKind = record.kind === undefined ? 'video' : record.kind === 'image' || record.kind === 'video' ? record.kind : (() => { throw new Error(`${path}.kind must be image or video.`); })();
		const outputFormat = record.outputFormat === undefined ? undefined : BASEHALF_VIDEO_IMAGE_FORMATS.includes(record.outputFormat as BaseHalfVideoImageFormat) ? record.outputFormat as BaseHalfVideoImageFormat : undefined;
		if (kind === 'image' && outputFormat === undefined) {
			throw new Error(`${path}.outputFormat must be png, jpeg, or webp for an image model.`);
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
			...(kind === 'image' ? { outputFormat } : {}),
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
		default:
			throw new Error(`${path}.kind must be choice, integer, number, boolean, or text.`);
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

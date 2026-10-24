/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { safeIntl } from '../../../../base/common/date.js';
import { language } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import type {
	AudioFormat as BaseHalfAudioFormat,
	AudioMakes as BaseHalfAudioMakes,
	AudioOutputFormat as BaseHalfAudioOutputFormat,
	ModelKind as BaseHalfModelKind,
	CatalogParameter as BaseHalfVideoCatalogParameter,
	ImageFormat as BaseHalfVideoImageFormat,
	Media as BaseHalfVideoMedia,
	ModeId as BaseHalfVideoModeId,
	Output as BaseHalfVideoOutput,
	OutputFormat as BaseHalfVideoOutputFormat,
	Params as BaseHalfVideoParams,
	ParamValue as BaseHalfVideoParamValue,
	PollState as BaseHalfVideoPollState,
	PromptInputSlot as BaseHalfVideoPromptInputSlot,
	PromptPart as BaseHalfVideoPromptPart,
	ProviderErrorCode as BaseHalfVideoProviderErrorCode,
	ProviderResponse as BaseHalfVideoProviderResponse,
	SlotUse as BaseHalfVideoSlotUse,
	BooleanParameter as IBaseHalfVideoBooleanParameter,
	CancelResult as IBaseHalfVideoCancelResult,
	Catalog as IBaseHalfVideoCatalog,
	CatalogCredential as IBaseHalfVideoCatalogCredential,
	CatalogMode as IBaseHalfVideoCatalogMode,
	CatalogModel as IBaseHalfVideoCatalogModel,
	CatalogProvider as IBaseHalfVideoCatalogProvider,
	CatalogRegion as IBaseHalfVideoCatalogRegion,
	CheckLimit as IBaseHalfVideoCheckLimit,
	CheckPayload as IBaseHalfVideoCheckRequest,
	CheckResult as IBaseHalfVideoCheckResult,
	ChoiceParameter as IBaseHalfVideoChoiceParameter,
	CountSlot as IBaseHalfVideoCountSlot,
	DownloadRequest as IBaseHalfVideoDownloadRequest,
	DownloadResult as IBaseHalfVideoDownloadResult,
	ModeInputs as IBaseHalfVideoModeInputs,
	ModeLimits as IBaseHalfVideoModeLimits,
	NumberParameter as IBaseHalfVideoNumberParameter,
	PlaceRequest as IBaseHalfVideoPlaceRequest,
	PlaceResult as IBaseHalfVideoPlaceResult,
	PlannedMedia as IBaseHalfVideoPlannedMedia,
	PromptInput as IBaseHalfVideoPromptInput,
	PromptRule as IBaseHalfVideoPromptRule,
	ProviderAccess as IBaseHalfVideoProviderAccess,
	ProviderError as IBaseHalfVideoProviderError,
	SubmitPayload as IBaseHalfVideoSubmitRequest,
	SubmitResult as IBaseHalfVideoSubmitResult,
	TaskRef as IBaseHalfVideoTaskRef,
	TextParameter as IBaseHalfVideoTextParameter,
	CatalogVoiceOption as IBaseHalfVideoCatalogVoiceOption,
	ListedVoice as IBaseHalfVideoListedVoice,
	VoiceParameter as IBaseHalfVideoVoiceParameter,
	VoicePreviewRequest as IBaseHalfVideoVoicePreviewRequest,
	VoicePreviewResult as IBaseHalfVideoVoicePreviewResult,
	VoicesRequest as IBaseHalfVideoVoicesRequest,
	VoicesResult as IBaseHalfVideoVoicesResult
} from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { isVoiceId, MAX_VOICE_ID_LENGTH } from '../../../../platform/basehalfProviders/common/basehalfProviderVoices.js';

/**
 * The model catalog as the window receives it from the provider service,
 * and the requests and answers of that service (D59, D75, providers and the
 * model catalog). The window draws the panel, the settings, and the Video
 * Providers page from this catalog; nothing here names a provider or a
 * model. The types have one definition, in
 * `src/vs/platform/basehalfProviders/common/basehalfProviderTypes.ts`, which
 * the service shares; these are its names in the window.
 *
 * Below them, the window's pure functions over the catalog: reading it,
 * normalizing a node's values, planning its inputs from a mode's slots,
 * summing up the settings, and the Generate blockers (video node
 * specification, "Settings", "Inputs", and "The panel").
 */
export type {
	BaseHalfAudioFormat,
	BaseHalfAudioMakes,
	BaseHalfAudioOutputFormat,
	BaseHalfModelKind,
	BaseHalfVideoCatalogParameter,
	BaseHalfVideoImageFormat,
	BaseHalfVideoMedia,
	BaseHalfVideoModeId,
	BaseHalfVideoOutput,
	BaseHalfVideoOutputFormat,
	BaseHalfVideoParams,
	BaseHalfVideoParamValue,
	BaseHalfVideoPollState,
	BaseHalfVideoPromptInputSlot,
	BaseHalfVideoPromptPart,
	BaseHalfVideoProviderErrorCode,
	BaseHalfVideoProviderResponse,
	BaseHalfVideoSlotUse,
	IBaseHalfVideoBooleanParameter,
	IBaseHalfVideoCancelResult,
	IBaseHalfVideoCatalog,
	IBaseHalfVideoCatalogCredential,
	IBaseHalfVideoCatalogMode,
	IBaseHalfVideoCatalogModel,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoCatalogRegion,
	IBaseHalfVideoCheckLimit,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoCheckResult,
	IBaseHalfVideoChoiceParameter,
	IBaseHalfVideoCountSlot,
	IBaseHalfVideoDownloadRequest,
	IBaseHalfVideoDownloadResult,
	IBaseHalfVideoModeInputs,
	IBaseHalfVideoModeLimits,
	IBaseHalfVideoNumberParameter,
	IBaseHalfVideoPlaceRequest,
	IBaseHalfVideoPlaceResult,
	IBaseHalfVideoPlannedMedia,
	IBaseHalfVideoPromptInput,
	IBaseHalfVideoPromptRule,
	IBaseHalfVideoProviderAccess,
	IBaseHalfVideoProviderError,
	IBaseHalfVideoSubmitRequest,
	IBaseHalfVideoSubmitResult,
	IBaseHalfVideoTaskRef,
	IBaseHalfVideoTextParameter,
	IBaseHalfVideoCatalogVoiceOption,
	IBaseHalfVideoListedVoice,
	IBaseHalfVideoVoiceParameter,
	IBaseHalfVideoVoicePreviewRequest,
	IBaseHalfVideoVoicePreviewResult,
	IBaseHalfVideoVoicesRequest,
	IBaseHalfVideoVoicesResult
};

/**
 * The values with each number beyond a limit fitted to its end, on the
 * parameter's steps and inside its declared range, as the provider service fits them
 * before it checks and sends them (D70). Auto and a value that is not a number
 * are kept; a value left to its default is fitted when the default is beyond
 * the limit.
 */
export function fitBaseHalfVideoParams(model: IBaseHalfVideoCatalogModel, params: BaseHalfVideoParams, limits: IBaseHalfVideoCheckResult['limits']): BaseHalfVideoParams {
	if (!limits) {
		return params;
	}
	let fitted: Record<string, BaseHalfVideoParamValue> | undefined;
	for (const [name, limit] of Object.entries(limits)) {
		const parameter = model.parameters.find(candidate => candidate.name === name);
		if (!parameter || (parameter.kind !== 'integer' && parameter.kind !== 'number')) {
			continue;
		}
		const value = Object.hasOwn(params, name) ? params[name] : parameter.default;
		if (typeof value !== 'number' || (parameter.auto && value === parameter.auto.value)) {
			continue;
		}
		const range = baseHalfVideoLimitRange(parameter, limit);
		const next = value > range.max ? range.max : value < range.min ? range.min : value;
		if (next !== value) {
			fitted ??= { ...params };
			fitted[name] = next;
		}
	}
	return fitted ? Object.freeze(fitted) : params;
}

/** The range a limit leaves of a number parameter, on its steps and inside its declared range. */
export function baseHalfVideoLimitRange(parameter: IBaseHalfVideoNumberParameter, limit: IBaseHalfVideoCheckLimit | undefined): { readonly min: number; readonly max: number } {
	const step = parameter.step > 0 ? parameter.step : 1;
	// An end on the steps, without the error of adding them (0.1 × 3 is not 0.3).
	const onSteps = (end: number, round: (value: number) => number) => {
		const steps = round(Number(((end - parameter.min) / step).toFixed(9)));
		return Math.min(parameter.max, Math.max(parameter.min, Number((parameter.min + steps * step).toFixed(9))));
	};
	return {
		min: limit?.min === undefined ? parameter.min : onSteps(limit.min, Math.ceil),
		max: limit?.max === undefined ? parameter.max : onSteps(limit.max, Math.floor)
	};
}

// ================================================================================================
// The window's functions over the catalog. Not mirrored by the extension.
// ================================================================================================

export const BASEHALF_VIDEO_MODE_IDS: readonly BaseHalfVideoModeId[] = Object.freeze(['frames', 'reference', 'extend', 'edit', 'lyrics']);

/** What a model makes, in the order the canvas offers the cards of each kind (D64, D78). */
export const BASEHALF_MODEL_KINDS: readonly BaseHalfModelKind[] = Object.freeze(['image', 'video', 'audio']);

/** What an audio model makes (D78): speech, music, or sound effects. */
export const BASEHALF_AUDIO_MAKES: readonly BaseHalfAudioMakes[] = Object.freeze(['speech', 'music', 'sound']);

/** The formats an audio model declares that it delivers (providers, "Audio format"). */
export const BASEHALF_AUDIO_FORMATS: readonly BaseHalfAudioFormat[] = Object.freeze(['mp3', 'wav']);

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
 * "The panel"): for a video its modes, its range of durations, its largest
 * resolution, and Sound when it makes sound, such as `Frames · References ·
 * 4–15s · 1080p · Sound`; for an image its largest resolution, how many
 * images one generation can make, when more than one, and how many
 * references it takes, such as `4K · Up to 4 images · 14 references`; for an
 * audio model what it makes first ({@link audioModelAbilities}). The model
 * menu shows it as each model's second line.
 */
export function baseHalfVideoModelAbilities(model: IBaseHalfVideoCatalogModel): string {
	if (model.kind === 'audio') {
		return audioModelAbilities(model);
	}
	const image = model.kind === 'image';
	const parts = image ? [] : model.modes.map(mode => mode.label);
	// The range of durations, as the two canvas products for media work list their models (D70).
	const durations = image ? undefined : durationRange(model.parameters.find(parameter => parameter.name === 'duration'));
	if (durations) {
		parts.push(durations.min === durations.max
			? secondsAbility(durations.max)
			: localize('basehalf.video.catalog.abilitySecondsRange', "{0}–{1}s", durations.min, durations.max));
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

/**
 * An audio model's abilities in one line (generation cards, "The panel"):
 * what it makes, Speech, Music, or Sound Effects; then for speech the most
 * characters its prompt takes, and otherwise its modes when it has more than
 * one, its longest duration (`Up to 22s`, or `30s` when it makes that length
 * alone), how many songs one generation can make when that is more than one,
 * and how many reference images and sounds it takes, such as `Speech · Up to
 * 10,000 characters` and `Music · From a Description · From Lyrics · Up to 3
 * songs · 1 reference sound`.
 */
function audioModelAbilities(model: IBaseHalfVideoCatalogModel): string {
	const parts = [baseHalfAudioMakesLabel(model.makes)];
	if (model.makes === 'speech') {
		parts.push(localize('basehalf.video.catalog.abilityCharacters', "Up to {0} characters", safeIntl.NumberFormat(language).value.format(model.prompt.maxLength)));
		return parts.join(' · ');
	}
	if (model.modes.length > 1) {
		parts.push(...model.modes.map(mode => mode.label));
	}
	const durations = durationRange(model.parameters.find(parameter => parameter.name === 'duration'));
	if (durations) {
		parts.push(durations.min === durations.max
			? secondsAbility(durations.max)
			: localize('basehalf.video.catalog.abilityLongest', "Up to {0}s", durations.max));
	}
	const most = baseHalfModelMostOutputs(model);
	if (most > 1) {
		parts.push(localize('basehalf.video.catalog.abilitySongs', "Up to {0} songs", most));
	}
	const images = Math.max(0, ...model.modes.map(mode => mode.inputs.images.max));
	if (images === 1) {
		parts.push(localize('basehalf.video.catalog.abilityReferenceImage', "1 reference image"));
	} else if (images > 1) {
		parts.push(localize('basehalf.video.catalog.abilityReferenceImages', "{0} reference images", images));
	}
	const sounds = Math.max(0, ...model.modes.map(mode => mode.inputs.audios.max));
	if (sounds === 1) {
		parts.push(localize('basehalf.video.catalog.abilityReferenceSound', "1 reference sound"));
	} else if (sounds > 1) {
		parts.push(localize('basehalf.video.catalog.abilityReferenceSounds', "{0} reference sounds", sounds));
	}
	return parts.join(' · ');
}

/** What an audio model makes, in words: Speech, Music, or Sound Effects. */
export function baseHalfAudioMakesLabel(makes: BaseHalfAudioMakes | undefined): string {
	switch (makes) {
		case 'speech': return localize('basehalf.video.catalog.makesSpeech', "Speech");
		case 'music': return localize('basehalf.video.catalog.makesMusic', "Music");
		default: return localize('basehalf.video.catalog.makesSound', "Sound Effects");
	}
}

/**
 * Whether the prompt of a generation is spoken or sung (generation cards,
 * "Terms"): the prompt of a speech model, which the voice says, and the
 * prompt in Lyrics mode, which the song sings. A note then joins it as its
 * text alone, without its name (generation cards, "Inputs"). `modeId` is the
 * mode that is used.
 */
export function isBaseHalfSpokenOrSungPrompt(model: IBaseHalfVideoCatalogModel | undefined, modeId: BaseHalfVideoModeId | string | undefined): boolean {
	return model?.kind === 'audio' && (model.makes === 'speech' || modeId === 'lyrics');
}

/** The one length a model makes, as its abilities say it: `30s`. */
function secondsAbility(seconds: number): string {
	return localize('basehalf.video.catalog.abilitySeconds', "{0}s", seconds);
}

/** The shortest and the longest duration a parameter declares: a number's range, or a choice's numbers. */
function durationRange(parameter: BaseHalfVideoCatalogParameter | undefined): { readonly min: number; readonly max: number } | undefined {
	if (parameter?.kind === 'integer' || parameter?.kind === 'number') {
		return { min: parameter.min, max: parameter.max };
	}
	if (parameter?.kind === 'choice') {
		const numbers = parameter.options.map(option => Number(option.value)).filter(value => Number.isFinite(value) && value > 0);
		return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : undefined;
	}
	return undefined;
}

/**
 * Whether a generation of a model may make several files (providers,
 * "Output"): an image model and a music model make as many as their `count`;
 * a video, speech, or sound-effect model makes one.
 */
export function baseHalfModelMakesSeveral(model: IBaseHalfVideoCatalogModel): boolean {
	return model.kind === 'image' || (model.kind === 'audio' && model.makes === 'music');
}

/** The most images or songs one generation of a model makes: the highest `count` it declares, at most 16; 1 for a model that makes one file. */
export function baseHalfModelMostOutputs(model: IBaseHalfVideoCatalogModel): number {
	if (!baseHalfModelMakesSeveral(model)) {
		return 1;
	}
	const count = model.parameters.find(parameter => parameter.name === 'count' && (parameter.kind === 'integer' || parameter.kind === 'number'));
	return count && (count.kind === 'integer' || count.kind === 'number') ? clampOutputs(Math.floor(count.max)) : 1;
}

/**
 * How many files a generation makes (providers, "Output"): a video, speech,
 * or sound-effect model one, an image or a music model as many as its
 * `count`, made legal for the model and mode, from 1 to 16.
 */
export function baseHalfModelOutputCount(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | undefined, params: BaseHalfVideoParams | undefined): number {
	if (!baseHalfModelMakesSeveral(model)) {
		return 1;
	}
	const count = normalizeBaseHalfVideoParams(model, modeId, params).count;
	return typeof count === 'number' ? clampOutputs(Math.floor(count)) : 1;
}

function clampOutputs(value: number): number {
	return Number.isFinite(value) ? Math.min(16, Math.max(1, value)) : 1;
}

/**
 * The extension of the file a model makes, from the format it declares: an
 * image's `png`, `jpg`, or `webp`, a sound's `mp3` or `wav`, and a video's
 * `mp4`.
 */
export function baseHalfModelFileExtension(model: IBaseHalfVideoCatalogModel): string {
	switch (model.kind) {
		case 'image':
			return model.outputFormat === 'jpeg' ? 'jpg' : model.outputFormat === 'webp' ? 'webp' : 'png';
		case 'audio':
			return model.outputFormat === 'wav' ? 'wav' : 'mp3';
		default:
			return 'mp4';
	}
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

/**
 * Whether a parameter takes a value: a choice of its options, a number in its
 * range and on its steps (or its Auto), a boolean, text within its length, or
 * a voice of its options, and for a voice the provider lists, any other id of
 * a voice, which may be one of the account's: the provider service's rule
 * (`isVoiceId`; providers, "Parameters"), which `check` applies too.
 */
export function isBaseHalfVideoParamValueAccepted(parameter: BaseHalfVideoCatalogParameter, value: unknown): value is BaseHalfVideoParamValue {
	switch (parameter.kind) {
		case 'voice':
			return typeof value === 'string' && (parameter.options.some(option => option.value === value) || (parameter.listed === true && isVoiceId(value)));
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
 * number, off, empty text, or its first voice. For an optional parameter, its
 * declared default, which is never filled in: an optional parameter the node
 * leaves unset sends nothing.
 */
export function baseHalfVideoParameterDefault(parameter: BaseHalfVideoCatalogParameter): BaseHalfVideoParamValue | undefined {
	const declared: unknown = parameter.default;
	if (declared !== undefined && isBaseHalfVideoParamValueAccepted(parameter, declared)) {
		return declared;
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
		case 'voice': return parameter.options[0]?.value;
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

/**
 * The generation after the user chose a model: every value the new model and
 * mode accept is kept, the others take their defaults. A voice's id belongs
 * to its provider (providers, "Parameters"): a model of another provider
 * keeps the voice only when it is among its own voices, and otherwise speaks
 * in its default, even where its provider lists voices and would take any
 * id; a model of the same provider keeps it.
 */
export function baseHalfVideoChooseModel(generation: IBaseHalfVideoGenerationChoice | undefined, ref: IBaseHalfVideoModelRef): IBaseHalfVideoGenerationChoice {
	const mode = baseHalfVideoModeOf(ref.model, generation?.mode);
	const params = generation?.provider === ref.provider.id ? generation.params : withoutOtherProvidersVoices(ref.model, generation?.params);
	return Object.freeze({
		provider: ref.provider.id,
		model: ref.model.id,
		mode: mode.id,
		params: normalizeBaseHalfVideoParams(ref.model, mode.id, params)
	});
}

/** The values without a voice that is none of the model's own voices: it may be the id of another provider's. */
function withoutOtherProvidersVoices(model: IBaseHalfVideoCatalogModel, params: BaseHalfVideoParams | undefined): BaseHalfVideoParams | undefined {
	const voices = model.parameters.filter((parameter): parameter is IBaseHalfVideoVoiceParameter => parameter.kind === 'voice');
	if (!params || !voices.some(parameter => Object.prototype.hasOwnProperty.call(params, parameter.name))) {
		return params;
	}
	const kept: Record<string, BaseHalfVideoParamValue> = { ...params };
	for (const parameter of voices) {
		if (!parameter.options.some(option => option.value === kept[parameter.name])) {
			delete kept[parameter.name];
		}
	}
	return kept;
}

/** The generation after the user chose a mode of its model. */
export function baseHalfVideoChooseMode(generation: IBaseHalfVideoGenerationChoice, model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId): IBaseHalfVideoGenerationChoice {
	const mode = baseHalfVideoModeOf(model, modeId);
	return Object.freeze({ ...generation, mode: mode.id, params: normalizeBaseHalfVideoParams(model, mode.id, generation.params) });
}

/** The generation after one value changed; `undefined` leaves an optional parameter unset. */
export function baseHalfVideoChangeParam(generation: IBaseHalfVideoGenerationChoice, model: IBaseHalfVideoCatalogModel, name: string, value: BaseHalfVideoParamValue | undefined, usedModeId?: BaseHalfVideoModeId): IBaseHalfVideoGenerationChoice {
	// The value is made legal for the mode that is used, which the settings show; the card keeps its own mode.
	const mode = baseHalfVideoModeOf(model, usedModeId ?? generation.mode);
	const current = { ...normalizeBaseHalfVideoParams(model, mode.id, generation.params) };
	if (value === undefined) {
		delete current[name];
	} else {
		current[name] = value;
	}
	const own = model.modes.some(candidate => candidate.id === generation.mode) ? generation.mode! : mode.id;
	return Object.freeze({ ...generation, mode: own, params: normalizeBaseHalfVideoParams(model, mode.id, current) });
}

/**
 * The generation a new card of a kind starts with (generation cards,
 * "Creating a generation card"): the last one of that kind on this computer,
 * made legal for its model. A model that is deprecated, in the region in use
 * when `region` tells it, of another kind, or no longer in the catalog is
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
 * number, a boolean as on or off, text with its whitespace collapsed, and a
 * voice by the name the catalog gives it, or its id. The panels name a voice
 * from the provider's last list too (`baseHalfVoiceLabel`).
 */
export function baseHalfVideoParamValueLabel(parameter: BaseHalfVideoCatalogParameter, value: BaseHalfVideoParamValue): string {
	switch (parameter.kind) {
		case 'choice':
		case 'voice':
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
 * The summary of the settings (generation cards, "Settings"): the mode, then
 * each parameter that is not advanced and has a value, such as `Frames ·
 * 720p · 5s · Sound`. The voice of a speech model is not among the settings:
 * its own button shows it, and the summary leaves it out (D78).
 */
export function baseHalfVideoSettingsSummary(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | undefined, params: BaseHalfVideoParams | undefined, startFrame = false): readonly string[] {
	const mode = baseHalfVideoModeOf(model, modeId);
	const values = normalizeBaseHalfVideoParams(model, mode.id, params);
	const parts = [mode.label];
	for (const parameter of baseHalfVideoModeParameters(model, mode.id)) {
		const value = values[parameter.name];
		if (parameter.advanced || parameter.kind === 'voice' || value === undefined || (startFrame && parameter.setByStartFrame)) {
			continue;
		}
		const part = summaryPart(parameter, value);
		if (part) {
			parts.push(part);
		}
	}
	return Object.freeze(parts);
}

/**
 * The settings a generation was made with, from its record (generation cards,
 * "The panel of a card with its file"): the mode, then the values as they
 * were sent, never made legal again, in the model's order with the catalog's
 * names, then the values the catalog does not know by their recorded names.
 * The advanced ones only with `advanced`. The voice of a speech model is left
 * out: the panel names it beside the model (D78).
 */
export function baseHalfVideoRecordedSettingsSummary(model: IBaseHalfVideoCatalogModel, modeId: string, params: BaseHalfVideoParams, advanced = false): readonly string[] {
	const parts = [model.modes.find(mode => mode.id === modeId)?.label ?? modeId];
	for (const parameter of model.parameters) {
		const value = params[parameter.name];
		if (value === undefined || parameter.kind === 'voice' || (parameter.advanced && !advanced)) {
			continue;
		}
		const part = summaryPart(parameter, value);
		if (part) {
			parts.push(part);
		}
	}
	for (const [name, value] of Object.entries(params)) {
		if (!model.parameters.some(parameter => parameter.name === name)) {
			parts.push(`${name} ${String(value)}`);
		}
	}
	return Object.freeze(parts);
}

function summaryPart(parameter: BaseHalfVideoCatalogParameter, value: BaseHalfVideoParamValue): string {
	switch (parameter.kind) {
		case 'choice':
		case 'voice':
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
}

/**
 * The extensions of the files an input of each kind may be, lower case,
 * without the dot (generation cards, "Inputs"). A sound's are those the
 * window shows as sounds (`BASEHALF_MEDIA_FILE_EXTENSIONS`), and AAC, which
 * a provider may take.
 */
export const BASEHALF_VIDEO_INPUT_EXTENSIONS: Readonly<Record<Exclude<BaseHalfVideoInputKind, 'other'>, readonly string[]>> = Object.freeze({
	image: Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp']),
	video: Object.freeze(['mp4', 'mov', 'm4v', 'webm']),
	audio: Object.freeze(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac']),
	text: Object.freeze(['md', 'markdown', 'txt'])
});

const INPUT_KIND_BY_EXTENSION: ReadonlyMap<string, BaseHalfVideoInputKind> = new Map(
	Object.entries(BASEHALF_VIDEO_INPUT_EXTENSIONS).flatMap(([kind, extensions]) => extensions.map(extension => [extension, kind as BaseHalfVideoInputKind] as const))
);

/** The input kind of a file, by its extension (generation cards, "Inputs"). */
export function baseHalfVideoInputKindOfPath(path: string): BaseHalfVideoInputKind {
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	const dot = name.lastIndexOf('.');
	return INPUT_KIND_BY_EXTENSION.get(dot > 0 ? name.slice(dot + 1) : '') ?? 'other';
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
 * What an audio card assumes while no model is chosen: references mode, with
 * images and sounds as references, as many as are connected, as an audio
 * model's references are (generation cards, "Inputs"). It is no model's
 * declaration either.
 */
export const BASEHALF_AUDIO_DEFAULT_MODE_INPUTS: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'none',
	endFrame: 'none',
	images: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	source: 'none'
});

/**
 * The slots a card of a kind shows its inputs in while it has no model, or
 * its model is not in the catalog (generation cards, "The panel"): an image
 * card and an audio card as references mode does, and a video card as
 * frames mode does.
 */
export function baseHalfDefaultModeInputs(kind: BaseHalfModelKind): IBaseHalfVideoModeInputs {
	return kind === 'image' ? BASEHALF_IMAGE_DEFAULT_MODE_INPUTS : kind === 'audio' ? BASEHALF_AUDIO_DEFAULT_MODE_INPUTS : BASEHALF_VIDEO_DEFAULT_MODE_INPUTS;
}

/** The mode a card of a kind shows while it has no model: References for an image or a sound, Frames for a video. */
export function baseHalfDefaultModeId(kind: BaseHalfModelKind): BaseHalfVideoModeId {
	return kind === 'video' ? 'frames' : 'reference';
}

/**
 * How a generation uses each input, in upstream order, from the slots the
 * mode declares (generation cards, "Inputs"). An image fills the start frame,
 * then the end frame, then the reference images, as far as the mode has
 * them; a video fills the clip, then the reference videos; audio fills the
 * reference audio. Text inputs join the prompt in every mode.
 */
export function planBaseHalfVideoInputs(
	inputs: IBaseHalfVideoModeInputs,
	sources: readonly IBaseHalfVideoInputSource[]
): readonly IBaseHalfVideoInputPlanItem[] {
	const taken = { startFrame: false, endFrame: false, source: false, image: 0, video: 0, audio: 0 };
	const hasStart = inputs.startFrame !== 'none';
	const hasEnd = inputs.endFrame !== 'none';
	const hasSource = inputs.source !== 'none';
	return Object.freeze(sources.map((source): IBaseHalfVideoInputPlanItem => {
		const item = { path: source.path, kind: source.kind };
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

/**
 * Whether a mode uses every input (generation cards, "What is connected is
 * sent"): none is left over because of its kind or because the mode takes no
 * more of its kind. An input that names nothing, or a draft, counts as of its
 * kind here: it is missing, which says why on its own, not unusable.
 */
export function baseHalfVideoModeUsesEveryInput(inputs: IBaseHalfVideoModeInputs, sources: readonly IBaseHalfVideoInputSource[]): boolean {
	return planBaseHalfVideoInputs(inputs, sources.map(asAvailable)).every(item => item.use !== 'unused');
}

/**
 * The mode a draft's generation uses (generation cards, "What is connected is
 * sent"): the card's own mode when that mode uses every input, and otherwise
 * the first of the model's modes, in the catalog's order, that does. When
 * none does, the card's own mode, whose inputs then keep Generate from
 * running. The model is never changed for the inputs.
 */
export function baseHalfVideoModeThatIsUsed(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | string | undefined, sources: readonly IBaseHalfVideoInputSource[]): IBaseHalfVideoCatalogMode {
	const own = baseHalfVideoModeOf(model, modeId);
	if (baseHalfVideoModeUsesEveryInput(own.inputs, sources)) {
		return own;
	}
	return model.modes.find(mode => baseHalfVideoModeUsesEveryInput(mode.inputs, sources)) ?? own;
}

/** An input that no mode of a model can use together with the inputs before it. */
export interface IBaseHalfVideoInputProblem {
	/** Its place among the inputs. */
	readonly index: number;
	readonly path: string;
	/** Why, as a refused connection says it: "Seedance 2.5 takes no videos." */
	readonly reason: string;
}

/**
 * The first input that no mode of the model can use together with the inputs
 * before it, and why (generation cards, "What is connected is sent"), or
 * `undefined` when one of the model's modes uses every input. A connection
 * whose source would be such an input is refused with the reason, and a draft
 * whose inputs hold one does not generate.
 */
export function baseHalfVideoInputProblem(model: IBaseHalfVideoCatalogModel, sources: readonly IBaseHalfVideoInputSource[]): IBaseHalfVideoInputProblem | undefined {
	const fits = (count: number) => model.modes.some(mode => baseHalfVideoModeUsesEveryInput(mode.inputs, sources.slice(0, count)));
	if (fits(sources.length)) {
		return undefined;
	}
	for (let index = 0; index < sources.length; index++) {
		if (!fits(index + 1)) {
			const source = sources[index];
			return Object.freeze({ index, path: source.path, reason: inputProblemReason(model, sources.slice(0, index + 1), source) });
		}
	}
	return undefined;
}

function asAvailable(source: IBaseHalfVideoInputSource): IBaseHalfVideoInputSource {
	return source.available ? source : { path: source.path, kind: source.kind, available: true };
}

/** How many inputs of a kind a mode takes, frames and the clip included. */
function modeTakes(inputs: IBaseHalfVideoModeInputs, kind: 'image' | 'video' | 'audio'): number {
	switch (kind) {
		case 'image': return (inputs.startFrame !== 'none' ? 1 : 0) + (inputs.endFrame !== 'none' ? 1 : 0) + inputs.images.max;
		case 'video': return (inputs.source !== 'none' ? 1 : 0) + inputs.videos.max;
		case 'audio': return inputs.audios.max;
	}
}

/** Why no generation card can take the file at `path` as an input: it is neither an image, a video, a sound, nor text. */
export function baseHalfVideoUnusableKindReason(path: string): string {
	return localize('basehalf.video.catalog.input.kind', "An image, video, or audio card cannot use {0}.", path.slice(path.lastIndexOf('/') + 1) || path);
}

/**
 * Why a draft with `model` and the list `upstream` does not take `added`, as
 * one more input or in place of `removed` (D67). Only what the change brings
 * in is refused: an input that a later model cannot use already says so in
 * the panel. Without a model, only a file that is neither an image, a video,
 * a sound, nor text is refused.
 */
export function baseHalfVideoAddedInputRefusal(model: IBaseHalfVideoCatalogModel | undefined, upstream: readonly string[], added: string, removed?: string): string | undefined {
	if (!model) {
		return baseHalfVideoInputKindOfPath(added) === 'other' ? baseHalfVideoUnusableKindReason(added) : undefined;
	}
	const inputs = removed !== undefined && upstream.includes(removed)
		? upstream.map(entry => entry === removed ? added : entry)
		: [...upstream.filter(entry => entry !== added), added];
	const problem = baseHalfVideoInputProblem(model, inputs.map(path => ({ path, kind: baseHalfVideoInputKindOfPath(path), available: true })));
	return problem && problem.path === added ? problem.reason : undefined;
}

function inputProblemReason(model: IBaseHalfVideoCatalogModel, inputs: readonly IBaseHalfVideoInputSource[], source: IBaseHalfVideoInputSource): string {
	const name = source.path.slice(source.path.lastIndexOf('/') + 1) || source.path;
	const kind = source.kind;
	if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
		return baseHalfVideoUnusableKindReason(source.path);
	}
	const most = Math.max(0, ...model.modes.map(mode => modeTakes(mode.inputs, kind)));
	if (most === 0) {
		return kind === 'image'
			? localize('basehalf.video.catalog.input.noImages', "{0} takes no images.", model.label)
			: kind === 'video'
				? localize('basehalf.video.catalog.input.noVideos', "{0} takes no videos.", model.label)
				: localize('basehalf.video.catalog.input.noAudio', "{0} takes no audio.", model.label);
	}
	if (inputs.filter(input => input.kind === kind).length > most) {
		if (kind === 'image') {
			return most === 1
				? localize('basehalf.video.catalog.input.oneImage', "{0} takes one image at most.", model.label)
				: localize('basehalf.video.catalog.input.images', "{0} takes at most {1} images.", model.label, most);
		}
		if (kind === 'video') {
			return most === 1
				? localize('basehalf.video.catalog.input.oneVideo', "{0} takes one video at most.", model.label)
				: localize('basehalf.video.catalog.input.videos', "{0} takes at most {1} videos.", model.label, most);
		}
		return most === 1
			? localize('basehalf.video.catalog.input.oneAudio', "{0} takes one audio file at most.", model.label)
			: localize('basehalf.video.catalog.input.audios', "{0} takes at most {1} audio files.", model.label, most);
	}
	return localize('basehalf.video.catalog.input.together', "{0} cannot use {1} together with the inputs before it.", model.label, name);
}

/** Removes a leading YAML front matter block, which holds a note's metadata, not its text. */
export function stripBaseHalfMarkdownFrontMatter(text: string): string {
	const normalized = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
	const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
	return match ? normalized.slice(match[0].length) : normalized;
}

/** The longest prompt as sent that the window takes from `check`, as the task record keeps it (D74). */
export const BASEHALF_VIDEO_SENT_PROMPT_MAX_LENGTH = 256 * 1024;

/** The longest text one text input adds to the prompt. */
export const BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH = 16 * 1024;

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
	/** The model makes another kind than the card's, `cardKind`. */
	| { readonly kind: 'otherKind'; readonly model: IBaseHalfVideoCatalogModel; readonly cardKind: BaseHalfModelKind }
	| { readonly kind: 'notSetUp'; readonly provider: IBaseHalfVideoCatalogProvider }
	| { readonly kind: 'region'; readonly model: IBaseHalfVideoCatalogModel; readonly region: IBaseHalfVideoCatalogRegion }
	/** The region offers the model, not its mode; `where` names the regions that do. */
	| { readonly kind: 'modeRegion'; readonly model: IBaseHalfVideoCatalogModel; readonly mode: IBaseHalfVideoCatalogMode; readonly where: string }
	/** An input names a draft, which has no file yet. */
	| { readonly kind: 'draftInput'; readonly path: string }
	/** No mode of the model can use this input with the ones before it ({@link baseHalfVideoInputProblem}); `name` is how the panel names it. */
	| { readonly kind: 'unusableInput'; readonly path: string; readonly name: string; readonly reason: string }
	/** The prompt mentions a file that is not connected (D74). */
	| { readonly kind: 'unconnectedMention'; readonly path: string }
	/** The first problem the provider module reported for the planned generation. */
	| { readonly kind: 'check'; readonly message: string }
	| { readonly kind: 'nothingToSend' };

export interface IBaseHalfVideoGenerateBlockerInput {
	/** The card generates, in this window or in another one of this computer. */
	readonly generating: boolean;
	readonly catalog: BaseHalfVideoCatalogState;
	readonly generation: IBaseHalfVideoGenerationChoice | undefined;
	/** The card's kind; a model of another kind blocks. */
	readonly kind?: BaseHalfModelKind;
	readonly setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup;
	/** What `check` reported for the planned generation, when it was asked. */
	readonly problems?: readonly string[];
	/** The card's prompt, as the panel holds it. */
	readonly prompt: string;
	/** The planned inputs; without them, the blockers that need the inputs are not checked. */
	readonly plan?: readonly IBaseHalfVideoInputPlanItem[];
	/** The mode that is used, which the inputs were planned with ({@link baseHalfVideoModeThatIsUsed}); the card's own mode when absent. */
	readonly mode?: IBaseHalfVideoCatalogMode;
	/** The path of the first mention of the prompt whose file is not connected (D74). */
	readonly unconnected?: string;
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
		return { kind: 'otherKind', model: ref.model, cardKind: input.kind };
	}
	const setup = input.setup(ref.provider);
	if (!setup.setUp) {
		return { kind: 'notSetUp', provider: ref.provider };
	}
	if (!baseHalfVideoRegionOffersModel(ref.model, setup.region.id)) {
		return { kind: 'region', model: ref.model, region: setup.region };
	}
	const mode = input.mode ?? baseHalfVideoModeOf(ref.model, input.generation?.mode);
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
	// Every input is sent: one that no mode of the model can use stops Generate (generation cards, "What is connected is sent").
	const unusable = input.plan ? baseHalfVideoInputProblem(ref.model, input.plan.map(item => ({ path: item.path, kind: item.kind, available: true }))) : undefined;
	if (unusable && input.plan) {
		return { kind: 'unusableInput', path: unusable.path, name: unusable.path.slice(unusable.path.lastIndexOf('/') + 1) || unusable.path, reason: unusable.reason };
	}
	if (input.unconnected !== undefined) {
		return { kind: 'unconnectedMention', path: input.unconnected };
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
			return otherKindText(blocker.model, blocker.cardKind);
		case 'notSetUp':
			return localize('basehalf.video.catalog.blocker.notSetUp', "{0} is not set up. Set it up in Providers.", blocker.provider.label);
		case 'region':
			return localize('basehalf.video.catalog.blocker.region', "{0} is not offered in {1}. Choose another model, or another region in Providers.", blocker.model.label, blocker.region.label);
		case 'modeRegion':
			return localize('basehalf.video.catalog.blocker.modeRegion', "{0} offers {1} mode only in {2}. Choose another mode, or another region in Providers.", blocker.model.label, blocker.mode.label, blocker.where);
		case 'draftInput':
			return baseHalfVideoDraftInputText(blocker.path);
		case 'unusableInput':
			return localize('basehalf.video.catalog.blocker.unusableInput', "{0} cannot be sent: {1}", blocker.name, blocker.reason);
		case 'unconnectedMention':
			return localize('basehalf.video.catalog.blocker.unconnectedMention', "The prompt mentions {0}, which is not connected.", blocker.path.slice(blocker.path.lastIndexOf('/') + 1) || blocker.path);
		case 'check':
			return blocker.message;
		case 'nothingToSend':
			return localize('basehalf.video.catalog.blocker.nothingToSend', "Write a prompt or connect an input to generate.");
	}
}

/** Why a model of another kind than the card's does not generate it: what the model makes, and what to choose. */
function otherKindText(model: IBaseHalfVideoCatalogModel, cardKind: BaseHalfModelKind): string {
	switch (model.kind) {
		case 'image':
			return cardKind === 'audio'
				? localize('basehalf.video.catalog.blocker.imageModelForAudio', "{0} makes images. Choose an audio model.", model.label)
				: localize('basehalf.video.catalog.blocker.imageModel', "{0} makes images. Choose a video model.", model.label);
		case 'video':
			return cardKind === 'audio'
				? localize('basehalf.video.catalog.blocker.videoModelForAudio', "{0} makes videos. Choose an audio model.", model.label)
				: localize('basehalf.video.catalog.blocker.videoModel', "{0} makes videos. Choose an image model.", model.label);
		case 'audio':
			return cardKind === 'image'
				? localize('basehalf.video.catalog.blocker.audioModelForImage', "{0} makes sounds. Choose an image model.", model.label)
				: localize('basehalf.video.catalog.blocker.audioModelForVideo', "{0} makes sounds. Choose a video model.", model.label);
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
 * regions and the one in use, and each model with its kind, what an audio
 * model makes, the regions that offer it and those that retire it, the
 * format an image or an audio model delivers, whether the provider answers
 * with the files at once, its prompt rule, its modes with their slots and
 * limits, its parameters, a speech model's `voice` with the catalog's voices
 * and whether the provider lists more, and whether it is deprecated. It holds
 * no credential, endpoint, id sent to a provider, or price.
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
				...(model.makes ? { makes: model.makes } : {}),
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

// --- Reading what the provider service answers --------------------------------------------------

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
				return Object.freeze({ value: candidate.value, label: requireText(candidate.label, `${path}.options[${index}].label`), ...(description ? { description } : {}) });
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

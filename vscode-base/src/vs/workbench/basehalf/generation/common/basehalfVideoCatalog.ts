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
import { isVoiceId } from '../../../../platform/basehalfProviders/common/basehalfProviderVoices.js';

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

/**
 * The words of credentials that a provider of more than one region refused at
 * its region's own address, followed by the provider's message (D94,
 * providers, "Choosing a region"): the region the request went to, and where
 * the other one is chosen, since a key works only in the region whose console
 * made it. They are short, so that the two lines a card shows of its error
 * name both regions. Undefined for a provider of one region, a region the
 * catalog does not have, and an endpoint the user entered, a relay with keys
 * of its own.
 */
export function baseHalfVideoRefusedInRegion(provider: IBaseHalfVideoCatalogProvider | undefined, access: Pick<IBaseHalfVideoProviderAccess, 'region' | 'endpoint'>, detail: string): string | undefined {
	const region = provider?.regions.find(candidate => candidate.id === access.region);
	if (!provider || !region || provider.regions.length < 2 || access.endpoint !== region.baseUrl) {
		return undefined;
	}
	const others = provider.regions.filter(candidate => candidate !== region);
	return others.length === 1
		? localize('basehalf.video.catalog.refusedInRegion', "Credentials refused in {0}. If they are from {1}, choose that region in Providers: {2}", region.label, others[0].label, detail)
		: localize('basehalf.video.catalog.refusedInRegions', "Credentials refused in {0}. If they are from another region, choose it in Providers: {1}", region.label, detail);
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
 * references it takes, such as `4K · Up to 15 images · 14 references`; for an
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
	// As far as the count's buttons go: as many as the model makes (D91).
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

/**
 * Whether the cards of a kind name their mode (generation cards, "Settings";
 * D90): where the models of the kind differ in it, as video models start
 * from frames, references, or a clip, and audio models make speech, music,
 * or sound effects. A kind whose models all have the same one mode, as
 * every image model has References, names none. Without a catalog, or
 * without a model of the kind, the mode is named.
 */
export function baseHalfKindNamesModes(catalog: IBaseHalfVideoCatalog | undefined, kind: BaseHalfModelKind): boolean {
	const modes = new Set<string>();
	for (const model of modelsOfKind(catalog, kind)) {
		for (const mode of model.modes) {
			modes.add(`${mode.id}:${mode.label}`);
		}
	}
	return modes.size !== 1;
}

/** A kind of input that the reference menu lists and Import File… offers. */
export type BaseHalfTakenInputKind = 'image' | 'video' | 'audio' | 'text';

const EVERY_INPUT_KIND: readonly BaseHalfTakenInputKind[] = Object.freeze(['image', 'video', 'audio', 'text']);

/**
 * The kinds of input that some model of a kind takes, in the order images,
 * videos, audio, and notes (generation cards, "The panel"; D90): what the
 * reference menu lists and Import File… offers on a card of that kind. Every
 * model takes notes, whose text joins the prompt. Without a catalog, or
 * without a model of the kind, every kind.
 */
export function baseHalfKindInputKinds(catalog: IBaseHalfVideoCatalog | undefined, kind: BaseHalfModelKind): readonly BaseHalfTakenInputKind[] {
	const models = modelsOfKind(catalog, kind);
	if (!models.length) {
		return EVERY_INPUT_KIND;
	}
	const inputs = models.flatMap(model => model.modes.map(mode => mode.inputs));
	const image = inputs.some(input => input.startFrame !== 'none' || input.endFrame !== 'none' || input.images.max > 0);
	const video = inputs.some(input => input.source !== 'none' || input.videos.max > 0);
	const audio = inputs.some(input => input.audios.max > 0);
	return Object.freeze(EVERY_INPUT_KIND.filter(candidate => candidate === 'text' || (candidate === 'image' ? image : candidate === 'video' ? video : audio)));
}

function modelsOfKind(catalog: IBaseHalfVideoCatalog | undefined, kind: BaseHalfModelKind): readonly IBaseHalfVideoCatalogModel[] {
	return catalog ? catalog.providers.flatMap(provider => provider.models.filter(model => model.kind === kind)) : [];
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

/** The most files one generation makes, whatever its count; a count's buttons go no further (D91). */
export const BASEHALF_GENERATION_MOST_FILES = 16;

function clampOutputs(value: number): number {
	return Number.isFinite(value) ? Math.min(BASEHALF_GENERATION_MOST_FILES, Math.max(1, value)) : 1;
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
 * id; a model of the same provider keeps it, unless the previous model's
 * catalog declares it and the new model's does not, as where each model
 * speaks in voices of its own.
 */
export function baseHalfVideoChooseModel(generation: IBaseHalfVideoGenerationChoice | undefined, ref: IBaseHalfVideoModelRef): IBaseHalfVideoGenerationChoice {
	const mode = baseHalfVideoModeOf(ref.model, generation?.mode);
	const params = generation?.provider === ref.provider.id
		? withoutOtherModelsVoices(ref.provider.models.find(model => model.id === generation.model), ref.model, generation.params)
		: withoutOtherProvidersVoices(ref.model, generation?.params);
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

/**
 * The values without a voice of the previous model's catalog that the new
 * model of the same provider does not declare: a voice of a model's catalog
 * belongs to that model, while one of the account, which no catalog declares,
 * is the provider's and is kept.
 */
function withoutOtherModelsVoices(previous: IBaseHalfVideoCatalogModel | undefined, model: IBaseHalfVideoCatalogModel, params: BaseHalfVideoParams | undefined): BaseHalfVideoParams | undefined {
	if (!params || !previous || previous.id === model.id) {
		return params;
	}
	const kept: Record<string, BaseHalfVideoParamValue> = { ...params };
	for (const parameter of model.parameters) {
		const value = kept[parameter.name];
		if (parameter.kind !== 'voice' || typeof value !== 'string' || parameter.options.some(option => option.value === value)) {
			continue;
		}
		const before = previous.parameters.find((candidate): candidate is IBaseHalfVideoVoiceParameter => candidate.kind === 'voice' && candidate.name === parameter.name);
		if (before?.options.some(option => option.value === value)) {
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
 * The summary of the settings (generation cards, "Settings"): the mode, when
 * the card's kind names it ({@link baseHalfKindNamesModes}), then each
 * parameter that is not advanced and has a value, such as `Frames · 720p ·
 * 5s · Sound`. The voice of a speech model is not among the settings: its
 * own button shows it, and the summary leaves it out (D78).
 */
export function baseHalfVideoSettingsSummary(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | undefined, params: BaseHalfVideoParams | undefined, startFrame = false, namesMode = true): readonly string[] {
	const mode = baseHalfVideoModeOf(model, modeId);
	const values = normalizeBaseHalfVideoParams(model, mode.id, params);
	const parts = namesMode ? [mode.label] : [];
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
 * "The panel of a card with its file"): the mode, when the card's kind names
 * it, then the values as they were sent, never made legal again, in the
 * model's order with the catalog's names, then the values the catalog does
 * not know by their recorded names. The advanced ones only with `advanced`.
 * The voice of a speech model is left out: the panel names it beside the
 * model (D78).
 */
export function baseHalfVideoRecordedSettingsSummary(model: IBaseHalfVideoCatalogModel, modeId: string, params: BaseHalfVideoParams, advanced = false, namesMode = true): readonly string[] {
	const parts = namesMode ? [model.modes.find(mode => mode.id === modeId)?.label ?? modeId] : [];
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

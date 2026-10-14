/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { language } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import {
	BASEHALF_VIDEO_AUTO_DURATION,
	BaseHalfVideoMode,
	BaseHalfVideoProviderKind,
	IBaseHalfVideoGenerationSettings,
	IBaseHalfVideoSettings
} from './basehalfVideoNode.js';

/**
 * Video providers, the models BaseHalf knows, and the rules that turn a Video
 * node's settings and inputs into a provider request (D58). Pure: the panel,
 * the generation service, and the tests share these rules, so what the panel
 * shows is what is sent.
 */

// --- providers -------------------------------------------------------------------------------

/** What local media a provider's request format can carry. */
export interface IBaseHalfVideoProviderMediaSupport {
	/** Reference images can be sent from local files (as data URLs or uploads). */
	readonly referenceImages: boolean;
	/** Reference videos can be sent from local files. */
	readonly referenceVideos: boolean;
	/** Reference audio can be sent from local files. */
	readonly referenceAudios: boolean;
}

export interface IBaseHalfVideoProviderPreset {
	readonly kind: BaseHalfVideoProviderKind;
	readonly label: string;
	/** The endpoint a new channel of this preset starts with; empty when the user must enter one. The user can change it, for a relay. */
	readonly baseUrl: string;
	readonly media: IBaseHalfVideoProviderMediaSupport;
	/** The models a new channel of this preset lists. The user can add any model id. */
	readonly models: readonly IBaseHalfVideoModelProfile[];
}

export type BaseHalfVideoDurationChoice =
	| { readonly kind: 'range'; readonly min: number; readonly max: number }
	| { readonly kind: 'values'; readonly values: readonly number[] };

/** What one model accepts. Unknown models get {@link genericProfile}. */
export interface IBaseHalfVideoModelProfile {
	readonly id: string;
	readonly label: string;
	/** False for the profile BaseHalf assumes for a model it does not know. */
	readonly known: boolean;
	readonly modes: readonly BaseHalfVideoMode[];
	/** How many images frames mode carries: 0 (text only), 1 (start frame), or 2 (start and end frames). */
	readonly frames: 0 | 1 | 2;
	/** How many inputs of each kind reference mode carries. */
	readonly references: { readonly images: number; readonly videos: number; readonly audios: number };
	/** The ratios to choose from. One or none: the model decides, and the panel shows no ratio. */
	readonly ratios: readonly string[];
	/** The only ratio a frames generation with a start frame accepts, when the model has one. */
	readonly framesRatio?: string;
	readonly resolutions: readonly string[];
	readonly durations: BaseHalfVideoDurationChoice;
	readonly autoDuration: boolean;
	/** Whether the model has a switch for generated sound. */
	readonly audio: boolean;
	/** The longest duration a resolution allows, where the model limits it. */
	readonly maxDurationByResolution?: Readonly<Record<string, number>>;
	/** The only duration a resolution allows, where the model fixes it. */
	readonly durationByResolution?: Readonly<Record<string, number>>;
	/** The only duration references mode allows, where the model fixes it. */
	readonly referenceDuration?: number;
	readonly defaults: IBaseHalfVideoSettings;
}

const SEEDANCE_RATIOS = Object.freeze(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
const COMMON_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
const WAN_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);

function profile(value: Omit<IBaseHalfVideoModelProfile, 'known'>): IBaseHalfVideoModelProfile {
	return Object.freeze({ ...value, known: true });
}

const SEEDANCE_2_5 = profile({
	id: 'doubao-seedance-2-5-260628',
	label: 'Seedance 2.5',
	modes: ['frames', 'reference'],
	frames: 2,
	references: { images: 30, videos: 3, audios: 3 },
	ratios: SEEDANCE_RATIOS,
	framesRatio: 'adaptive',
	resolutions: ['480p', '720p', '1080p'],
	durations: { kind: 'range', min: 4, max: 30 },
	autoDuration: true,
	audio: true,
	defaults: { mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true }
});

const SEEDANCE_2_0_MINI = profile({
	id: 'dreamina-seedance-2-0-mini-260615',
	label: 'Seedance 2.0 Mini',
	modes: ['frames', 'reference'],
	frames: 2,
	references: { images: 9, videos: 3, audios: 3 },
	ratios: SEEDANCE_RATIOS,
	resolutions: ['480p', '720p'],
	durations: { kind: 'range', min: 4, max: 15 },
	autoDuration: true,
	audio: true,
	defaults: { mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true }
});

const SEEDANCE_1_5_PRO = profile({
	id: 'seedance-1-5-pro-251215',
	label: 'Seedance 1.5 Pro',
	modes: ['frames'],
	frames: 2,
	references: { images: 0, videos: 0, audios: 0 },
	ratios: SEEDANCE_RATIOS,
	resolutions: ['480p', '720p', '1080p'],
	durations: { kind: 'range', min: 4, max: 12 },
	autoDuration: true,
	audio: true,
	defaults: { mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true }
});

const HAILUO_02 = profile({
	id: 'MiniMax-Hailuo-02',
	label: 'MiniMax Hailuo-02',
	modes: ['frames'],
	frames: 2,
	references: { images: 0, videos: 0, audios: 0 },
	ratios: [],
	resolutions: ['768P', '1080P'],
	durations: { kind: 'values', values: [6, 10] },
	autoDuration: false,
	audio: false,
	maxDurationByResolution: { '1080P': 6 },
	defaults: { mode: 'frames', ratio: 'adaptive', resolution: '768P', duration: 6, audio: false }
});

const WAN_2_6_T2V = profile({
	id: 'wan2.6-t2v',
	label: 'Wan 2.6',
	modes: ['frames'],
	frames: 0,
	references: { images: 0, videos: 0, audios: 0 },
	ratios: WAN_RATIOS,
	resolutions: ['720P', '1080P'],
	durations: { kind: 'range', min: 2, max: 15 },
	autoDuration: false,
	audio: false,
	defaults: { mode: 'frames', ratio: '16:9', resolution: '1080P', duration: 5, audio: true }
});

const WAN_2_6_I2V = profile({
	id: 'wan2.6-i2v',
	label: 'Wan 2.6 Image to Video',
	modes: ['frames'],
	frames: 1,
	references: { images: 0, videos: 0, audios: 0 },
	ratios: [],
	resolutions: ['720P', '1080P'],
	durations: { kind: 'range', min: 2, max: 15 },
	autoDuration: false,
	audio: false,
	defaults: { mode: 'frames', ratio: 'adaptive', resolution: '1080P', duration: 5, audio: true }
});

/** Veo 3.1 on the Gemini API (checked on 2026-10-15): 1080p, 4k, and reference images need 8 seconds; sound is always on. */
const VEO_3_1 = profile({
	id: 'veo-3.1-generate-preview',
	label: 'Veo 3.1',
	modes: ['frames', 'reference'],
	frames: 2,
	references: { images: 3, videos: 0, audios: 0 },
	ratios: ['16:9', '9:16'],
	resolutions: ['720p', '1080p', '4k'],
	durations: { kind: 'values', values: [4, 6, 8] },
	autoDuration: false,
	audio: false,
	durationByResolution: { '1080p': 8, '4k': 8 },
	referenceDuration: 8,
	defaults: { mode: 'frames', ratio: '16:9', resolution: '720p', duration: 8, audio: true }
});

const VEO_3_1_FAST = profile({ ...VEO_3_1, id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast' });

const VEO_3_1_LITE = profile({
	...VEO_3_1,
	id: 'veo-3.1-lite-generate-preview',
	label: 'Veo 3.1 Lite',
	modes: ['frames'],
	references: { images: 0, videos: 0, audios: 0 },
	resolutions: ['720p', '1080p'],
	durationByResolution: { '1080p': 8 },
	referenceDuration: undefined
});

/** Images travel inside the request as data URLs; videos and audio would need public URLs. */
const IMAGES_ONLY_MEDIA: IBaseHalfVideoProviderMediaSupport = Object.freeze({ referenceImages: true, referenceVideos: false, referenceAudios: false });
const ALL_LOCAL_MEDIA: IBaseHalfVideoProviderMediaSupport = Object.freeze({ referenceImages: true, referenceVideos: true, referenceAudios: true });

const NO_REFERENCE_MEDIA: IBaseHalfVideoProviderMediaSupport = Object.freeze({ referenceImages: false, referenceVideos: false, referenceAudios: false });

function preset(kind: BaseHalfVideoProviderKind, label: () => string, baseUrl: string, media: IBaseHalfVideoProviderMediaSupport, models: readonly IBaseHalfVideoModelProfile[]): IBaseHalfVideoProviderPreset {
	return Object.freeze({
		kind,
		get label() { return label(); },
		baseUrl,
		media,
		models: Object.freeze([...models])
	});
}

const PRESETS: readonly IBaseHalfVideoProviderPreset[] = Object.freeze([
	preset('ark', () => localize('basehalf.video.provider.ark', "Volcengine Ark"), 'https://ark.cn-beijing.volces.com/api/v3', IMAGES_ONLY_MEDIA, [SEEDANCE_2_5]),
	preset('byteplus', () => localize('basehalf.video.provider.byteplus', "BytePlus ModelArk"), 'https://ark.ap-southeast.bytepluses.com/api/v3', IMAGES_ONLY_MEDIA, [SEEDANCE_2_0_MINI, SEEDANCE_1_5_PRO]),
	preset('dashscope', () => localize('basehalf.video.provider.dashscope', "Alibaba Cloud Model Studio"), 'https://dashscope.aliyuncs.com/api/v1', NO_REFERENCE_MEDIA, [WAN_2_6_T2V, WAN_2_6_I2V]),
	preset('minimax', () => localize('basehalf.video.provider.minimax', "MiniMax"), 'https://api.minimaxi.com/v1', NO_REFERENCE_MEDIA, [HAILUO_02]),
	preset('gemini', () => localize('basehalf.video.provider.gemini', "Google Gemini"), 'https://generativelanguage.googleapis.com/v1beta', IMAGES_ONLY_MEDIA, [VEO_3_1, VEO_3_1_FAST, VEO_3_1_LITE]),
	// OpenAI's own Videos API closed on 2026-09-24; the format lives on in relays, whose endpoint the user enters.
	preset('openai', () => localize('basehalf.video.provider.openai', "OpenAI Compatible"), '', ALL_LOCAL_MEDIA, [])
]);

export function getBaseHalfVideoProviderPresets(): readonly IBaseHalfVideoProviderPreset[] {
	return PRESETS;
}

export function getBaseHalfVideoProviderPreset(kind: BaseHalfVideoProviderKind): IBaseHalfVideoProviderPreset {
	const preset = PRESETS.find(candidate => candidate.kind === kind);
	if (!preset) {
		throw new Error(`Unknown video provider '${kind}'.`);
	}
	return preset;
}

/**
 * The profile of a model on a provider: the known one, or what BaseHalf
 * assumes for a model it does not know. Known or not, the provider's request
 * format limits what can be sent from local files.
 */
export function getBaseHalfVideoModelProfile(provider: BaseHalfVideoProviderKind, modelId: string): IBaseHalfVideoModelProfile {
	const preset = getBaseHalfVideoProviderPreset(provider);
	const known = PRESETS.flatMap(candidate => candidate.models).find(candidate => candidate.id === modelId);
	const base = known ?? genericProfile(provider, modelId);
	return withProviderMedia(base, preset.media);
}

/** The name the panel shows for a model. */
export function baseHalfVideoModelLabel(modelId: string): string {
	return PRESETS.flatMap(candidate => candidate.models).find(candidate => candidate.id === modelId)?.label ?? modelId;
}

function genericProfile(provider: BaseHalfVideoProviderKind, modelId: string): IBaseHalfVideoModelProfile {
	if (provider === 'gemini') {
		// Veo models other than the known ones take what Veo 3.1 takes.
		return Object.freeze({ ...VEO_3_1, id: modelId, label: modelId, known: false });
	}
	const seedanceFormat = provider === 'ark' || provider === 'byteplus';
	return Object.freeze({
		id: modelId,
		label: modelId,
		known: false,
		modes: Object.freeze<BaseHalfVideoMode[]>(['frames', 'reference']),
		frames: 2,
		references: Object.freeze({ images: 9, videos: 3, audios: 3 }),
		ratios: seedanceFormat ? SEEDANCE_RATIOS : COMMON_RATIOS,
		resolutions: Object.freeze(['480p', '720p', '1080p']),
		durations: Object.freeze({ kind: 'range', min: 4, max: 15 }),
		autoDuration: false,
		audio: true,
		defaults: Object.freeze({ mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true })
	});
}

function withProviderMedia(value: IBaseHalfVideoModelProfile, media: IBaseHalfVideoProviderMediaSupport): IBaseHalfVideoModelProfile {
	const references = Object.freeze({
		images: media.referenceImages ? value.references.images : 0,
		videos: media.referenceVideos ? value.references.videos : 0,
		audios: media.referenceAudios ? value.references.audios : 0
	});
	const referenceUsable = references.images + references.videos + references.audios > 0;
	const modes = value.modes.filter(mode => mode !== 'reference' || referenceUsable);
	return Object.freeze({
		...value,
		references,
		modes: Object.freeze(modes.length ? modes : ['frames'] as BaseHalfVideoMode[])
	});
}

// --- settings --------------------------------------------------------------------------------

/**
 * Turns settings into ones the model accepts. A value the model accepts is
 * kept; any other takes the model's default. Nothing asks: the panel shows the
 * result, and that is what is sent.
 */
export function normalizeBaseHalfVideoSettings(settings: Partial<IBaseHalfVideoSettings> | undefined, modelProfile: IBaseHalfVideoModelProfile): IBaseHalfVideoSettings {
	const defaults = modelProfile.defaults;
	const mode = settings?.mode && modelProfile.modes.includes(settings.mode) ? settings.mode : (modelProfile.modes.includes(defaults.mode) ? defaults.mode : modelProfile.modes[0]);
	const ratio = modelProfile.ratios.length <= 1
		? (modelProfile.ratios[0] ?? defaults.ratio)
		: settings?.ratio && modelProfile.ratios.includes(settings.ratio) ? settings.ratio : defaults.ratio;
	const resolution = settings?.resolution && modelProfile.resolutions.includes(settings.resolution) ? settings.resolution : defaults.resolution;
	let duration = settings?.duration ?? defaults.duration;
	if (duration === BASEHALF_VIDEO_AUTO_DURATION) {
		duration = modelProfile.autoDuration ? duration : defaults.duration;
	} else {
		duration = nearestDuration(duration, modelProfile.durations);
	}
	const limit = modelProfile.maxDurationByResolution?.[resolution];
	if (limit !== undefined && (duration === BASEHALF_VIDEO_AUTO_DURATION || duration > limit)) {
		duration = nearestDuration(limit, modelProfile.durations);
	}
	const fixed = modelProfile.durationByResolution?.[resolution] ?? (mode === 'reference' ? modelProfile.referenceDuration : undefined);
	if (fixed !== undefined) {
		duration = fixed;
	}
	const audio = modelProfile.audio ? (settings?.audio ?? defaults.audio) : defaults.audio;
	return Object.freeze({ mode, ratio, resolution, duration, audio });
}

/** The settings a new Video node starts with: the last ones used, made legal for their model. */
export function baseHalfVideoInitialSettings(
	lastUsed: IBaseHalfVideoGenerationSettings | undefined,
	modelProfile: IBaseHalfVideoModelProfile | undefined
): IBaseHalfVideoGenerationSettings {
	const settings = modelProfile ? normalizeBaseHalfVideoSettings(lastUsed, modelProfile) : {
		mode: lastUsed?.mode ?? 'frames',
		ratio: lastUsed?.ratio ?? '16:9',
		resolution: lastUsed?.resolution ?? '720p',
		duration: lastUsed?.duration ?? 5,
		audio: lastUsed?.audio ?? true
	};
	return Object.freeze({
		...settings,
		...(lastUsed?.channel !== undefined ? { channel: lastUsed.channel } : {}),
		...(lastUsed?.model !== undefined ? { model: lastUsed.model } : {})
	});
}

/** The ratio sent: a frames generation with a start frame uses the model's only accepted ratio. */
export function baseHalfVideoEffectiveRatio(settings: IBaseHalfVideoSettings, modelProfile: IBaseHalfVideoModelProfile, hasStartFrame: boolean): string {
	if (settings.mode === 'frames' && hasStartFrame && modelProfile.framesRatio) {
		return modelProfile.framesRatio;
	}
	return settings.ratio;
}

export function baseHalfVideoDurationValues(choice: BaseHalfVideoDurationChoice): readonly number[] {
	if (choice.kind === 'values') {
		return choice.values;
	}
	const values: number[] = [];
	for (let value = choice.min; value <= choice.max; value++) {
		values.push(value);
	}
	return values;
}

function nearestDuration(value: number, choice: BaseHalfVideoDurationChoice): number {
	if (choice.kind === 'range') {
		return Math.min(choice.max, Math.max(choice.min, Math.round(value)));
	}
	return choice.values.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, choice.values[0]);
}

// --- inputs ----------------------------------------------------------------------------------

export type BaseHalfVideoInputKind = 'image' | 'video' | 'audio' | 'text' | 'other';

/** One upstream entry of a Video node, resolved: a `.bhnode` stands for the file it shows. */
export interface IBaseHalfVideoInputSource {
	/** The upstream entry, workspace-relative. */
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	/** False when the entry names nothing, or a node that shows no file yet. */
	readonly available: boolean;
}

export type BaseHalfVideoInputUse = 'start-frame' | 'end-frame' | 'reference' | 'text' | 'unused';

/**
 * Why an input is not used: `missing` names nothing; `kind` cannot be used,
 * such as a folder or a PDF; `mode` cannot be used in this mode; `full` comes
 * after the inputs the mode or the model can take.
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
 * How a generation uses each input, in upstream order. Frames mode takes the
 * first image as the start frame and the second as the end frame, as far as
 * the model takes frames. Reference mode takes images, videos, and audio in
 * order, as many as the model and the provider take. Text inputs join the
 * prompt in both modes. Images, videos, and audio are numbered by kind in
 * upstream order, used or not, so a name in the prompt keeps meaning the same
 * input.
 */
export function planBaseHalfVideoInputs(
	mode: BaseHalfVideoMode,
	sources: readonly IBaseHalfVideoInputSource[],
	modelProfile: IBaseHalfVideoModelProfile,
	displayLanguage: string = language
): readonly IBaseHalfVideoInputPlanItem[] {
	const ordinals = { image: 0, video: 0, audio: 0 };
	const taken = { image: 0, video: 0, audio: 0 };
	const limits = modelProfile.references;
	return Object.freeze(sources.map((source): IBaseHalfVideoInputPlanItem => {
		const item = { path: source.path, kind: source.kind };
		const label = source.kind === 'image' || source.kind === 'video' || source.kind === 'audio'
			? baseHalfVideoInputLabel(source.kind, ++ordinals[source.kind], displayLanguage)
			: undefined;
		const labelled = label !== undefined ? { ...item, label } : item;
		if (!source.available) {
			return Object.freeze({ ...labelled, use: 'unused', reason: 'missing' });
		}
		if (source.kind === 'text') {
			return Object.freeze({ ...labelled, use: 'text' });
		}
		if (source.kind === 'other') {
			return Object.freeze({ ...labelled, use: 'unused', reason: 'kind' });
		}
		if (mode === 'frames') {
			if (source.kind !== 'image') {
				return Object.freeze({ ...labelled, use: 'unused', reason: 'mode' });
			}
			if (modelProfile.frames === 0) {
				return Object.freeze({ ...labelled, use: 'unused', reason: 'mode' });
			}
			const index = taken.image++;
			if (index >= modelProfile.frames) {
				return Object.freeze({ ...labelled, use: 'unused', reason: 'full' });
			}
			return Object.freeze({ ...labelled, use: index === 0 ? 'start-frame' : 'end-frame' });
		}
		const limit = source.kind === 'image' ? limits.images : source.kind === 'video' ? limits.videos : limits.audios;
		if (limit === 0) {
			return Object.freeze({ ...labelled, use: 'unused', reason: 'mode' });
		}
		if (taken[source.kind]++ >= limit) {
			return Object.freeze({ ...labelled, use: 'unused', reason: 'full' });
		}
		return Object.freeze({ ...labelled, use: 'reference' });
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

// --- readiness -------------------------------------------------------------------------------

/**
 * Why the node cannot generate now, checked in this order. The panel shows
 * the first one next to a disabled Generate button; the generation service
 * refuses with the same reason.
 */
export type BaseHalfVideoGenerateBlocker =
	/** The node is generating. */
	| 'generating'
	/** No model is chosen. */
	| 'noModel'
	/** No channel on this computer offers the chosen model. */
	| 'noChannel'
	/** The channel has no endpoint yet. */
	| 'noEndpoint'
	/** The channel has no API key. */
	| 'noKey'
	/** There is no prompt, no text input, and no used image, video, or audio. */
	| 'nothingToSend';

export interface IBaseHalfVideoGenerateReadinessInput {
	readonly generating: boolean;
	readonly model: string | undefined;
	readonly channelFound: boolean;
	/** Absent counts as having one. */
	readonly channelHasEndpoint?: boolean;
	readonly channelHasKey: boolean;
	readonly prompt: string;
	readonly plan: readonly IBaseHalfVideoInputPlanItem[];
}

export function getBaseHalfVideoGenerateBlocker(input: IBaseHalfVideoGenerateReadinessInput): BaseHalfVideoGenerateBlocker | undefined {
	if (input.generating) {
		return 'generating';
	}
	if (!input.model) {
		return 'noModel';
	}
	if (!input.channelFound) {
		return 'noChannel';
	}
	if (input.channelHasEndpoint === false) {
		return 'noEndpoint';
	}
	if (!input.channelHasKey) {
		return 'noKey';
	}
	if (!input.prompt.trim() && !input.plan.some(item => item.use !== 'unused')) {
		return 'nothingToSend';
	}
	return undefined;
}

// --- provider requests (workbench to the AI Video extension) --------------------------------

/** Internal commands of the built-in AI Video extension that talk to providers. */
export const BASEHALF_VIDEO_PROVIDER_COMMANDS = Object.freeze({
	submit: 'basehalf.video.provider.submit',
	poll: 'basehalf.video.provider.poll',
	download: 'basehalf.video.provider.download',
	cancel: 'basehalf.video.provider.cancel'
});

/** A local file the extension reads, or an image the workbench already encoded (a rasterized SVG). */
export type BaseHalfVideoProviderMedia =
	| { readonly fsPath: string; readonly mimeType: string }
	| { readonly dataUrl: string };

export interface IBaseHalfVideoProviderEndpoint {
	readonly provider: BaseHalfVideoProviderKind;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
}

export interface IBaseHalfVideoProviderRequest extends IBaseHalfVideoProviderEndpoint {
	/** The prompt as sent, text inputs included. */
	readonly prompt: string;
	readonly mode: BaseHalfVideoMode;
	/** The effective ratio; see {@link baseHalfVideoEffectiveRatio}. */
	readonly ratio: string;
	readonly resolution: string;
	readonly duration: number;
	readonly audio: boolean;
	readonly startFrame?: BaseHalfVideoProviderMedia;
	readonly endFrame?: BaseHalfVideoProviderMedia;
	readonly referenceImages: readonly BaseHalfVideoProviderMedia[];
	readonly referenceVideos: readonly BaseHalfVideoProviderMedia[];
	readonly referenceAudios: readonly BaseHalfVideoProviderMedia[];
}

export interface IBaseHalfVideoProviderTaskRef extends IBaseHalfVideoProviderEndpoint {
	readonly remoteId: string;
}

export type BaseHalfVideoProviderPollState =
	| { readonly state: 'pending' | 'running'; readonly fraction?: number }
	| { readonly state: 'succeeded'; readonly videoUrl?: string }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

export interface IBaseHalfVideoProviderDownloadRequest extends IBaseHalfVideoProviderTaskRef {
	/** From the poll; without it the provider's own content endpoint is used. */
	readonly videoUrl?: string;
	/** Where the extension writes the file. The workbench chooses it inside the workspace. */
	readonly targetFsPath: string;
}

/**
 * `auth`: the key was refused. `rejected`: the provider refused the request
 * and certainly made no task. `unknownOutcome`: the request may have reached
 * the provider; it is never sent again by itself. `network`: nothing came
 * back. `invalidResponse`: an answer BaseHalf cannot read. `notVideo` and
 * `tooLarge`: a download that is not an MP4 or is larger than allowed.
 */
export type BaseHalfVideoProviderErrorCode = 'auth' | 'rejected' | 'rateLimited' | 'unknownOutcome' | 'network' | 'invalidResponse' | 'notFound' | 'notVideo' | 'tooLarge';

export interface IBaseHalfVideoProviderError {
	readonly code: BaseHalfVideoProviderErrorCode;
	/** Plain text for the card, without secrets or markup. */
	readonly message: string;
	readonly status?: number;
}

/** Every provider command answers with this, so an error never arrives as an exception text. */
export type BaseHalfVideoProviderResponse<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: IBaseHalfVideoProviderError };

/** The largest video BaseHalf downloads. */
export const BASEHALF_VIDEO_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
/** The largest image or other media file sent from the workspace. */
export const BASEHALF_VIDEO_MAX_INPUT_BYTES = 20 * 1024 * 1024;

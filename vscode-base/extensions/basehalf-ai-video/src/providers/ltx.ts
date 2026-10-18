/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, isPlannedMedia, measureItems, type MeasuredItem } from './check.ts';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import type { HttpAnswer, ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaFormat, type MediaInspector, type PlannedItem, type ReadMedia } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type {
	CatalogMode,
	CatalogModel,
	CatalogParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
	Estimate,
	ModeId,
	ModeLimits,
	Params,
	PlannedCounts,
	PollState,
	ProviderErrorCode,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * Lightricks' LTX video models on LTX's asynchronous API (D59;
 * `docs/specs/video-providers/ltx.md`, which records the pages each fact comes
 * from). One API key as a bearer token. The mode and the inputs choose the
 * endpoint: text or image to video in Frames, audio to video in References,
 * retake in Edit, extend in Extend; every endpoint takes the same model id. A
 * small image goes inline as a data URI; a larger one, videos, and audio go
 * through LTX's upload. A job is asked about at the endpoint it was made at,
 * which its task id names (`<endpoint>/<job id>`). LTX cannot cancel a job.
 */

type LtxModelId = 'ltx-2-5-fast' | 'ltx-2-5-pro' | 'ltx-2-3-fast' | 'ltx-2-3-pro';
/** The shared resolution values; `2k` is LTX's 1440p tier. */
type Resolution = '720p' | '1080p' | '2k' | '4k';
type Endpoint = 'text-to-video' | 'image-to-video' | 'audio-to-video' | 'retake' | 'extend';
type MediaKind = 'image' | 'video' | 'audio';

// --- labels and texts ---------------------------------------------------------------------------

const RESOLUTIONS: readonly Resolution[] = Object.freeze(['720p', '1080p', '2k', '4k']);
const CAMERA_MOTIONS: readonly string[] = Object.freeze(['dolly_in', 'dolly_out', 'dolly_left', 'dolly_right', 'jib_up', 'jib_down', 'static', 'focus_shift']);
const FRAME_RATES: readonly number[] = Object.freeze([24, 25, 48, 50]);

/** Every label of the catalog entry, in English, in one table so that they can be translated later. */
const LABELS = Object.freeze({
	provider: 'LTX',
	region: 'LTX API',
	apiKey: 'API Key',
	modes: Object.freeze<Record<'frames' | 'reference' | 'edit' | 'extend', string>>({ frames: 'Frames', reference: 'References', edit: 'Edit', extend: 'Extend' }),
	resolution: 'Resolution',
	resolutions: Object.freeze<Record<Resolution, string>>({ '720p': '720p', '1080p': '1080p', '2k': '1440p', '4k': '4K' }),
	ratio: 'Ratio',
	ratioTooltip: 'The shape of the video, also when it starts from a frame or an image.',
	duration: 'Duration',
	durationTooltips: Object.freeze({
		fastAuto: 'Longer than 10 seconds only at 720p or 1080p and 24 or 25 fps. Auto lets LTX choose the length from the prompt, but not with an end frame.',
		auto: 'Auto lets LTX choose the length from the prompt, but not with an end frame.',
		fast: 'Longer than 10 seconds only at 720p or 1080p and 24 or 25 fps.'
	}),
	auto: 'Auto',
	fps: 'Frame Rate',
	fpsTooltip: 'Frames per second of the video.',
	sound: 'Sound',
	cameraMotion: 'Camera Motion',
	cameraMotionTooltip: 'A camera move LTX gives the video.',
	cameraMotions: Object.freeze<Record<string, string>>({
		'dolly_in': 'Dolly In',
		'dolly_out': 'Dolly Out',
		'dolly_left': 'Dolly Left',
		'dolly_right': 'Dolly Right',
		'jib_up': 'Jib Up',
		'jib_down': 'Jib Down',
		'static': 'Static',
		'focus_shift': 'Focus Shift'
	}),
	startTime: 'Start',
	startTimeTooltip: 'Where the section that LTX makes again begins in the clip.',
	retakeDuration: 'Length',
	retakeDurationTooltip: 'How long the section is, at least 2 seconds. A section past the end of the clip ends with the clip.',
	retakeMode: 'Replace',
	retakeModeTooltip: 'What LTX makes again in the section: the picture and the sound, the picture only, or the sound only.',
	retakeModes: Object.freeze({ both: 'Video and Sound', video: 'Video', audio: 'Sound' }),
	extendDuration: 'Extension',
	extendDurationTooltip: 'The seconds LTX adds to the clip.',
	extendMode: 'Extend At',
	extendModeTooltip: 'Whether the new seconds come after the clip or before it.',
	extendModes: Object.freeze({ end: 'End', start: 'Start' }),
	context: 'Context',
	contextTooltip: 'The seconds of the clip that LTX continues from, 1 to 20. With the extension they may be at most 505 frames, about 21 seconds at 24 fps. Without a value, LTX uses as much as fits.',
	models: Object.freeze<Record<LtxModelId, { readonly label: string; readonly description: string }>>({
		'ltx-2-5-fast': {
			label: 'LTX-2.5 Fast',
			description: 'Text or start and end frames to video of 6 to 20 seconds, or Auto, up to 4K with sound; or an audio track, with an image as its first frame, to video as long as the audio.'
		},
		'ltx-2-5-pro': {
			label: 'LTX-2.5 Pro',
			description: 'LTX-2.5 at higher fidelity: text or start and end frames to video of 6 to 10 seconds, or Auto, up to 4K with sound; or an audio track, with an image as its first frame, to video as long as the audio.'
		},
		'ltx-2-3-fast': {
			label: 'LTX-2.3 Fast',
			description: 'Text or start and end frames to landscape or portrait video of 6 to 20 seconds up to 4K, with sound.'
		},
		'ltx-2-3-pro': {
			label: 'LTX-2.3 Pro',
			description: 'Text or start and end frames to landscape or portrait video of 6 to 10 seconds up to 4K with sound; an audio track, with an image as its first frame, to video; a section of a clip made again; or a clip extended.'
		}
	})
});

/** The sentences of the module's problems and failures. */
const TEXT = Object.freeze({
	promptForFrame: (model: string) => `Write a prompt: ${model} needs one in Frames mode.`,
	longOnlyAtLowRates: (model: string) => `${model} makes videos longer than 10 seconds only at 720p or 1080p and 24 or 25 fps.`,
	autoWithEndFrame: (model: string) => `${model} cannot choose the length itself with an end frame: choose a duration, or leave out the end frame.`,
	audioTooLong: (item: string, seconds: string, resolution: string, model: string, longest: number) =>
		`${item} is ${seconds} seconds long; at ${resolution}, ${model} takes at most ${longest} seconds of audio.`,
	clipUnreadable: (item: string) => `${item} is not an MP4 or MOV video whose length AI Video can read.`,
	clipTooShort: (item: string, seconds: string) => `${item} is ${seconds} seconds long; LTX needs a clip of at least 73 frames, about 3 seconds at 24 fps.`,
	sectionAfterClip: (start: string, item: string, seconds: string) => `The section starts at ${start} seconds, after the end of ${item}, which is ${seconds} seconds long.`,
	wrongFormat: Object.freeze<Record<MediaKind, (item: string) => string>>({
		image: item => `${item} is not a PNG, JPEG, or WebP image.`,
		video: item => `${item} is not an MP4 or MOV video.`,
		audio: item => `${item} is not WAV, MP3, or M4A audio.`
	}),
	pcm: (item: string) => `${item} holds PCM audio, which LTX does not take. Use MP3 or M4A audio, or a WAV of AAC, MP3, Vorbis, or FLAC audio.`,
	notTaken: (item: string, model: string, mode: string) => `${item} cannot be sent: ${model} takes no such input in ${mode} mode.`,
	noSize: (resolution: string, ratio: string) => `LTX has no size for ${resolution} at ${ratio}.`,
	notOffered: (model: string) => `LTX does not offer ${model} in this region.`,
	noMode: (model: string, mode: string) => `${model} has no ${mode} mode.`,
	uploadFailed: (item: string, detail: string) => `LTX could not take ${item}: ${detail}`,
	uploadUnreadable: 'LTX answered the upload request in a form AI Video cannot read.',
	storageRefused: (item: string, status: number, code: string | undefined, message: string | undefined) =>
		`LTX's storage refused ${item} (HTTP ${status}${code ? `, ${code}` : ''})${message ? `: ${message}` : '.'}`,
	noJobId: 'LTX accepted the request but gave no job id AI Video can read.',
	notLtxTask: (remoteId: string) => `The task ${remoteId} names no LTX endpoint, so AI Video cannot ask LTX about it.`,
	failed: 'LTX reports that the job failed.',
	noVideo: 'LTX reports that the job completed but gives no address of its video.',
	noVideoYet: 'LTX gives no address of a video for this job.',
	unknownStatus: (status: string) => `LTX reports a job status AI Video does not know: ${status || 'none'}.`
});

// --- the models ---------------------------------------------------------------------------------

/** US dollars per second by resolution. */
type Prices = Readonly<Record<Resolution, number>>;

interface LtxModel {
	/** The catalog id, which is also the id LTX takes at every endpoint. */
	readonly id: LtxModelId;
	/** LTX-2.5 makes 1:1, 3:2, and 2:3 too, and can choose the length itself (Auto). */
	readonly generation: '2.5' | '2.3';
	/** Fast models make up to 20 seconds at 720p and 1080p with 24 or 25 fps; pro models 10. */
	readonly fast: boolean;
	/** Text and image to video. */
	readonly prices: Prices;
	/** Audio to video (References): the longest audio at 720p and 1080p, and the prices per second of audio. */
	readonly audio?: { readonly longest: number; readonly prices: Prices };
	/** Retake (Edit) and extend (Extend). */
	readonly clips: boolean;
}

const MODELS: readonly LtxModel[] = Object.freeze([
	{
		id: 'ltx-2-5-fast', generation: '2.5', fast: true, clips: false,
		prices: { '720p': 0.09, '1080p': 0.13, '2k': 0.19, '4k': 0.30 },
		audio: { longest: 20, prices: { '720p': 0.09, '1080p': 0.13, '2k': 0.19, '4k': 0.30 } }
	},
	{
		id: 'ltx-2-5-pro', generation: '2.5', fast: false, clips: false,
		prices: { '720p': 0.12, '1080p': 0.17, '2k': 0.25, '4k': 0.39 },
		audio: { longest: 10, prices: { '720p': 0.12, '1080p': 0.17, '2k': 0.25, '4k': 0.39 } }
	},
	{
		id: 'ltx-2-3-fast', generation: '2.3', fast: true, clips: false,
		prices: { '720p': 0.03, '1080p': 0.06, '2k': 0.12, '4k': 0.24 }
	},
	{
		id: 'ltx-2-3-pro', generation: '2.3', fast: false, clips: true,
		prices: { '720p': 0.04, '1080p': 0.08, '2k': 0.16, '4k': 0.32 },
		audio: { longest: 20, prices: { '720p': 0.06, '1080p': 0.10, '2k': 0.18, '4k': 0.34 } }
	}
]);

/** The day the price list was read; the list states no date of its own. */
const PRICE_DATE = '2026-10-19';
/** Retake and extend on LTX-2.3 Pro, per second billed. */
const CLIP_PRICE = 0.10;

const MIB = 1024 * 1024;
/** "Images are capped at 15 MB" when used in a generation. */
const IMAGE_MAX_BYTES = 15 * MIB;
/** Audio sent by address may be 32 MB. */
const AUDIO_MAX_BYTES = 32 * MIB;
/** Video input "is capped at 32 MB on most endpoints"; extend takes 100 MB. */
const RETAKE_CLIP_MAX_BYTES = 32 * MIB;
const EXTEND_CLIP_MAX_BYTES = 100 * MIB;
/** A data URI of an image may be 7 MB encoded; read as the smaller 7,000,000 characters, a larger one is uploaded. */
const DATA_URI_MAX_LENGTH = 7_000_000;
/** Every request schema: `maxLength: 5000`. */
const PROMPT_MAX_LENGTH = 5000;

const AUTO_DURATION = -1;
/** The shortest duration LTX lists, and the start of an Auto estimate. */
const SHORTEST_DURATION = 6;
/** Retake and extend need 73 frames, "around 3 seconds at 24fps". */
const SHORTEST_CLIP_SECONDS = 3;
/** The longest context of an extension. */
const LONGEST_CONTEXT = 20;
/** AI Video's bound of a retake section, which LTX does not bound. */
const SECTION_BOUND = 3600;
/** At 1440p and 4K, audio to video takes at most 10 seconds of audio on every model. */
const LONGEST_AUDIO_AT_HIGH_RESOLUTIONS = 10;

/** `WIDTHxHEIGHT` by resolution and ratio (models/ltx-2-5, "Resolutions"); LTX-2.3 has 16:9 and 9:16 only. */
const SIZES: Readonly<Record<Resolution, Readonly<Record<string, string>>>> = Object.freeze({
	'720p': { '16:9': '1280x720', '9:16': '720x1280', '1:1': '720x720', '3:2': '1080x720', '2:3': '720x1080' },
	'1080p': { '16:9': '1920x1080', '9:16': '1080x1920', '1:1': '1080x1080', '3:2': '1620x1080', '2:3': '1080x1620' },
	'2k': { '16:9': '2560x1440', '9:16': '1440x2560', '1:1': '1440x1440', '3:2': '2160x1440', '2:3': '1440x2160' },
	'4k': { '16:9': '3840x2160', '9:16': '2160x3840', '1:1': '2160x2160', '3:2': '3240x2160', '2:3': '2160x3240' }
});

function ratiosOf(model: LtxModel): readonly string[] {
	return model.generation === '2.5' ? ['16:9', '9:16', '1:1', '3:2', '2:3'] : ['16:9', '9:16'];
}

// --- declarations -------------------------------------------------------------------------------

const NO_SLOT = Object.freeze({ min: 0, max: 0 });

function declareModes(model: LtxModel): CatalogMode[] {
	const clip = (id: 'edit' | 'extend', videoMaxBytes: number): CatalogMode => ({
		id,
		label: LABELS.modes[id],
		inputs: { startFrame: 'none', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'required' },
		limits: { videoMaxBytes }
	});
	const modes: CatalogMode[] = [{
		id: 'frames',
		label: LABELS.modes.frames,
		inputs: { startFrame: 'optional', endFrame: 'optional', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
		limits: { imageMaxBytes: IMAGE_MAX_BYTES }
	}];
	if (model.audio) {
		modes.push({
			id: 'reference',
			label: LABELS.modes.reference,
			inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 1 }, videos: NO_SLOT, audios: { min: 1, max: 1 }, source: 'none' },
			limits: { imageMaxBytes: IMAGE_MAX_BYTES, audioTotalSeconds: model.audio.longest, audioMaxBytes: AUDIO_MAX_BYTES }
		});
	}
	if (model.clips) {
		modes.push(clip('edit', RETAKE_CLIP_MAX_BYTES), clip('extend', EXTEND_CLIP_MAX_BYTES));
	}
	return modes;
}

function durationTooltip(model: LtxModel): string | undefined {
	if (model.generation === '2.5') {
		return model.fast ? LABELS.durationTooltips.fastAuto : LABELS.durationTooltips.auto;
	}
	return model.fast ? LABELS.durationTooltips.fast : undefined;
}

function declareParameters(model: LtxModel, modes: readonly ModeId[]): CatalogParameter[] {
	// A parameter names its modes only when it does not apply to every mode of the model.
	const within = (wanted: readonly ModeId[]): { readonly modes?: readonly ModeId[] } => {
		const applies = modes.filter(mode => wanted.includes(mode));
		return applies.length === modes.length ? {} : { modes: applies };
	};
	const generated = within(['frames', 'reference']);
	const frames = within(['frames']);
	const tooltip = durationTooltip(model);
	const parameters: CatalogParameter[] = [
		{
			name: 'resolution',
			label: LABELS.resolution,
			kind: 'choice',
			options: RESOLUTIONS.map(value => ({ value, label: LABELS.resolutions[value] })),
			default: '1080p',
			...generated
		},
		{
			name: 'ratio',
			label: LABELS.ratio,
			tooltip: LABELS.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: ratiosOf(model).map(value => ({ value, label: value })),
			default: '16:9',
			...generated
		},
		{
			name: 'duration',
			label: LABELS.duration,
			...(tooltip ? { tooltip } : {}),
			kind: 'integer',
			unit: 'seconds',
			min: SHORTEST_DURATION,
			max: model.fast ? 20 : 10,
			step: 2,
			default: SHORTEST_DURATION,
			...(model.generation === '2.5' ? { auto: { value: AUTO_DURATION, label: LABELS.auto } } : {}),
			...frames
		},
		{
			name: 'fps',
			label: LABELS.fps,
			tooltip: LABELS.fpsTooltip,
			kind: 'choice',
			options: FRAME_RATES.map(value => ({ value, label: `${value} fps` })),
			default: 24,
			advanced: true,
			...generated
		},
		{ name: 'sound', label: LABELS.sound, kind: 'boolean', default: true, ...frames },
		{
			name: 'camera_motion',
			label: LABELS.cameraMotion,
			tooltip: LABELS.cameraMotionTooltip,
			kind: 'choice',
			options: CAMERA_MOTIONS.map(value => ({ value, label: LABELS.cameraMotions[value] })),
			optional: true,
			...generated
		}
	];
	if (model.clips) {
		parameters.push(
			{ name: 'start_time', label: LABELS.startTime, tooltip: LABELS.startTimeTooltip, kind: 'number', unit: 'seconds', min: 0, max: SECTION_BOUND, step: 0.1, default: 0, modes: ['edit'] },
			{ name: 'retake_duration', label: LABELS.retakeDuration, tooltip: LABELS.retakeDurationTooltip, kind: 'number', unit: 'seconds', min: 2, max: SECTION_BOUND, step: 0.1, default: 5, modes: ['edit'] },
			{
				name: 'retake_mode',
				label: LABELS.retakeMode,
				tooltip: LABELS.retakeModeTooltip,
				kind: 'choice',
				options: [
					{ value: 'replace_audio_and_video', label: LABELS.retakeModes.both },
					{ value: 'replace_video', label: LABELS.retakeModes.video },
					{ value: 'replace_audio', label: LABELS.retakeModes.audio }
				],
				default: 'replace_audio_and_video',
				modes: ['edit']
			},
			{ name: 'extend_duration', label: LABELS.extendDuration, tooltip: LABELS.extendDurationTooltip, kind: 'integer', unit: 'seconds', min: 2, max: 20, step: 1, default: 5, modes: ['extend'] },
			{
				name: 'extend_mode',
				label: LABELS.extendMode,
				tooltip: LABELS.extendModeTooltip,
				kind: 'choice',
				options: [{ value: 'end', label: LABELS.extendModes.end }, { value: 'start', label: LABELS.extendModes.start }],
				default: 'end',
				modes: ['extend']
			},
			{ name: 'context', label: LABELS.context, tooltip: LABELS.contextTooltip, kind: 'integer', unit: 'seconds', min: 1, max: LONGEST_CONTEXT, step: 1, optional: true, advanced: true, modes: ['extend'] }
		);
	}
	return parameters;
}

function declareModel(model: LtxModel): CatalogModel {
	const modes = declareModes(model);
	return {
		id: model.id,
		label: LABELS.models[model.id].label,
		description: LABELS.models[model.id].description,
		providerModels: { global: model.id },
		prompt: { required: 'withoutMedia', maxLength: PROMPT_MAX_LENGTH },
		modes,
		parameters: declareParameters(model, modes.map(mode => mode.id)),
		estimate: true
	};
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'ltx',
	label: LABELS.provider,
	regions: [{ id: 'global', label: LABELS.region, baseUrl: 'https://api.ltx.io', currency: 'USD', console: 'https://console.ltx.io' }],
	credentials: [{ id: 'apiKey', label: LABELS.apiKey }],
	models: MODELS.map(declareModel)
});

function modelOf(id: string): LtxModel {
	const model = MODELS.find(entry => entry.id === id);
	if (!model) {
		throw rejected(`LTX has no model "${id}".`);
	}
	return model;
}

function labelOf(model: LtxModel): string {
	return LABELS.models[model.id].label;
}

function modeOf(model: LtxModel, mode: ModeId): CatalogMode | undefined {
	return PROVIDER.models.find(entry => entry.id === model.id)?.modes.find(entry => entry.id === mode);
}

/** The endpoint a generation runs at, chosen by its mode and inputs. */
function endpointOf(mode: ModeId, counts: PlannedCounts): Endpoint {
	switch (mode) {
		case 'reference': return 'audio-to-video';
		case 'edit': return 'retake';
		case 'extend': return 'extend';
		default: return counts.startFrame ? 'image-to-video' : 'text-to-video';
	}
}

const ENDPOINTS: ReadonlySet<string> = new Set<Endpoint>(['text-to-video', 'image-to-video', 'audio-to-video', 'retake', 'extend']);

/** The field each planned input fills at each endpoint. */
const FIELDS: Readonly<Record<Endpoint, Partial<Record<PlannedItem['slot'], string>>>> = Object.freeze({
	'text-to-video': {},
	'image-to-video': { startFrame: 'image_uri', endFrame: 'last_frame_uri' },
	'audio-to-video': { image: 'image_uri', audio: 'audio_uri' },
	'retake': { source: 'video_uri' },
	'extend': { source: 'video_uri' }
});

// --- checks and estimates -----------------------------------------------------------------------

function seconds(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function inSentence(label: string): string {
	return label.charAt(0).toLowerCase() + label.slice(1);
}

function isResolution(value: unknown): value is Resolution {
	return typeof value === 'string' && (RESOLUTIONS as readonly string[]).includes(value);
}

/** The longest audio a model takes at a resolution. */
function longestAudio(model: LtxModel, resolution: Resolution): number {
	const longest = model.audio?.longest ?? 0;
	return resolution === '2k' || resolution === '4k' ? Math.min(longest, LONGEST_AUDIO_AT_HIGH_RESOLUTIONS) : longest;
}

/** The longest video Frames makes at a resolution and frame rate, which also bounds Auto. */
function longestDuration(model: LtxModel, resolution: unknown, fps: unknown): number {
	return model.fast && (resolution === '720p' || resolution === '1080p') && (fps === 24 || fps === 25) ? 20 : 10;
}

/** The rules between parameters and inputs that the declarations cannot express (ltx.md, "Rules between parameters"). */
function ruleProblems(model: LtxModel, request: CheckRequest, counts: PlannedCounts): string[] {
	const problems: string[] = [];
	if (request.mode !== 'frames') {
		return problems;
	}
	const label = labelOf(model);
	const { resolution, fps, duration } = request.params;
	if (counts.startFrame && !request.prompt.trim()) {
		// Image to video requires a prompt; the model declares the looser rule of audio to video.
		problems.push(TEXT.promptForFrame(label));
	}
	if (typeof duration === 'number' && duration > longestDuration(model, resolution, fps)) {
		problems.push(TEXT.longOnlyAtLowRates(label));
	}
	if (duration === AUTO_DURATION && counts.endFrame) {
		problems.push(TEXT.autoWithEndFrame(label));
	}
	return problems;
}

/** The length of the measured clip of Edit or Extend, when it is one AI Video can read. */
function clipSeconds(measured: readonly MeasuredItem[] | undefined): number | undefined {
	const clip = measured?.find(item => item.slot === 'source');
	return clip && (clip.facts.format === 'mp4' || clip.facts.format === 'mov') ? clip.facts.seconds : undefined;
}

/** The rules that need the files: the length of the audio at a resolution, and the clip. */
function fileProblems(model: LtxModel, request: CheckRequest, measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	const label = labelOf(model);
	const resolution = request.params.resolution;
	for (const item of measured) {
		if (item.slot === 'audio' && model.audio && isResolution(resolution) && item.facts.seconds !== undefined) {
			const longest = longestAudio(model, resolution);
			// The model's longest audio is declared; a resolution with a shorter one is checked here.
			if (longest < model.audio.longest && item.facts.seconds > longest + 0.05) {
				problems.push(TEXT.audioTooLong(item.label, seconds(item.facts.seconds), LABELS.resolutions[resolution], label, longest));
			}
		}
		if (item.slot === 'source') {
			const length = clipSeconds([item]);
			if (length === undefined) {
				problems.push(TEXT.clipUnreadable(item.label));
			} else if (length < SHORTEST_CLIP_SECONDS - 0.05) {
				problems.push(TEXT.clipTooShort(item.label, seconds(length)));
			} else if (request.mode === 'edit' && typeof request.params.start_time === 'number' && request.params.start_time >= length) {
				problems.push(TEXT.sectionAfterClip(seconds(request.params.start_time), inSentence(item.label), seconds(length)));
			}
		}
	}
	return problems;
}

function priced(min: number, max: number): Estimate {
	return estimateOf('USD', min, max, PRICE_DATE);
}

/** The price per second × the seconds LTX bills (ltx.md, "Estimate"); a range where LTX measures the length after the run. */
function estimateFor(model: LtxModel, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): Estimate | undefined {
	const { params } = request;
	const resolution = isResolution(params.resolution) ? params.resolution : undefined;
	switch (endpointOf(request.mode, counts)) {
		case 'text-to-video':
		case 'image-to-video': {
			// The generated video is billed.
			const price = resolution ? model.prices[resolution] : undefined;
			if (price === undefined || typeof params.duration !== 'number') {
				return undefined;
			}
			return params.duration === AUTO_DURATION
				? priced(SHORTEST_DURATION * price, longestDuration(model, resolution, params.fps) * price)
				: priced(params.duration * price, params.duration * price);
		}
		case 'audio-to-video': {
			// The input audio is billed.
			if (!resolution || !model.audio) {
				return undefined;
			}
			const price = model.audio.prices[resolution];
			const audio = measured?.find(item => item.slot === 'audio')?.facts.seconds;
			return audio !== undefined ? priced(audio * price, audio * price) : priced(0, longestAudio(model, resolution) * price);
		}
		case 'retake': {
			// The whole input clip is billed; LTX states no longest clip, so without its file there is no estimate.
			const clip = clipSeconds(measured);
			return clip !== undefined ? priced(clip * CLIP_PRICE, clip * CLIP_PRICE) : undefined;
		}
		case 'extend': {
			// The extension and the context LTX uses, at most 505 frames together, are billed.
			const extension = params.extend_duration;
			if (typeof extension !== 'number') {
				return undefined;
			}
			const clip = clipSeconds(measured);
			if (typeof params.context === 'number') {
				const context = clip !== undefined ? Math.min(params.context, clip) : params.context;
				return clip !== undefined
					? priced((extension + context) * CLIP_PRICE, (extension + context) * CLIP_PRICE)
					: priced(extension * CLIP_PRICE, (extension + context) * CLIP_PRICE);
			}
			return priced(extension * CLIP_PRICE, (extension + Math.min(LONGEST_CONTEXT, clip ?? LONGEST_CONTEXT)) * CLIP_PRICE);
		}
	}
}

// --- inputs -------------------------------------------------------------------------------------

const ACCEPTED: Readonly<Record<MediaKind, ReadonlySet<MediaFormat>>> = Object.freeze({
	image: new Set<MediaFormat>(['png', 'jpeg', 'webp']),
	video: new Set<MediaFormat>(['mp4', 'mov']),
	audio: new Set<MediaFormat>(['wav', 'mp3', 'm4a'])
});

/** An input read whole, with the format its header shows. */
interface Prepared {
	readonly item: PlannedItem;
	readonly field: string;
	readonly kind: MediaKind;
	readonly read: ReadMedia;
	readonly mimeType: string;
}

function kindOf(item: PlannedItem): MediaKind {
	return item.slot === 'source' || item.slot === 'video' ? 'video' : item.slot === 'audio' ? 'audio' : 'image';
}

function maxBytesOf(kind: MediaKind, limits: ModeLimits): number {
	switch (kind) {
		case 'image': return limits.imageMaxBytes ?? IMAGE_MAX_BYTES;
		case 'video': return limits.videoMaxBytes ?? RETAKE_CLIP_MAX_BYTES;
		case 'audio': return limits.audioMaxBytes ?? AUDIO_MAX_BYTES;
	}
}

/** WAVE_FORMAT_PCM and WAVE_FORMAT_IEEE_FLOAT: uncompressed audio, which LTX does not take. */
const PCM_FORMATS: ReadonlySet<number> = new Set([0x0001, 0x0003]);

/** The audio format a WAV's `fmt ` chunk names, through WAVE_FORMAT_EXTENSIBLE to its subformat. */
function wavFormat(bytes: Buffer): number | undefined {
	if (bytes.byteLength < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') {
		return undefined;
	}
	let offset = 12;
	for (let chunks = 0; chunks < 4096 && offset + 10 <= bytes.byteLength; chunks++) {
		const size = bytes.readUInt32LE(offset + 4);
		if (bytes.toString('latin1', offset, offset + 4) === 'fmt ') {
			const tag = bytes.readUInt16LE(offset + 8);
			// The subformat GUID starts 24 bytes into an extensible format; its first two bytes are the format.
			return tag === 0xfffe && size >= 40 && offset + 8 + 26 <= bytes.byteLength ? bytes.readUInt16LE(offset + 8 + 24) : tag;
		}
		offset += 8 + size + (size & 1);
	}
	return undefined;
}

/** Reads an input whole and checks what LTX takes, before anything is sent. */
async function prepare(item: PlannedItem, field: string, limits: ModeLimits): Promise<Prepared> {
	const kind = kindOf(item);
	const read = await readMedia(item.media, maxBytesOf(kind, limits), item.label);
	const { format } = await measure(bufferSource(read.bytes));
	if (!format || !ACCEPTED[kind].has(format)) {
		throw rejected(TEXT.wrongFormat[kind](item.label));
	}
	if (format === 'wav') {
		const audioFormat = wavFormat(read.bytes);
		if (audioFormat !== undefined && PCM_FORMATS.has(audioFormat)) {
			throw rejected(TEXT.pcm(item.label));
		}
	}
	return { item, field, kind, read, mimeType: MEDIA_MIME_TYPES[format] };
}

// --- the upload ---------------------------------------------------------------------------------

const UPLOAD_PATH = '/v1/upload';
/** Statuses of the storage that answer a refusal instead of failing as the API's would. */
const STORAGE_REFUSALS: readonly number[] = Object.freeze([400, 401, 403, 404, 409, 411, 412, 413]);
/** The storage refuses to overwrite: the upload's own earlier copy is there (`x-goog-if-generation-match: 0`). */
const ALREADY_THERE = 412;
/** Headers AI Video sets itself, never taken from `required_headers`. */
const OWN_HEADERS: ReadonlySet<string> = new Set(['content-length', 'host', 'connection', 'transfer-encoding']);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/;
const HEADER_VALUE = /^[\t\x20-\x7e]{0,8192}$/;

interface UploadTicket {
	readonly uploadUrl: string;
	readonly storageUri: string;
	readonly headers: Readonly<Record<string, string>>;
}

function ticketOf(answer: Record<string, unknown>): UploadTicket {
	const uploadUrl = typeof answer.upload_url === 'string' ? answer.upload_url.trim() : '';
	const storageUri = typeof answer.storage_uri === 'string' ? answer.storage_uri.trim() : '';
	if (!uploadUrl || !storageUri || storageUri.length > 2048 || /\s/.test(storageUri)) {
		throw unreadable(TEXT.uploadUnreadable);
	}
	const headers: Record<string, string> = {};
	const required = answer.required_headers ?? {};
	if (!isRecord(required)) {
		throw unreadable(TEXT.uploadUnreadable);
	}
	for (const [name, value] of Object.entries(required)) {
		if (typeof value !== 'string' || !HEADER_NAME.test(name) || !HEADER_VALUE.test(value)) {
			throw unreadable(TEXT.uploadUnreadable);
		}
		if (!OWN_HEADERS.has(name.toLowerCase())) {
			headers[name] = value;
		}
	}
	return { uploadUrl, storageUri, headers };
}

/** An upload failure, which made no job, naming the input. */
function uploadFailure(error: unknown, label: string): unknown {
	if (error instanceof ProviderFailure) {
		return new ProviderFailure(error.code === 'invalidResponse' ? 'rejected' : error.code, TEXT.uploadFailed(inSentence(label), error.message), error.status);
	}
	return error;
}

/** The `<Code>` and `<Message>` of a storage error answer, which is XML. */
function storageError(body: Buffer): { readonly code?: string; readonly message?: string } {
	const text = body.toString('utf8');
	const code = /<Code>([^<]{1,100})<\/Code>/.exec(text)?.[1];
	const message = /<Message>([^<]{1,500})<\/Message>/.exec(text)?.[1];
	return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/** Uploads an input through LTX's signed address and answers its `ltx://` address. */
async function upload(http: ProviderHttp, entry: Prepared): Promise<string> {
	let ticket: UploadTicket;
	try {
		ticket = ticketOf((await http.request({ method: 'POST', path: UPLOAD_PATH })).object());
	} catch (error) {
		throw uploadFailure(error, entry.item.label);
	}
	let answer: HttpAnswer;
	try {
		// The headers LTX asks for, unchanged, after the file's type, as LTX's example sends them; the key stays on LTX's origin.
		answer = await http.request({
			method: 'PUT',
			url: ticket.uploadUrl,
			headers: { 'Content-Type': entry.mimeType, ...ticket.headers },
			body: { kind: 'bytes', bytes: entry.read.bytes, contentType: entry.mimeType },
			accept: STORAGE_REFUSALS
		});
	} catch (error) {
		throw uploadFailure(error, entry.item.label);
	}
	if ((answer.status >= 200 && answer.status < 300) || answer.status === ALREADY_THERE) {
		return ticket.storageUri;
	}
	const refusal = storageError(answer.body);
	throw rejected(TEXT.storageRefused(inSentence(entry.item.label), answer.status, refusal.code, refusal.message), answer.status);
}

/** An input as LTX takes it: an image inline while its data URI is small, anything else through the upload. */
async function deliver(http: ProviderHttp, entry: Prepared): Promise<string> {
	if (entry.kind === 'image' && `data:${entry.mimeType};base64,`.length + base64Length(entry.read.bytes.byteLength) <= DATA_URI_MAX_LENGTH) {
		return dataUrlOf(entry.read, entry.mimeType);
	}
	return upload(http, entry);
}

// --- requests -----------------------------------------------------------------------------------

function sizeOf(params: Params): string {
	const size = isResolution(params.resolution) ? SIZES[params.resolution][String(params.ratio)] : undefined;
	if (!size) {
		throw rejected(TEXT.noSize(String(params.resolution), String(params.ratio)));
	}
	return size;
}

/** The body of the request that creates the job (ltx.md, "Requests"). */
function requestBody(endpoint: Endpoint, sentModel: string, request: SubmitRequest, inputs: Readonly<Record<string, string>>): Record<string, unknown> {
	const { params } = request;
	const prompt = request.prompt.trim() ? { prompt: request.prompt } : {};
	const camera = typeof params.camera_motion === 'string' ? { camera_motion: params.camera_motion } : {};
	switch (endpoint) {
		case 'text-to-video':
		case 'image-to-video':
			return {
				...inputs,
				// Both require a prompt; check makes sure there is one.
				prompt: request.prompt,
				model: sentModel,
				duration: params.duration === AUTO_DURATION ? null : params.duration,
				resolution: sizeOf(params),
				fps: params.fps,
				generate_audio: params.sound,
				...camera
			};
		case 'audio-to-video':
			return { ...inputs, ...prompt, model: sentModel, resolution: sizeOf(params), fps: params.fps, ...camera };
		case 'retake':
			return { ...inputs, start_time: params.start_time, duration: params.retake_duration, mode: params.retake_mode, ...prompt, model: sentModel };
		case 'extend':
			return {
				...inputs,
				duration: params.extend_duration,
				mode: params.extend_mode,
				...(typeof params.context === 'number' ? { context: params.context } : {}),
				...prompt,
				model: sentModel
			};
	}
}

function jobIdOf(answer: HttpAnswer): string {
	const id = answer.object().id;
	if (typeof id !== 'string' || !id.trim()) {
		throw unknownOutcome(TEXT.noJobId);
	}
	return id.trim();
}

/** The endpoint and the job id a task id names. */
function jobOf(remoteId: string): { readonly endpoint: Endpoint; readonly id: string } {
	const slash = remoteId.indexOf('/');
	const endpoint = slash > 0 ? remoteId.slice(0, slash) : '';
	const id = slash > 0 ? remoteId.slice(slash + 1) : '';
	if (!ENDPOINTS.has(endpoint) || !id) {
		throw rejected(TEXT.notLtxTask(remoteId));
	}
	return { endpoint: endpoint as Endpoint, id };
}

/** The job as `GET /v2/<endpoint>/<id>` gives it. */
async function askAbout(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	const job = jobOf(ref.remoteId);
	return (await http.request({ method: 'GET', path: `/v2/${job.endpoint}/${encodeURIComponent(job.id)}` })).object();
}

function videoUrlOf(job: Record<string, unknown>): string | undefined {
	const url = isRecord(job.result) ? job.result.video_url : undefined;
	return typeof url === 'string' && url.trim() ? url.trim() : undefined;
}

// --- errors -------------------------------------------------------------------------------------

/**
 * LTX's error types (errors, rate-limits) with what they mean. A type without
 * a contract code is read by its HTTP status: `not_found_error` refuses a
 * create or names an unknown job, LTX's own errors leave a create's outcome
 * unknown. `permission_error` (403) is a refusal, not wrong credentials.
 */
const ERROR_TYPES: ReadonlyMap<string, { readonly code?: ProviderErrorCode; readonly text: string }> = new Map([
	['invalid_request_error', { code: 'rejected', text: 'LTX refused the request as invalid.' }],
	['authentication_error', { code: 'auth', text: 'LTX refused the API key. Check it in Video Providers.' }],
	['insufficient_funds_error', { code: 'balance', text: 'The LTX account has too few credits. Buy credits in the LTX console.' }],
	['permission_error', { code: 'rejected', text: 'LTX does not offer this to the account.' }],
	['content_filtered_error', { code: 'rejected', text: 'LTX\'s safety filters refused the prompt or an input.' }],
	['rate_limit_error', { code: 'rateLimited', text: 'LTX\'s job queue for the organization is full. Wait for a generation to finish.' }],
	['concurrency_limit_error', { code: 'rateLimited', text: 'LTX is running as many generations at once as the organization may (2 by default). Wait for one to finish.' }],
	['api_error', { text: 'LTX had an internal error.' }],
	['service_unavailable_error', { text: 'LTX is unavailable for a while.' }],
	['overloaded_error', { text: 'LTX is overloaded for a while.' }]
]);

function textOf(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** LTX's `{type, message}`, of an error answer or a failed job, as a sentence with LTX's words. */
function errorText(type: string, said: string): string {
	const known = ERROR_TYPES.get(type);
	if (known) {
		return `${known.text} (${said ? `${type}: ${said}` : type})`;
	}
	if (said) {
		return type ? `LTX: ${said} (${type})` : `LTX: ${said}`;
	}
	return type ? `LTX answered with the error ${type}.` : TEXT.failed;
}

function stateOf(job: Record<string, unknown>): PollState {
	switch (job.status) {
		case 'pending':
			return { state: 'pending' };
		case 'processing':
			return { state: 'running' };
		case 'completed': {
			const videoUrl = videoUrlOf(job);
			if (!videoUrl) {
				throw unreadable(TEXT.noVideo);
			}
			return { state: 'succeeded', videoUrl };
		}
		case 'failed': {
			const error = isRecord(job.error) ? job.error : {};
			return { state: 'failed', message: errorText(textOf(error.type), textOf(error.message)) };
		}
		default:
			throw unreadable(TEXT.unknownStatus(String(job.status ?? '').slice(0, 40)));
	}
}

// --- the module ---------------------------------------------------------------------------------

export const LTX: ProviderModule = {
	describe() {
		return PROVIDER;
	},

	headers(credentials) {
		return { Authorization: `Bearer ${credentials.apiKey}` };
	},

	readError(_status, body): ProviderErrorReading | undefined {
		if (!isRecord(body) || !isRecord(body.error)) {
			return readCommonError(body);
		}
		const type = textOf(body.error.type);
		const said = textOf(body.error.message);
		if (!type && !said) {
			return readCommonError(body);
		}
		const code = ERROR_TYPES.get(type)?.code;
		return { message: errorText(type, said), ...(code ? { code } : {}) };
	},

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const model = modelOf(request.model);
		const counts = countsOf(request.inputs);
		const measured = isPlannedMedia(request.inputs) ? await measureItems(request.inputs, media) : undefined;
		const problems = [...ruleProblems(model, request, counts), ...(measured ? fileProblems(model, request, measured) : [])];
		const estimate = estimateFor(model, request, counts, measured);
		return estimate ? { problems, estimate } : { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const model = modelOf(request.model);
		const label = labelOf(model);
		const sentModel = PROVIDER.models.find(entry => entry.id === model.id)?.providerModels[request.region];
		if (!sentModel) {
			throw rejected(TEXT.notOffered(label));
		}
		const mode = modeOf(model, request.mode);
		if (!mode) {
			throw rejected(TEXT.noMode(label, request.mode));
		}
		const endpoint = endpointOf(request.mode, countsOf(request.inputs));
		const items = plannedItems(request.inputs);
		// An input the endpoint does not take is refused before any file is read.
		const fields = items.map(item => {
			const field = FIELDS[endpoint][item.slot];
			if (!field) {
				throw rejected(TEXT.notTaken(item.label, label, mode.label));
			}
			return field;
		});
		// Every input is read and checked before the first upload.
		const prepared: Prepared[] = [];
		for (const [index, item] of items.entries()) {
			prepared.push(await prepare(item, fields[index], mode.limits));
		}
		const inputs: Record<string, string> = {};
		for (const entry of prepared) {
			inputs[entry.field] = await deliver(http, entry);
		}
		const answer = await http.create({ method: 'POST', path: `/v2/${endpoint}`, body: { kind: 'json', value: requestBody(endpoint, sentModel, request, inputs) } });
		return `${endpoint}/${jobIdOf(answer)}`;
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return stateOf(await askAbout(ref, http));
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const job = await askAbout(ref, http);
		const url = job.status === 'completed' ? videoUrlOf(job) : undefined;
		if (!url) {
			throw unreadable(TEXT.noVideoYet);
		}
		return { url };
	},

	async cancel(): Promise<boolean> {
		// LTX has no cancellation; nothing is sent.
		return false;
	}
};

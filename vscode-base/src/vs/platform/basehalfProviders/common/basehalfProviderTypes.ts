/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The model catalog and the requests and answers of the provider service
 * (D59, D64, D75, providers and the model catalog): their one definition. The
 * window uses these types under its own names, which
 * `src/vs/workbench/basehalf/video/common/basehalfVideoCatalog.ts` gives them.
 */

import type { VSBuffer } from '../../../base/common/buffer.js';

// --- The catalog ------------------------------------------------------------------------------

/** How a mode uses the node's inputs (video providers, "Modes and inputs"). `lyrics`: the prompt is what a song sings (D78). */
export type ModeId = 'frames' | 'reference' | 'extend' | 'edit' | 'lyrics';

export type SlotUse = 'none' | 'optional' | 'required';

/** What a model makes (D64, D78). */
export type ModelKind = 'image' | 'video' | 'audio';

/** What an audio model makes (D78): a voice that says the prompt, a song or an instrumental, or sound effects. */
export type AudioMakes = 'speech' | 'music' | 'sound';

export interface Catalog {
	/** Changes when the shape of the catalog changes. */
	readonly schema: 1;
	readonly providers: readonly CatalogProvider[];
}

export interface CatalogRegion {
	readonly id: string;
	readonly label: string;
	readonly baseUrl: string;
	/** Where the user gets credentials for this region. */
	readonly console?: string;
}

/** One value the provider needs to accept a request. Every value is a secret. */
export interface CatalogCredential {
	readonly id: string;
	readonly label: string;
	readonly placeholder?: string;
}

export interface CatalogProvider {
	/** Stable; what a node stores. */
	readonly id: string;
	readonly label: string;
	/** At least one. The first is the default. */
	readonly regions: readonly CatalogRegion[];
	/** At least one, in order. */
	readonly credentials: readonly CatalogCredential[];
	readonly models: readonly CatalogModel[];
}

export interface CatalogModel {
	/** Stable within its provider; what a node stores. */
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** For each region that offers the model, the id sent to the provider there. */
	readonly providerModels: Readonly<Record<string, string>>;
	readonly prompt: PromptRule;
	/** At least one. The first is the default. */
	readonly modes: readonly CatalogMode[];
	readonly parameters: readonly CatalogParameter[];
	/** Listed only for cards that already use it. */
	readonly deprecated?: boolean;
	/** What the model makes. */
	readonly kind: ModelKind;
	/** For an audio model: what it makes (D78). */
	readonly makes?: AudioMakes;
	/** For an image or an audio model: the format its module asks the provider for, which a draft's extension follows. */
	readonly outputFormat?: ImageFormat | AudioFormat;
	/** The provider answers the request with the files instead of a task (providers, "Requests"). */
	readonly answersAtOnce?: boolean;
	/** The regions that retire the model when not all of them do; it is deprecated only there. */
	readonly deprecatedIn?: readonly string[];
}

export interface PromptRule {
	/** `withoutMedia`: required when the mode sends no image and no video. */
	readonly required: 'always' | 'withoutMedia' | 'never';
	/** Characters of the prompt as sent, text inputs included. */
	readonly maxLength: number;
}

export interface CountSlot {
	readonly min: number;
	readonly max: number;
}

export interface ModeInputs {
	readonly startFrame: SlotUse;
	readonly endFrame: SlotUse;
	/** Reference images. */
	readonly images: CountSlot;
	readonly videos: CountSlot;
	readonly audios: CountSlot;
	/** The clip of `extend` and `edit`. */
	readonly source: 'none' | 'required';
}

/** An image format a provider takes. */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** The format an audio model delivers (D78, providers, "Audio format"). */
export type AudioFormat = 'mp3' | 'wav';

/** Checked by `check` before anything is sent. Any may be absent. */
export interface ModeLimits {
	/** The image formats the provider takes, PNG among them; all three when absent. The window draws any other image to PNG. */
	readonly imageFormats?: readonly ImageFormat[];
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

export interface CatalogMode {
	readonly id: ModeId;
	readonly label: string;
	readonly inputs: ModeInputs;
	readonly limits: ModeLimits;
	/** The regions that offer the mode, when not every region that offers the model does. */
	readonly regions?: readonly string[];
}

export type ParamValue = string | number | boolean;
export type Params = Readonly<Record<string, ParamValue>>;

interface ParameterBase {
	/** The key in the node's `params`. */
	readonly name: string;
	readonly label: string;
	readonly tooltip?: string;
	/** The modes the parameter applies to; all when absent. */
	readonly modes?: readonly ModeId[];
	/** Shown under More. */
	readonly advanced?: boolean;
	/** May be left unset; nothing is sent then. A parameter that is not optional has a default. */
	readonly optional?: boolean;
	/** A start frame decides it: with a start frame, nothing is sent or recorded for it. */
	readonly setByStartFrame?: boolean;
}

export interface ChoiceParameter extends ParameterBase {
	readonly kind: 'choice';
	readonly options: readonly { readonly value: string | number; readonly label: string }[];
	readonly default?: string | number;
	/** `ratio` draws each value as a small ratio shape. */
	readonly display?: 'ratio';
}

export interface NumberParameter extends ParameterBase {
	readonly kind: 'integer' | 'number';
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly default?: number;
	readonly unit?: 'seconds';
	/** A value outside the range that lets the provider decide, such as -1 for Auto. */
	readonly auto?: { readonly value: number; readonly label: string };
}

export interface BooleanParameter extends ParameterBase {
	readonly kind: 'boolean';
	readonly default?: boolean;
}

export interface TextParameter extends ParameterBase {
	readonly kind: 'text';
	readonly default?: string;
	readonly maxLength: number;
	readonly multiline?: boolean;
}

/** A voice the catalog declares for a speech model (D78, providers, "Voices"). */
export interface CatalogVoiceOption {
	/** The provider's voice id: what the card stores and sends. */
	readonly value: string;
	readonly label: string;
	/** A few words from the provider's labels, such as its gender, accent, or style. */
	readonly description?: string;
}

/**
 * The voice of a speech model (D78). Its options are the voices every account
 * of the provider has, at least the default; `listed` says that the
 * provider also lists voices through the `voices` call: its own and the
 * account's. A value that is not an option is accepted for a listed
 * parameter when it is at most 256 characters without control characters.
 */
export interface VoiceParameter extends ParameterBase {
	readonly kind: 'voice';
	readonly options: readonly CatalogVoiceOption[];
	readonly default: string;
	readonly listed?: boolean;
}

export type CatalogParameter =
	| ChoiceParameter
	| NumberParameter
	| BooleanParameter
	| TextParameter
	| VoiceParameter;

// --- The provider commands ---------------------------------------------------------------------

/** Where a request goes and with what: the provider, its region, the endpoint in use, and the credential values by id. */
export interface ProviderAccess {
	readonly provider: string;
	readonly region: string;
	/** The region's base URL, or the one the user entered. */
	readonly endpoint: string;
	readonly credentials: Readonly<Record<string, string>>;
}

/** A file of the workspace, or an image the window drew (an SVG made a PNG). */
export type Media =
	| { readonly fsPath: string; readonly mimeType: string }
	| { readonly dataUrl: string };

/** The planned inputs of a generation, by the slots of its mode. */
export interface PlannedMedia {
	readonly startFrame?: Media;
	readonly endFrame?: Media;
	readonly images: readonly Media[];
	readonly videos: readonly Media[];
	readonly audios: readonly Media[];
	readonly source?: Media;
}

/** Where an input is in a request: a frame, the clip, or the n-th reference image, video, or sound (D74). */
export type PromptInputSlot = 'startFrame' | 'endFrame' | 'source' | 'images' | 'videos' | 'audios';

/** A mention in the prompt as the window sends it: the place in the request of the input it names (providers, "Names in the prompt"). */
export interface PromptInput {
	readonly input: PromptInputSlot;
	/** From 0, among `images`, `videos`, or `audios`; absent for a frame and the clip. */
	readonly index?: number;
}

/** A part of the prompt as the window sends it: text, or a mention of a planned input, which the provider module names. */
export type PromptPart = string | PromptInput;

/**
 * A check as a provider module receives it: the prompt written, its mentions
 * named as the model reads them (D74). The window sends it as a
 * {@link CheckPayload}.
 */
export interface CheckRequest {
	readonly provider: string;
	readonly region: string;
	readonly model: string;
	readonly mode: ModeId;
	/** Every parameter that applies, with its value or default; optional ones only when set. */
	readonly params: Params;
	/** The prompt as it would be sent, text inputs included. */
	readonly prompt: string;
	/** The files a generation would send; the module measures them. */
	readonly inputs: PlannedMedia;
}

/** A check as the window sends it: the prompt in parts, text inputs included. The window's `IBaseHalfVideoCheckRequest` is this shape. */
export interface CheckPayload extends Omit<CheckRequest, 'prompt'> {
	readonly prompt: readonly PromptPart[];
}

export interface CheckResult {
	/** Plain sentences, the first being what blocks the generation. Empty when it can run. */
	readonly problems: readonly string[];
	/** The prompt as the provider module writes it: what is checked and sent (D74). */
	readonly prompt: string;
	/** The id the request would be sent with, for a model whose modes and inputs choose among several. */
	readonly providerModel?: string;
	/**
	 * The ranges of number parameters that the planned inputs or the mode
	 * narrow, by parameter name (D70; providers, "Requests"). A value beyond one
	 * is fitted to it before the rules are checked, so it is no problem.
	 */
	readonly limits?: Readonly<Record<string, CheckLimit>>;
}

/** How far a number parameter goes for the planned inputs or the mode, where that is narrower than its declaration. */
export interface CheckLimit {
	readonly min?: number;
	readonly max?: number;
	/** Why, in one plain sentence, such as "With a reference video, Wan 2.7 makes at most 10 seconds." */
	readonly reason: string;
}

/** A request as a provider module receives it: the prompt written as the model reads it (D74). The window sends it as a {@link SubmitPayload}. */
export interface SubmitRequest extends ProviderAccess {
	readonly model: string;
	readonly mode: ModeId;
	readonly params: Params;
	readonly prompt: string;
	readonly inputs: PlannedMedia;
	/**
	 * One new file per output the request may make, each ending in `.part`,
	 * under `.bh/cache/generation/`. An output the provider answers inline is
	 * written there under the checks of a download.
	 */
	readonly targets?: readonly string[];
}

/** A request as the window sends it: the prompt in parts. The window's `IBaseHalfVideoSubmitRequest` is this shape. */
export interface SubmitPayload extends Omit<SubmitRequest, 'prompt'> {
	readonly prompt: readonly PromptPart[];
}

/** The format of a file a generation made: the format its bytes start like. */
export type OutputFormat = ImageFormat | 'mp4' | AudioOutputFormat;

/** The formats a sound is kept in (providers, "Requests"): an MP3, a WAV, a FLAC, an Ogg, or an M4A. */
export type AudioOutputFormat = AudioFormat | 'flac' | 'ogg' | 'm4a';

/** One file of a generation: an address to download, a target already written, or why the provider refused it alone. */
export type Output =
	| { readonly url: string }
	| { readonly written: string; readonly size: number; readonly format: OutputFormat }
	| { readonly refused: string };

/** A task to poll, or the outputs of a provider that answers at once. */
export type SubmitResult =
	| { readonly remoteId: string }
	| { readonly outputs: readonly Output[] };

export interface TaskRef extends ProviderAccess {
	readonly model: string;
	readonly remoteId: string;
	/** As in {@link SubmitRequest.targets}, for a poll whose answer holds the files themselves. */
	readonly targets?: readonly string[];
}

export type PollState =
	| { readonly state: 'pending' | 'running'; readonly fraction?: number }
	| { readonly state: 'succeeded'; readonly videoUrl?: string; readonly outputs?: readonly Output[] }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

export interface DownloadRequest extends TaskRef {
	/** From the poll; without it, the provider module knows where the video is. */
	readonly videoUrl?: string;
	/** An output's address from the poll or the submit, for an image. */
	readonly url?: string;
	/** What is downloaded; `video` when absent. */
	readonly kind?: ModelKind;
	/** A new file whose name ends in `.part`. */
	readonly targetFsPath: string;
}

export interface DownloadResult {
	readonly size: number;
	/** The format the bytes start like. */
	readonly format?: OutputFormat;
}

export interface CancelResult {
	readonly cancelled: boolean;
}

/** Asks for the voices of a speech model's provider and of the user's account (D78, providers, "Voices"). */
export interface VoicesRequest extends ProviderAccess {
	/** A model whose `voice` parameter is listed. */
	readonly model: string;
}

/** A voice the provider lists. */
export interface ListedVoice {
	/** The provider's voice id. */
	readonly id: string;
	/** The name the provider gives it. */
	readonly label: string;
	/** A few words from the provider's labels, such as its gender, age, accent, language, or style. */
	readonly description?: string;
	/** A voice of the account (cloned, designed, or saved), not one of the provider's own. */
	readonly own: boolean;
	/** The address of a short recording of it, for `voicePreview`. */
	readonly sample?: string;
}

export interface VoicesResult {
	/** At most 2,000, the account's own first. */
	readonly voices: readonly ListedVoice[];
	/** The provider listed more voices than were kept. */
	readonly truncated?: boolean;
}

/** Fetches the sample of a listed voice for the window to play (D78). */
export interface VoicePreviewRequest extends ProviderAccess {
	readonly model: string;
	/** The `sample` address of a listed voice. */
	readonly sample: string;
}

export interface VoicePreviewResult {
	/** The sample itself, at most 5 MiB, starting like a sound. */
	readonly bytes: VSBuffer;
	readonly format: AudioOutputFormat;
}

/**
 * A file a generation received, to put into its card's place (generation
 * cards, "Landing"): `from` is a `.part` file directly in a
 * `.bh/cache/generation/` folder, and `to` a name of that workspace folder,
 * outside `.bh/`, that no file has. Both are absolute.
 */
export interface PlaceRequest {
	readonly from: string;
	readonly to: string;
}

export interface PlaceResult {
	readonly placed: true;
}

export type ProviderErrorCode =
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
	| 'notAudio'
	| 'tooLarge'
	| 'unknownProvider'
	/** Putting a file in place: a file already has the name. */
	| 'exists';

export interface ProviderError {
	readonly code: ProviderErrorCode;
	/** Plain text of at most 1,000 characters, without credentials, markup, or request bodies. */
	readonly message: string;
	readonly status?: number;
}

export type ProviderResponse<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: ProviderError };

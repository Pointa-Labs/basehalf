/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The model catalog and the payloads of the provider commands, as the host
 * defines them in `src/vs/workbench/basehalf/video/common/basehalfVideoCatalog.ts`
 * (D59, video providers and the model catalog). The two must stay the same:
 * only the `IBaseHalfVideo`/`BaseHalfVideo` prefixes differ.
 */

// --- The catalog ------------------------------------------------------------------------------

/** How a mode uses the node's inputs (video providers, "Modes and inputs"). */
export type ModeId = 'frames' | 'reference' | 'extend' | 'edit';

export type SlotUse = 'none' | 'optional' | 'required';

/** What a model makes (D64). */
export type ModelKind = 'image' | 'video';

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
	/** What the model makes; `video` when absent. `buildCatalog` always writes it. */
	readonly kind?: ModelKind;
	/** For an image model: the format its module asks the provider for, which a draft's extension follows. */
	readonly outputFormat?: ImageFormat;
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

export type CatalogParameter =
	| ChoiceParameter
	| NumberParameter
	| BooleanParameter
	| TextParameter;

// --- The provider commands ---------------------------------------------------------------------

/** The internal commands of AI Video (video providers, "Requests"). */
export const VIDEO_PROVIDER_COMMANDS = Object.freeze({
	catalog: 'basehalf.video.provider.catalog',
	check: 'basehalf.video.provider.check',
	submit: 'basehalf.video.provider.submit',
	poll: 'basehalf.video.provider.poll',
	download: 'basehalf.video.provider.download',
	cancel: 'basehalf.video.provider.cancel',
	place: 'basehalf.video.provider.place'
});

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

export interface CheckResult {
	/** Plain sentences, the first being what blocks the generation. Empty when it can run. */
	readonly problems: readonly string[];
	/** The id the request would be sent with, for a model whose modes and inputs choose among several. */
	readonly providerModel?: string;
}

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

/** The format of a file a generation made. */
export type OutputFormat = ImageFormat | 'mp4';

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

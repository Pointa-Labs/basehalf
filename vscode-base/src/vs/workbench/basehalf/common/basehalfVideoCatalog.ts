/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The model catalog as the window receives it from the AI Video extension,
 * and the payloads of the provider commands (D59, video providers and the
 * model catalog). The window draws the panel, the settings, the Video
 * Providers page, and the estimate from this catalog; nothing here names a
 * provider or a model. The extension mirrors these types in
 * `extensions/basehalf-ai-video/src/providers/types.ts`; the two must stay
 * the same.
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

/** Checked by `check` before anything is sent. Any may be absent. */
export interface IBaseHalfVideoModeLimits {
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

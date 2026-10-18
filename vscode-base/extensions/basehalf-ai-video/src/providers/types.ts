/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The model catalog and the payloads of the provider commands, as the host
 * defines them in `src/vs/workbench/basehalf/common/basehalfVideoCatalog.ts`
 * (D59, video providers and the model catalog). The two must stay the same:
 * only the `IBaseHalfVideo`/`BaseHalfVideo` prefixes differ.
 */

// --- The catalog ------------------------------------------------------------------------------

export type Currency = 'CNY' | 'USD';

/** How a mode uses the node's inputs (video providers, "Modes and inputs"). */
export type ModeId = 'frames' | 'reference' | 'extend' | 'edit';

export type SlotUse = 'none' | 'optional' | 'required';

export interface Catalog {
	/** Changes when the shape of the catalog changes. */
	readonly schema: 1;
	readonly providers: readonly CatalogProvider[];
}

export interface CatalogRegion {
	readonly id: string;
	readonly label: string;
	readonly baseUrl: string;
	readonly currency: Currency;
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
	/** Whether `check` answers an estimate for this model. */
	readonly estimate: boolean;
	/** Listed only for nodes that already use it. */
	readonly deprecated?: boolean;
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

/** Checked by `check` before anything is sent. Any may be absent. */
export interface ModeLimits {
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
	cancel: 'basehalf.video.provider.cancel'
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

/** The planned inputs counted, for a check without files. */
export interface PlannedCounts {
	readonly startFrame: boolean;
	readonly endFrame: boolean;
	readonly images: number;
	readonly videos: number;
	readonly audios: number;
	readonly source: boolean;
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
	/** With media, the module measures the files; with counts, it checks counts only. */
	readonly inputs: PlannedMedia | PlannedCounts;
}

export interface Estimate {
	readonly currency: Currency;
	readonly min: number;
	/** Equal to `min` for a single amount. */
	readonly max: number;
	/** The date of the provider's price list, `YYYY-MM-DD`. */
	readonly priceDate: string;
}

export interface CheckResult {
	/** Plain sentences, the first being what blocks the generation. Empty when it can run. */
	readonly problems: readonly string[];
	readonly estimate?: Estimate;
}

export interface SubmitRequest extends ProviderAccess {
	readonly model: string;
	readonly mode: ModeId;
	readonly params: Params;
	readonly prompt: string;
	readonly inputs: PlannedMedia;
}

export interface SubmitResult {
	/** The provider's task id. */
	readonly remoteId: string;
}

export interface TaskRef extends ProviderAccess {
	readonly model: string;
	readonly remoteId: string;
}

export type PollState =
	| { readonly state: 'pending' | 'running'; readonly fraction?: number }
	| { readonly state: 'succeeded'; readonly videoUrl?: string }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

export interface DownloadRequest extends TaskRef {
	/** From the poll; without it, the provider module knows where the video is. */
	readonly videoUrl?: string;
	/** A new file whose name ends in `.part`. */
	readonly targetFsPath: string;
}

export interface DownloadResult {
	readonly size: number;
}

export interface CancelResult {
	readonly cancelled: boolean;
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
	| 'tooLarge'
	| 'unknownProvider';

export interface ProviderError {
	readonly code: ProviderErrorCode;
	/** Plain text of at most 1,000 characters, without credentials, markup, or request bodies. */
	readonly message: string;
	readonly status?: number;
}

export type ProviderResponse<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: ProviderError };

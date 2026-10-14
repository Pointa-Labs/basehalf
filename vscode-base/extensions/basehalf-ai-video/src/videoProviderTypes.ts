/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The provider commands between the BaseHalf workbench and AI Video (D58).
 * Copied from `src/vs/workbench/basehalf/common/basehalfVideoProviders.ts`
 * and `basehalfVideoNode.ts` of the host, which an extension cannot import;
 * the two must stay the same. Types only: this module has no runtime code.
 */

export type VideoProviderKind = 'ark' | 'byteplus' | 'dashscope' | 'minimax' | 'gemini' | 'openai';

export type VideoMode = 'frames' | 'reference';

/** A local file the extension reads, or an image the workbench already encoded (a rasterized SVG). */
export type VideoProviderMedia =
	| { readonly fsPath: string; readonly mimeType: string }
	| { readonly dataUrl: string };

export interface VideoProviderEndpoint {
	readonly provider: VideoProviderKind;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
}

export interface VideoProviderRequest extends VideoProviderEndpoint {
	/** The prompt as sent, text inputs included. */
	readonly prompt: string;
	readonly mode: VideoMode;
	/** The effective ratio: `adaptive` lets the provider follow the start frame. */
	readonly ratio: string;
	readonly resolution: string;
	/** Seconds, or -1 for the model's choice. */
	readonly duration: number;
	readonly audio: boolean;
	readonly startFrame?: VideoProviderMedia;
	readonly endFrame?: VideoProviderMedia;
	readonly referenceImages: readonly VideoProviderMedia[];
	readonly referenceVideos: readonly VideoProviderMedia[];
	readonly referenceAudios: readonly VideoProviderMedia[];
}

export interface VideoProviderTaskRef extends VideoProviderEndpoint {
	readonly remoteId: string;
}

export type VideoProviderPollState =
	| { readonly state: 'pending' | 'running'; readonly fraction?: number }
	| { readonly state: 'succeeded'; readonly videoUrl?: string }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

export interface VideoProviderDownloadRequest extends VideoProviderTaskRef {
	/** From the poll; without it the provider's own content endpoint is used. */
	readonly videoUrl?: string;
	/** Where the file is written: a new file whose name ends in `.part`. */
	readonly targetFsPath: string;
}

/**
 * `auth`: the key was refused. `rejected`: the provider refused the request
 * and certainly made no task. `unknownOutcome`: the request may have reached
 * the provider; it is never sent again by itself. `network`: nothing came
 * back. `invalidResponse`: an answer that cannot be read. `notVideo` and
 * `tooLarge`: a download that is not an MP4 or is larger than allowed.
 */
export type VideoProviderErrorCode = 'auth' | 'rejected' | 'rateLimited' | 'unknownOutcome' | 'network' | 'invalidResponse' | 'notFound' | 'notVideo' | 'tooLarge';

export interface VideoProviderError {
	readonly code: VideoProviderErrorCode;
	/** Plain text, without secrets or markup. */
	readonly message: string;
	readonly status?: number;
}

/** Every provider command answers with this; an error never arrives as an exception. */
export type VideoProviderResponse<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: VideoProviderError };

/** The answer to `submit`: the provider's task id. */
export interface VideoProviderSubmitResult {
	readonly remoteId: string;
}

/** The answer to `download`: the bytes written. */
export interface VideoProviderDownloadResult {
	readonly size: number;
}

/** The answer to `cancel`: whether the provider has a cancellation for this task and took it. */
export interface VideoProviderCancelResult {
	readonly cancelled: boolean;
}

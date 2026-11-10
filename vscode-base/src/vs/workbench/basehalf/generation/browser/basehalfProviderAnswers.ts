/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfVideoProviderErrorCode, BaseHalfVideoOutputFormat, IBaseHalfVideoProviderError, IBaseHalfVideoSubmitResult, BaseHalfVideoOutput, IBaseHalfVideoPlaceResult, IBaseHalfVideoDownloadResult, BaseHalfVideoPollState } from '../common/basehalfVideoCatalog.js';
import { localize } from '../../../../nls.js';

// What the provider service answers, read as what was asked for or as an error: an answer is never trusted to have
// the shape it should, and a detail of an error is shown without the credentials it may hold.

const PROVIDER_ERROR_CODES: ReadonlySet<BaseHalfVideoProviderErrorCode> = new Set(['auth', 'rejected', 'rateLimited', 'balance', 'unknownOutcome', 'network', 'invalidResponse', 'notFound', 'notVideo', 'notImage', 'notAudio', 'tooLarge', 'unknownProvider', 'exists']);

/** The formats of a file the provider service received, as it answers them (providers, "Requests"). */
const OUTPUT_FORMATS: ReadonlySet<BaseHalfVideoOutputFormat> = new Set(['png', 'jpeg', 'webp', 'mp4', 'mp3', 'wav', 'flac', 'ogg', 'm4a']);

export type ProviderAnswer<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: IBaseHalfVideoProviderError; /** The provider service did not answer at all. */ readonly unavailable?: boolean };

export function parseProviderAnswer<T>(raw: unknown, parse: (value: unknown) => T | undefined): ProviderAnswer<T> {
	if (isRecord(raw)) {
		if (raw.ok === true) {
			const value = parse(raw.value);
			if (value !== undefined) {
				return { ok: true, value };
			}
		} else if (raw.ok === false && isRecord(raw.error)
			&& PROVIDER_ERROR_CODES.has(raw.error.code as BaseHalfVideoProviderErrorCode)
			&& typeof raw.error.message === 'string') {
			const status = raw.error.status;
			return {
				ok: false,
				error: {
					code: raw.error.code as BaseHalfVideoProviderErrorCode,
					message: raw.error.message,
					...(typeof status === 'number' && Number.isInteger(status) ? { status } : {})
				}
			};
		}
	}
	return { ok: false, error: { code: 'invalidResponse', message: localize('basehalf.video.generation.unreadableAnswer', "The provider service answered in a form BaseHalf cannot read.") } };
}

export function parseSubmitResult(value: unknown): IBaseHalfVideoSubmitResult | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (typeof value.remoteId === 'string') {
		const remoteId = value.remoteId.trim();
		// The task id goes into the task record: one line, as long as the record allows.
		return remoteId && remoteId.length <= 256 && plainDetail(remoteId, []) === remoteId ? { remoteId } : undefined;
	}
	const outputs = parseOutputs(value.outputs);
	return outputs ? { outputs } : undefined;
}

function parseOutputs(value: unknown): readonly BaseHalfVideoOutput[] | undefined {
	if (!Array.isArray(value) || value.length > 16) {
		return undefined;
	}
	const outputs: BaseHalfVideoOutput[] = [];
	for (const output of value) {
		if (!isRecord(output)) {
			return undefined;
		}
		if (typeof output.url === 'string' && output.url) {
			outputs.push({ url: output.url });
		} else if (typeof output.written === 'string' && typeof output.size === 'number' && OUTPUT_FORMATS.has(output.format as BaseHalfVideoOutputFormat)) {
			outputs.push({ written: output.written, size: output.size, format: output.format as BaseHalfVideoOutputFormat });
		} else if (typeof output.refused === 'string') {
			outputs.push({ refused: output.refused });
		} else {
			return undefined;
		}
	}
	return outputs;
}

export function parsePlaceResult(value: unknown): IBaseHalfVideoPlaceResult | undefined {
	return isRecord(value) && value.placed === true ? { placed: true } : undefined;
}

export function parseDownloadResult(value: unknown): IBaseHalfVideoDownloadResult | undefined {
	if (!isRecord(value) || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0) {
		return undefined;
	}
	const format = OUTPUT_FORMATS.has(value.format as BaseHalfVideoOutputFormat) ? value.format as BaseHalfVideoOutputFormat : undefined;
	return { size: value.size, ...(format ? { format } : {}) };
}

export function parsePollState(value: unknown): BaseHalfVideoPollState | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	switch (value.state) {
		case 'pending':
		case 'running': {
			const fraction = typeof value.fraction === 'number' && Number.isFinite(value.fraction) ? Math.min(1, Math.max(0, value.fraction)) : undefined;
			return fraction !== undefined ? { state: value.state, fraction } : { state: value.state };
		}
		case 'succeeded': {
			const outputs = value.outputs === undefined ? undefined : parseOutputs(value.outputs);
			if (value.outputs !== undefined && !outputs) {
				return undefined;
			}
			return {
				state: 'succeeded',
				...(typeof value.videoUrl === 'string' && value.videoUrl ? { videoUrl: value.videoUrl } : {}),
				...(outputs ? { outputs } : {})
			};
		}
		case 'failed':
		case 'cancelled':
			return { state: value.state, message: typeof value.message === 'string' ? value.message : '' };
		default:
			return undefined;
	}
}

export function parseAnything(value: unknown): unknown {
	return value ?? null;
}

export function errorDetail(error: IBaseHalfVideoProviderError, secrets: readonly string[]): string {
	const detail = plainDetail(error.message, secrets);
	if (detail) {
		return detail;
	}
	return error.status !== undefined ? `HTTP ${error.status}` : error.code;
}

/** Plain text of at most 1,000 characters, without line breaks, markup, or a credential value. */
export function plainDetail(message: string, secrets: readonly string[]): string {
	let text = message;
	for (const secret of secrets) {
		if (secret.length >= 4) {
			text = text.split(secret).join('***');
		}
	}
	text = text.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

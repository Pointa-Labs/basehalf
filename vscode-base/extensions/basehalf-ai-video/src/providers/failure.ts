/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderErrorCode } from './types.ts';

/** The longest message an error carries (video providers, "Requests"). */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * A failure with its code of the contract. Provider modules throw it for
 * everything they refuse or cannot read; the commands answer it as
 * `{ok: false, error}`, with its message made plain by {@link plainMessage}.
 */
export class ProviderFailure extends Error {
	readonly code: ProviderErrorCode;
	readonly status: number | undefined;

	constructor(code: ProviderErrorCode, message: string, status?: number) {
		super(message);
		this.name = 'ProviderFailure';
		this.code = code;
		this.status = status;
	}
}

/** The request is refused before anything is sent, or the provider refused it. */
export function rejected(message: string, status?: number): ProviderFailure {
	return new ProviderFailure('rejected', message, status);
}

/** An answer AI Video cannot read. */
export function unreadable(message: string): ProviderFailure {
	return new ProviderFailure('invalidResponse', message);
}

/** A request that may have created a task, whose answer is lost or cannot be read. */
export function unknownOutcome(message: string): ProviderFailure {
	return new ProviderFailure('unknownOutcome', message);
}

/** What a provider's error answer says, as a provider module reads it. */
export interface ProviderErrorReading {
	/** The provider's own words. */
	readonly message?: string;
	/** A code that says more than the HTTP status, such as `balance` for an empty account. */
	readonly code?: ProviderErrorCode;
}

/**
 * The error of an answer whose status is not 2xx. `creates`: the request may
 * have created a task, so an answer that does not say it was refused leaves the
 * outcome unknown.
 */
export function failureForStatus(status: number, reading: ProviderErrorReading | undefined, creates: boolean): ProviderFailure {
	const message = reading?.message?.trim() || `The provider answered with HTTP ${status}.`;
	if (reading?.code) {
		return new ProviderFailure(reading.code, message, status);
	}
	if (status === 401 || status === 403) {
		return new ProviderFailure('auth', message, status);
	}
	if (status === 402) {
		return new ProviderFailure('balance', message, status);
	}
	if (status === 429) {
		return new ProviderFailure('rateLimited', message, status);
	}
	if (status === 404 || status === 410) {
		// For a request that creates a task, the provider refused it (an unknown
		// model, a path the endpoint does not have); otherwise the task is unknown.
		return new ProviderFailure(creates ? 'rejected' : 'notFound', message, status);
	}
	if (status === 408 || status >= 500) {
		// The provider may have made the task before it failed to answer.
		return new ProviderFailure(creates ? 'unknownOutcome' : 'network', message, status);
	}
	if (status >= 300 && status < 400) {
		// API requests never follow a redirect: a request is never sent twice.
		return new ProviderFailure(creates ? 'rejected' : 'invalidResponse', `The provider redirected the request (HTTP ${status}). Check the endpoint in Providers.`, status);
	}
	return new ProviderFailure('rejected', message, status);
}

/** The message of a provider's error answer in the shapes most APIs use. */
export function readCommonError(body: unknown): ProviderErrorReading | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const error = body.error;
	const errors = Array.isArray(body.errors) ? body.errors[0] : undefined;
	const candidates: unknown[] = [
		isRecord(error) ? error.message : undefined,
		isRecord(error) ? error.msg : undefined,
		typeof error === 'string' ? error : undefined,
		body.message,
		body.msg,
		body.error_message,
		isRecord(errors) ? errors.message : undefined,
		typeof body.detail === 'string' ? body.detail : undefined,
		isRecord(error) && typeof error.code === 'string' ? error.code : undefined,
		typeof body.code === 'string' ? body.code : undefined
	];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim()) {
			return { message: candidate };
		}
	}
	return undefined;
}

/**
 * Plain text of at most 1,000 characters: without the secrets (every value of
 * four characters or more is replaced), markup, control characters, inline
 * media, or long encoded runs that could only come from a request body.
 */
export function plainMessage(value: string, secrets: readonly string[]): string {
	let text = value;
	for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
		if (secret.length >= 4) {
			text = text.split(secret).join('***');
		}
	}
	text = text
		.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*/gi, '(data)')
		.replace(/[A-Za-z0-9+/=_-]{120,}/g, '…')
		.replace(/<[^>]*>/g, ' ')
		.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

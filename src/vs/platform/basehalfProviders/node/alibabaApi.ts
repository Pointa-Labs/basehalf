/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { failureForStatus, isRecord, ProviderFailure, type ProviderErrorReading } from './failure.js';
import { retryAfterMs, type HttpAnswer, type ProviderHttp } from './http.js';

/**
 * What every call of the Alibaba module shares (docs/specs/providers/alibaba.md,
 * "Requests"): the paths under the endpoint's `/api/v1`, and DashScope's
 * error answers, read for the video, image, and speech models alike.
 */

/** The video models' limit, which a rate-limited answer names unless the call names its model's own. */
export const RATE_LIMIT_NOTE = 'Alibaba Cloud takes at most 5 requests a second and runs at most 5 tasks at once for each video model.';

/** A path under the endpoint's `/api/v1`, which the endpoint may already end with. */
export function apiPath(http: ProviderHttp, path: string): string {
	return /\/api\/v1$/i.test(http.endpoint.pathname) ? path : `/api/v1${path}`;
}

/** Provider codes that say more than their HTTP status. */
const ERROR_CODES: Readonly<Record<string, ProviderErrorReading['code']>> = Object.freeze({
	'Arrearage': 'balance',
	'PrepaidBillOverdue': 'balance',
	'PostpaidBillOverdue': 'balance',
	'BudgetLimitExceeded': 'balance',
	'AllocationQuota.FreeTierOnly': 'balance',
	'CommodityNotPurchased': 'rejected',
	'DataInspectionFailed': 'rejected',
	'IPInfringementSuspect': 'rejected'
});

/** The pages advise generating again without Prompt Rewriting when the intellectual-property check refuses. */
const PROMPT_REWRITING_ADVICE = 'Prompt Rewriting can cause this: turn it off and generate again.';
/** The shared hosts get no new features after 2026-09-30 (alibaba.md, "Requests"). */
const WORKSPACE_HOST_ADVICE = 'A model released after September 30, 2026 may be offered only on the host of your workspace: enter its API host, from the Model Studio console, as the Endpoint in Providers.';

/**
 * An error answer of DashScope, `{code, message, request_id}`: its message with
 * its code and what the user can do, and the contract's code where the
 * provider's says more. A rate-limited answer adds `rateLimitNote`.
 */
export function readAlibabaError(status: number, body: unknown, rateLimitNote = RATE_LIMIT_NOTE): ProviderErrorReading | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const code = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : undefined;
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	const throttled = status === 429 && (code === undefined || code.startsWith('Throttling'));
	const unknownModel = code === 'ModelNotFound' || (code === 'InvalidParameter' && /model not exist/i.test(message));
	const advice = unknownModel ? WORKSPACE_HOST_ADVICE : code === 'IPInfringementSuspect' ? PROMPT_REWRITING_ADVICE : '';
	const text = [message, code ? `(${code})` : '', throttled ? rateLimitNote : '', advice].filter(Boolean).join(' ');
	const mapped = code && Object.hasOwn(ERROR_CODES, code) ? ERROR_CODES[code] : undefined;
	return text || mapped ? { ...(text ? { message: text } : {}), ...(mapped ? { code: mapped } : {}) } : undefined;
}

/**
 * A refused create that answers at once, read as every error is, with the
 * model's own limit when it is a rate limit, and the wait the provider asks
 * for.
 */
export function refusedCreate(answer: HttpAnswer, rateLimitNote: string): ProviderFailure {
	let body: unknown;
	try {
		body = answer.json();
	} catch {
		body = undefined;
	}
	const failure = failureForStatus(answer.status, readAlibabaError(answer.status, body, rateLimitNote), true);
	const asked = retryAfterMs(answer.headers['retry-after']);
	return failure.code === 'rateLimited' && asked !== undefined && asked > 0
		? new ProviderFailure(failure.code, `${failure.message} The provider asks to wait ${Math.ceil(asked / 1000)} seconds.`, failure.status)
		: failure;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import {
	createNodeVideoHttpClient,
	type VideoExecutionCancellation,
	type VideoHttpClient,
	type VideoHttpResponse
} from './videoProviderExecution';

export const OFFICIAL_VIDEO_PROVIDER_CONNECTION_SPEC_IDS = Object.freeze([
	'pointa.basehalf-ai-video.byteplus-modelark',
	'pointa.basehalf-ai-video.minimax-international',
	'pointa.basehalf-ai-video.wan-international',
	'pointa.basehalf-ai-video.wan-us'
] as const);

const MAXIMUM_VALIDATION_RESPONSE_BYTES = 1024 * 1024;
const VALIDATION_TIMEOUT_MILLISECONDS = 15_000;

/**
 * Runs one read-only provider probe. It never submits a generation task and
 * never copies response text into a user-visible error because provider error
 * bodies are untrusted and may echo credentials.
 */
export async function validateOfficialVideoProviderConnection(
	request: vscode.basehalf.ModelProviderConnectionValidationRequest,
	token: vscode.CancellationToken,
	httpClient: VideoHttpClient = createNodeVideoHttpClient()
): Promise<void> {
	if (!OFFICIAL_VIDEO_PROVIDER_CONNECTION_SPEC_IDS.includes(request.specId as typeof OFFICIAL_VIDEO_PROVIDER_CONNECTION_SPEC_IDS[number])) {
		throw new Error(`Unsupported official video provider connection '${request.specId}'.`);
	}
	const apiKey = request.credentialValues.apiKey;
	if (!apiKey || apiKey.length > 16_384 || /[\r\n]/.test(apiKey)) {
		throw new Error('The API key is missing or invalid.');
	}
	// The Electron smoke owns an explicit process-only validation seam. It is
	// never set by the product launcher or packaged application, and accepts one
	// fixed non-secret marker so CI can exercise the complete encrypted-save and
	// return-to-model flow without a paid third-party account.
	if (process.env.BASEHALF_SMOKE_PROVIDER_VALIDATION === '1'
		&& apiKey === 'basehalf-smoke-not-a-real-provider-key') {
		return;
	}
	const url = validationUrl(request);
	const response = await httpClient({
		method: 'GET',
		url,
		headers: Object.freeze({ Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }),
		maximumResponseBytes: MAXIMUM_VALIDATION_RESPONSE_BYTES,
		maximumRedirects: 0,
		timeoutMilliseconds: VALIDATION_TIMEOUT_MILLISECONDS
	}, cancellationFromToken(token));
	assertAcceptedResponse(request, response);
}

function validationUrl(request: vscode.basehalf.ModelProviderConnectionValidationRequest): string {
	const base = new URL(request.endpoint);
	if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
		throw new Error('The reviewed provider endpoint is invalid.');
	}
	let path: string;
	switch (request.providerId) {
		case 'byteplus':
			path = '/api/v3/contents/generations/tasks?page_num=1&page_size=1';
			break;
		case 'minimax':
			path = '/v1/models';
			break;
		case 'alibaba-cloud':
			path = '/api/v1/deployments/models?page_no=1&page_size=1&version=v1.0&model_source=base';
			break;
		default:
			throw new Error(`Unsupported official video provider '${request.providerId}'.`);
	}
	return new URL(path, `${base.origin}/`).toString();
}

function assertAcceptedResponse(
	request: vscode.basehalf.ModelProviderConnectionValidationRequest,
	response: VideoHttpResponse
): void {
	if (response.status >= 200 && response.status < 300) {
		return;
	}
	if (response.status === 401 || response.status === 403) {
		throw new Error(`${providerName(request.providerId)} rejected this API key. Check that the key belongs to the selected service region.`);
	}
	throw new Error(`Could not verify ${providerName(request.providerId)} right now (HTTP ${response.status}). Your API key was not saved.`);
}

function providerName(providerId: string): string {
	switch (providerId) {
		case 'byteplus': return 'BytePlus';
		case 'minimax': return 'MiniMax';
		case 'alibaba-cloud': return 'Alibaba Cloud Model Studio';
		default: return 'the provider';
	}
}

function cancellationFromToken(token: vscode.CancellationToken): VideoExecutionCancellation {
	return {
		get isCancellationRequested() { return token.isCancellationRequested; },
		onCancellationRequested: listener => token.onCancellationRequested(listener)
	};
}

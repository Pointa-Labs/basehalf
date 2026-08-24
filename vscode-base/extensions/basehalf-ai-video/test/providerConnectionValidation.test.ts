/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import { validateOfficialVideoProviderConnection } from '../src/providerConnectionValidation.ts';
import type { VideoHttpClient, VideoHttpRequest } from '../src/videoProviderExecution.ts';

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => undefined })
} as vscode.CancellationToken;

test('uses read-only official endpoints for BytePlus, MiniMax, and Alibaba Cloud', async () => {
	const requests: VideoHttpRequest[] = [];
	const http: VideoHttpClient = async request => {
		requests.push(request);
		return { status: 200, headers: {}, body: new Uint8Array() };
	};
	await validateOfficialVideoProviderConnection(connection('pointa.basehalf-ai-video.byteplus-modelark', 'byteplus', 'https://ark.ap-southeast.bytepluses.com'), token, http);
	await validateOfficialVideoProviderConnection(connection('pointa.basehalf-ai-video.minimax-international', 'minimax', 'https://api.minimax.io'), token, http);
	await validateOfficialVideoProviderConnection(connection('pointa.basehalf-ai-video.wan-international', 'alibaba-cloud', 'https://dashscope-intl.aliyuncs.com'), token, http);

	assert.deepEqual(requests.map(request => `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`), [
		'GET /api/v3/contents/generations/tasks?page_num=1&page_size=1',
		'GET /v1/models',
		'GET /api/v1/deployments/models?page_no=1&page_size=1&version=v1.0&model_source=base'
	]);
	assert.equal(requests.every(request => request.body === undefined), true);
	assert.equal(requests.every(request => request.headers.Authorization === 'Bearer secret-value'), true);
});

test('rejects an invalid regional credential without exposing the key or response body', async () => {
	const http: VideoHttpClient = async () => ({
		status: 401,
		headers: {},
		body: Buffer.from('{"message":"secret-value rejected"}', 'utf8')
	});
	await assert.rejects(
		() => validateOfficialVideoProviderConnection(connection('pointa.basehalf-ai-video.wan-us', 'alibaba-cloud', 'https://dashscope-us.aliyuncs.com'), token, http),
		error => error instanceof Error
			&& /rejected this API key/.test(error.message)
			&& !error.message.includes('secret-value')
	);
});

function connection(specId: string, providerId: string, endpoint: string): vscode.basehalf.ModelProviderConnectionValidationRequest {
	return {
		specId,
		endpoint,
		providerId,
		deploymentId: providerId === 'alibaba-cloud' ? 'international' : 'global',
		region: providerId === 'alibaba-cloud' ? 'ap-southeast-1' : 'global',
		publicValues: {},
		credentialValues: { apiKey: 'secret-value' }
	};
}

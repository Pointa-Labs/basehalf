/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	VideoProviderCancelledError,
	VideoProviderExecutionFailure,
	createNodeVideoHttpClient,
	executeSerializedVideoProviderRequest,
	type VideoExecutionCancellation,
	type VideoHttpClient,
	type VideoHttpRequest,
	type VideoHttpResponse,
	type VideoProviderExecutionAccess
} from '../src/videoProviderExecution.ts';
import type { SerializedVideoProviderRequest } from '../src/videoProviderAdapters.ts';

const mp4 = Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

test('submits, audits, polls, and downloads BytePlus without forwarding provider credentials to the CDN', async () => {
	const events: string[] = [];
	const http = scriptedHttp([
		json(200, { id: 'seedance-task-1' }),
		json(200, { status: 'running' }),
		json(200, {
			status: 'succeeded',
			content: { video_url: 'https://cdn.example/video.mp4' },
			usage: { completion_tokens: 90 }
		}),
		response(200, mp4)
	], request => events.push(`${request.method} ${new URL(request.url).pathname}`));
	const providerRequestIds: string[] = [];
	const result = await executeSerializedVideoProviderRequest(serialized('byteplus', '/api/v3/contents/generations/tasks'), access('byteplus'), {
		httpClient: http.client,
		cancellation: new MutableCancellation(),
		taskIntent: { kind: 'new' },
		consumeCreateAuthorization: kind => events.push(`authorize ${kind}`),
		acknowledgeProviderRequestId: async id => {
			providerRequestIds.push(id);
			events.push(`audit ${id}`);
		},
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	});

	assert.deepEqual(providerRequestIds, ['seedance-task-1']);
	assert.deepEqual(events, [
		'authorize new',
		'POST /api/v3/contents/generations/tasks',
		'audit seedance-task-1',
		'GET /api/v3/contents/generations/tasks/seedance-task-1',
		'GET /api/v3/contents/generations/tasks/seedance-task-1',
		'GET /video.mp4'
	]);
	assert.deepEqual(result.video, mp4);
	assert.deepEqual(result.usage, { outputTokens: 90 });
	assert.equal(http.requests[0].headers.Authorization, 'Bearer secret');
	assert.equal(http.requests.at(-1)?.headers.Authorization, undefined);
});

test('awaits the host create grant and performs no transport when authorization is rejected', async () => {
	const http = scriptedHttp([]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('byteplus', '/api/v3/contents/generations/tasks'),
		access('byteplus'),
			{
				httpClient: http.client,
				cancellation: new MutableCancellation(),
				taskIntent: { kind: 'new' },
				consumeCreateAuthorization: async () => {
				await Promise.resolve();
				throw new Error('Authorization fingerprint mismatch.');
			},
			acknowledgeProviderRequestId: async () => undefined
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'preparation'
		&& error.evidence.retry === 'fresh-submit');
	assert.equal(http.requests.length, 0);
});

test('rejects an ambiguous raw request and a new request without one-use authorization before transport', async () => {
	const missingIntent = scriptedHttp([]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('byteplus', '/api/v3/contents/generations/tasks'),
		access('byteplus'),
		{
			httpClient: missingIntent.client,
			cancellation: new MutableCancellation(),
			consumeCreateAuthorization: () => undefined,
			acknowledgeProviderRequestId: async () => undefined
		}
	), /explicit provider task intent or a legacy resume id/);
	assert.equal(missingIntent.requests.length, 0);

	const missingAuthorization = scriptedHttp([]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('byteplus', '/api/v3/contents/generations/tasks'),
		access('byteplus'),
		{
			httpClient: missingAuthorization.client,
			cancellation: new MutableCancellation(),
			taskIntent: { kind: 'new' },
			acknowledgeProviderRequestId: async () => undefined
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'preparation'
		&& error.evidence.retry === 'fresh-submit');
	assert.equal(missingAuthorization.requests.length, 0);

	const missingReplacementAuthorization = scriptedHttp([
		json(200, { task_id: 'hailuo-terminal-no-grant', status: 'Fail', base_resp: { status_msg: 'generation failed' } })
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('minimax', '/v1/video_generation'),
		access('minimax'),
		{
			httpClient: missingReplacementAuthorization.client,
			cancellation: new MutableCancellation(),
			taskIntent: {
				kind: 'exact-retry',
				sourceAttemptId: 'attempt-terminal-no-grant',
				providerRequestId: 'hailuo-terminal-no-grant',
				replacementAuthorized: true
			},
			acknowledgeProviderRequestId: async () => undefined,
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'preparation'
		&& error.evidence.retry === 'fresh-submit');
	assert.deepEqual(missingReplacementAuthorization.requests.map(request => request.method), ['GET']);
});

test('uses the MiniMax query and file-retrieve protocol before downloading the result', async () => {
	const http = scriptedHttp([
		json(200, { task_id: 'hailuo-task', base_resp: { status_code: 0 } }),
		json(200, { task_id: 'hailuo-task', status: 'Success', file_id: 'file-9' }),
		json(200, { file: { download_url: 'https://files.example/hailuo.mp4' } }),
		response(200, mp4)
	]);
	const result = await executeSerializedVideoProviderRequest(serialized('minimax', '/v1/video_generation'), access('minimax'), {
		httpClient: http.client,
		cancellation: new MutableCancellation(),
		taskIntent: { kind: 'new' },
		consumeCreateAuthorization: () => undefined,
		acknowledgeProviderRequestId: async () => undefined,
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	});
	assert.equal(result.providerRequestId, 'hailuo-task');
	assert.deepEqual(http.requests.map(request => new URL(request.url).pathname + new URL(request.url).search), [
		'/v1/video_generation',
		'/v1/query/video_generation?task_id=hailuo-task',
		'/v1/files/retrieve?file_id=file-9',
		'/hailuo.mp4'
	]);
});

test('resumes a durable MiniMax task id without issuing another paid submission', async () => {
	const events: string[] = [];
	const http = scriptedHttp([
		json(200, { task_id: 'hailuo-existing', status: 'Success', file_id: 'file-existing' }),
		json(200, { file: { download_url: 'https://files.example/existing.mp4' } }),
		response(200, mp4)
	], request => events.push(`${request.method} ${new URL(request.url).pathname}`));
	const result = await executeSerializedVideoProviderRequest(serialized('minimax', '/v1/video_generation'), access('minimax'), {
		httpClient: http.client,
		cancellation: new MutableCancellation(),
		resumeProviderRequestId: 'hailuo-existing',
		acknowledgeProviderRequestId: async id => events.push(`ack ${id}`),
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	});
	assert.equal(result.providerRequestId, 'hailuo-existing');
	assert.deepEqual(events, [
		'ack hailuo-existing',
		'GET /v1/query/video_generation',
		'GET /v1/files/retrieve',
		'GET /existing.mp4'
	]);
	assert.equal(http.requests.some(request => request.method === 'POST'), false);
});

test('submits exactly one replacement after a resumed MiniMax task is confirmed terminal', async () => {
	const events: string[] = [];
	const http = scriptedHttp([
		json(200, { task_id: 'hailuo-terminal', status: 'Fail', base_resp: { status_msg: 'generation failed' } }),
		json(200, { task_id: 'hailuo-replacement', base_resp: { status_code: 0 } }),
		json(200, { task_id: 'hailuo-replacement', status: 'Success', file_id: 'file-replacement' }),
		json(200, { file: { download_url: 'https://files.example/replacement.mp4' } }),
		response(200, mp4)
	], request => events.push(`${request.method} ${new URL(request.url).pathname}`));
	const result = await executeSerializedVideoProviderRequest(serialized('minimax', '/v1/video_generation'), access('minimax'), {
		httpClient: http.client,
		cancellation: new MutableCancellation(),
		taskIntent: {
			kind: 'exact-retry',
			sourceAttemptId: 'attempt-terminal',
			providerRequestId: 'hailuo-terminal',
			replacementAuthorized: true
		},
		consumeCreateAuthorization: kind => events.push(`authorize ${kind}`),
		acknowledgeProviderRequestId: async id => events.push(`ack ${id}`),
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	});
	assert.equal(result.providerRequestId, 'hailuo-replacement');
	assert.deepEqual(events, [
		'ack hailuo-terminal',
		'GET /v1/query/video_generation',
		'authorize replacement',
		'POST /v1/video_generation',
		'ack hailuo-replacement',
		'GET /v1/query/video_generation',
		'GET /v1/files/retrieve',
		'GET /replacement.mp4'
	]);
	assert.equal(http.requests.filter(request => request.method === 'POST').length, 1);
});

test('restart recovery never creates a replacement for a provider-terminal task', async () => {
	const http = scriptedHttp([
		json(200, { task_id: 'hailuo-recovery-terminal', status: 'Fail', base_resp: { status_msg: 'generation failed' } })
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('minimax', '/v1/video_generation'),
		access('minimax'),
		{
			httpClient: http.client,
			cancellation: new MutableCancellation(),
			taskIntent: { kind: 'recover', providerRequestId: 'hailuo-recovery-terminal' },
			acknowledgeProviderRequestId: async () => undefined,
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'remote-failed'
		&& error.evidence.retry === 'replace-after-terminal-proof');
	assert.equal(http.requests.filter(request => request.method === 'POST').length, 0);
});

test('exact Retry without replacement authorization reads terminal evidence but never creates', async () => {
	const http = scriptedHttp([
		json(200, { task_id: 'hailuo-unapproved', status: 'Fail', base_resp: { status_msg: 'generation failed' } })
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('minimax', '/v1/video_generation'),
		access('minimax'),
		{
			httpClient: http.client,
			cancellation: new MutableCancellation(),
			taskIntent: {
				kind: 'exact-retry',
				sourceAttemptId: 'attempt-unapproved',
				providerRequestId: 'hailuo-unapproved',
				replacementAuthorized: false
			},
			acknowledgeProviderRequestId: async () => undefined,
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'remote-failed');
	assert.equal(http.requests.filter(request => request.method === 'POST').length, 0);
});

test('does not treat provider UNKNOWN as terminal evidence or consume replacement authorization', async () => {
	const http = scriptedHttp([
		json(200, { output: { task_status: 'UNKNOWN', message: 'status unavailable' } })
	]);
	let authorizations = 0;
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('alibaba-cloud', '/api/v1/services/aigc/video-generation/video-synthesis'),
		access('alibaba-cloud'),
		{
			httpClient: http.client,
			cancellation: new MutableCancellation(),
			taskIntent: {
				kind: 'exact-retry',
				sourceAttemptId: 'attempt-unknown',
				providerRequestId: 'wan-unknown',
				replacementAuthorized: true
			},
			consumeCreateAuthorization: () => { authorizations++; },
			acknowledgeProviderRequestId: async () => undefined,
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'protocol'
		&& error.evidence.retry === 'resume-existing'
		&& error.evidence.providerRequestId === 'wan-unknown');
	assert.equal(authorizations, 0);
	assert.deepEqual(http.requests.map(request => request.method), ['GET']);
});

test('does not cancel a durable resumed task after a transient polling failure', async () => {
	const http = scriptedHttp([
		json(503, { message: 'temporary' }),
		json(503, { message: 'temporary' }),
		json(503, { message: 'temporary' })
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('byteplus', '/api/v3/contents/generations/tasks'),
		access('byteplus'),
		{
			httpClient: http.client,
			cancellation: new MutableCancellation(),
			resumeProviderRequestId: 'seedance-durable',
			acknowledgeProviderRequestId: async () => undefined,
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'poll-interrupted'
		&& error.evidence.retry === 'resume-existing'
		&& error.evidence.providerRequestId === 'seedance-durable'
		&& /HTTP 503/.test(error.message));
	assert.equal(http.requests.filter(request => request.method === 'DELETE').length, 0);
	assert.equal(http.requests.filter(request => request.method === 'POST').length, 0);
});

test('terminates the finite polling window without cancelling or replacing the durable task', async () => {
	const http = scriptedHttp([
		json(200, { status: 'running' }),
		json(200, { status: 'running' })
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('byteplus', '/api/v3/contents/generations/tasks'),
		access('byteplus'),
		{
			httpClient: http.client,
			cancellation: new MutableCancellation(),
			taskIntent: { kind: 'recover', providerRequestId: 'task-window' },
			acknowledgeProviderRequestId: async () => undefined,
			wait: async () => undefined,
			pollIntervalMilliseconds: 0,
			maximumPollAttempts: 2
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'poll-window-exhausted'
		&& error.evidence.retry === 'resume-existing'
		&& error.evidence.providerRequestId === 'task-window');
	assert.deepEqual(http.requests.map(request => request.method), ['GET', 'GET']);
});

test('does not cancel an inherited durable task when its repeat acknowledgement fails', async () => {
	const http = scriptedHttp([]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('byteplus', '/api/v3/contents/generations/tasks'),
		access('byteplus'),
		{
			httpClient: http.client,
			cancellation: new MutableCancellation(),
			resumeProviderRequestId: 'seedance-inherited',
			acknowledgeProviderRequestId: async () => { throw new Error('host acknowledgement failed'); },
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), /host acknowledgement failed/);
	assert.deepEqual(http.requests, []);
});

test('uses the Wan task protocol and accepts only a completed local MP4 payload', async () => {
	const http = scriptedHttp([
		json(200, { output: { task_id: 'wan-task' }, request_id: 'request-1' }),
		json(200, { output: { task_status: 'PENDING' } }),
		json(200, {
			output: { task_status: 'SUCCEEDED', video_url: 'https://oss.example/wan.mp4' },
			usage: { output_video_duration: 5 }
		}),
		response(200, mp4)
	]);
	const result = await executeSerializedVideoProviderRequest(serialized('alibaba-cloud', '/api/v1/services/aigc/video-generation/video-synthesis'), access('alibaba-cloud'), {
		httpClient: http.client,
		cancellation: new MutableCancellation(),
		taskIntent: { kind: 'new' },
		consumeCreateAuthorization: () => undefined,
		acknowledgeProviderRequestId: async () => undefined,
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	});
	assert.equal(result.providerRequestId, 'wan-task');
	assert.deepEqual(result.usage, { videoSeconds: 5 });
	assert.equal(new URL(http.requests[2].url).pathname, '/api/v1/tasks/wan-task');
});

test('acknowledges the remote id before cancellation and best-effort cancels a queued Wan task', async () => {
	const cancellation = new MutableCancellation();
	const http = scriptedHttp([
		json(200, { output: { task_id: 'wan-cancel' } }),
		json(200, { request_id: 'cancel-request' })
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('alibaba-cloud', '/api/v1/services/aigc/video-generation/video-synthesis'),
		access('alibaba-cloud'),
			{
				httpClient: http.client,
				cancellation,
				taskIntent: { kind: 'new' },
				consumeCreateAuthorization: () => undefined,
				acknowledgeProviderRequestId: async () => cancellation.cancel(),
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), VideoProviderCancelledError);
	assert.deepEqual(http.requests.map(request => `${request.method} ${new URL(request.url).pathname}`), [
		'POST /api/v1/services/aigc/video-generation/video-synthesis',
		'POST /api/v1/tasks/wan-cancel/cancel'
	]);
});

test('does not poll until the newly submitted task id is durably acknowledged', async () => {
	const http = scriptedHttp([
		json(200, { id: 'seedance-unacknowledged' }),
		json(200, {})
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(
		serialized('byteplus', '/api/v3/contents/generations/tasks'),
		access('byteplus'),
			{
				httpClient: http.client,
				cancellation: new MutableCancellation(),
				taskIntent: { kind: 'new' },
				consumeCreateAuthorization: () => undefined,
				acknowledgeProviderRequestId: async () => { throw new Error('durable host write failed'); },
			wait: async () => undefined,
			pollIntervalMilliseconds: 0
		}
	), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'remote-id-uncommitted'
		&& error.evidence.retry === 'blocked'
		&& error.evidence.uncommittedProviderRequestId === 'seedance-unacknowledged'
		&& /durable host write failed/.test(error.message));
	assert.deepEqual(http.requests.map(request => `${request.method} ${new URL(request.url).pathname}`), [
		'POST /api/v3/contents/generations/tasks',
		'DELETE /api/v3/contents/generations/tasks/seedance-unacknowledged'
	]);
});

test('never transport-retries a paid submission and fails closed on unknown status or non-MP4 downloads', async () => {
	const failedSubmit = scriptedHttp([json(503, { message: 'busy' })]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(serialized('byteplus', '/api/v3/contents/generations/tasks'), access('byteplus'), {
		httpClient: failedSubmit.client,
		cancellation: new MutableCancellation(),
		taskIntent: { kind: 'new' },
		consumeCreateAuthorization: () => undefined,
		acknowledgeProviderRequestId: async () => undefined,
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	}), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'submission-ambiguous'
		&& error.evidence.retry === 'blocked'
		&& /HTTP 503/.test(error.message));
	assert.equal(failedSubmit.requests.length, 1);

	const unknown = scriptedHttp([
		json(200, { id: 'unknown-task' }),
		json(200, { status: 'mysterious' })
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(serialized('byteplus', '/api/v3/contents/generations/tasks'), access('byteplus'), {
		httpClient: unknown.client,
		cancellation: new MutableCancellation(),
		taskIntent: { kind: 'new' },
		consumeCreateAuthorization: () => undefined,
		acknowledgeProviderRequestId: async () => undefined,
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	}), /unknown task status/);
	assert.equal(unknown.requests.at(-1)?.method, 'GET');
	assert.equal(unknown.requests.some(request => request.method === 'DELETE'), false);

	const invalidVideo = scriptedHttp([
		json(200, { id: 'invalid-video-task' }),
		json(200, { status: 'succeeded', content: { video_url: 'https://cdn.example/not-video' } }),
		response(200, new TextEncoder().encode('<html>not video</html>'))
	]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(serialized('byteplus', '/api/v3/contents/generations/tasks'), access('byteplus'), {
		httpClient: invalidVideo.client,
		cancellation: new MutableCancellation(),
		taskIntent: { kind: 'new' },
		consumeCreateAuthorization: () => undefined,
		acknowledgeProviderRequestId: async () => undefined,
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	}), error => error instanceof VideoProviderExecutionFailure
		&& error.evidence.kind === 'artifact-invalid'
		&& error.evidence.retry === 'resume-existing'
		&& error.evidence.providerRequestId === 'invalid-video-task');
	assert.equal(invalidVideo.requests.at(-1)?.headers.Authorization, undefined);

	const unsafeTaskId = scriptedHttp([json(200, { id: 'task id with spaces' })]);
	await assert.rejects(() => executeSerializedVideoProviderRequest(serialized('byteplus', '/api/v3/contents/generations/tasks'), access('byteplus'), {
		httpClient: unsafeTaskId.client,
		cancellation: new MutableCancellation(),
		taskIntent: { kind: 'new' },
		consumeCreateAuthorization: () => undefined,
		acknowledgeProviderRequestId: async () => assert.fail('An unsafe task id must not reach host acknowledgement.'),
		wait: async () => undefined,
		pollIntervalMilliseconds: 0
	}), /no valid BytePlus task id/);
	assert.equal(unsafeTaskId.requests.length, 1);
});

test('redacts every granted credential from provider HTTP error bodies while preserving status', async () => {
	const apiKey = 'api-key-that-must-never-escape';
	const signingKey = 'secondary-signing-secret';
	const http = scriptedHttp([
		json(401, { error: { message: `invalid Bearer ${apiKey}; signature ${signingKey}` } })
	]);
	let rejected: unknown;
	try {
		await executeSerializedVideoProviderRequest(
			serialized('byteplus', '/api/v3/contents/generations/tasks'),
			{
				...access('byteplus'),
				apiKey,
				credentialValues: { apiKey, signingKey }
			},
			{
				httpClient: http.client,
				cancellation: new MutableCancellation(),
				taskIntent: { kind: 'new' },
				consumeCreateAuthorization: () => undefined,
				acknowledgeProviderRequestId: async () => undefined,
				wait: async () => undefined,
				pollIntervalMilliseconds: 0
			}
		);
	} catch (error) {
		rejected = error;
	}
	assert.ok(rejected instanceof Error);
	assert.match(rejected.message, /HTTP 401/);
	assert.match(rejected.message, /\[REDACTED\]/);
	assert.equal(rejected.message.includes(apiKey), false);
	assert.equal(rejected.message.includes(signingKey), false);
	assert.equal(rejected.stack?.includes(apiKey) ?? false, false);
	assert.equal(rejected.stack?.includes(signingKey) ?? false, false);
});

test('redacts provider terminal failure text before status reporting and throwing', async () => {
	const apiKey = 'minimax-api-key-that-must-never-escape';
	const accountSecret = 'account-secret-that-must-never-escape';
	const statuses: string[] = [];
	const http = scriptedHttp([
		json(200, { task_id: 'hailuo-redaction', base_resp: { status_code: 0 } }),
		json(200, {
			task_id: 'hailuo-redaction',
			status: 'Fail',
			base_resp: { status_msg: `credential ${apiKey}; account ${accountSecret}` }
		})
	]);
	let rejected: unknown;
	try {
		await executeSerializedVideoProviderRequest(
			serialized('minimax', '/v1/video_generation'),
			{
				...access('minimax'),
				apiKey,
				credentialValues: { apiKey, accountSecret }
			},
			{
				httpClient: http.client,
				cancellation: new MutableCancellation(),
				taskIntent: { kind: 'new' },
				consumeCreateAuthorization: () => undefined,
				acknowledgeProviderRequestId: async () => undefined,
				onStatus: message => statuses.push(message),
				wait: async () => undefined,
				pollIntervalMilliseconds: 0
			}
		);
	} catch (error) {
		rejected = error;
	}
	assert.ok(rejected instanceof VideoProviderExecutionFailure);
	assert.equal(rejected.evidence.kind, 'remote-failed');
	assert.equal(rejected.evidence.retry, 'replace-after-terminal-proof');
	assert.match(rejected.message, /MiniMax video generation failed/);
	assert.match(rejected.message, /\[REDACTED\]/);
	for (const visible of [...statuses, rejected.message]) {
		assert.equal(visible.includes(apiKey), false);
		assert.equal(visible.includes(accountSecret), false);
	}
	assert.equal(rejected.stack?.includes(apiKey) ?? false, false);
	assert.equal(rejected.stack?.includes(accountSecret) ?? false, false);
});

test('rejects embedded credentials and private literal provider endpoints before transport', async () => {
	for (const endpoint of ['https://user:secret@provider.example', 'https://127.0.0.1', 'http://localhost:3000']) {
		const http = scriptedHttp([]);
		await assert.rejects(() => executeSerializedVideoProviderRequest(
			serialized('byteplus', '/api/v3/contents/generations/tasks'),
			{ ...access('byteplus'), endpoint },
				{
					httpClient: http.client,
					cancellation: new MutableCancellation(),
					taskIntent: { kind: 'new' },
					consumeCreateAuthorization: () => undefined,
					acknowledgeProviderRequestId: async () => undefined
			}
		), /HTTPS URL|embedded credentials|private-address host/);
		assert.equal(http.requests.length, 0);
	}
});

test('rejects credential-free and custom-header connections before transport', async () => {
	for (const { connection, expected } of [
		{ connection: { authorization: 'none' as const, apiKey: undefined }, expected: /require a Bearer API key/ },
		{ connection: { authorization: 'header' as const, headerName: 'X-API-Key', apiKey: 'secret' }, expected: /require a Bearer API key/ },
		{ connection: { authorization: 'bearer' as const, apiKey: undefined }, expected: /credential is missing or invalid/ }
	]) {
		const http = scriptedHttp([]);
		await assert.rejects(() => executeSerializedVideoProviderRequest(
			serialized('byteplus', '/api/v3/contents/generations/tasks'),
			{ ...access('byteplus'), ...connection },
				{
					httpClient: http.client,
					cancellation: new MutableCancellation(),
					taskIntent: { kind: 'new' },
					consumeCreateAuthorization: () => undefined,
					acknowledgeProviderRequestId: async () => undefined
			}
		), expected);
		assert.equal(http.requests.length, 0);
	}
});

test('bounds redirects and response bytes while stripping cross-origin credentials', async () => {
	const redirected = scriptedHttp([
		response(302, new Uint8Array(), { location: 'https://cdn.example/video.mp4' }),
		response(200, mp4)
	]);
	const client = createNodeVideoHttpClient(redirected.client);
	const result = await client({
		method: 'GET',
		url: 'https://provider.example/output',
		headers: {
			Accept: 'video/mp4',
			Authorization: 'Bearer must-not-cross-origin',
			'X-Provider-Key': 'must-not-cross-origin'
		},
		maximumResponseBytes: 32,
		maximumRedirects: 1,
		timeoutMilliseconds: 1234
	}, new MutableCancellation());
	assert.deepEqual(result.body, mp4);
	assert.equal(redirected.requests.length, 2);
	assert.equal(redirected.requests[1].url, 'https://cdn.example/video.mp4');
	assert.deepEqual(redirected.requests[1].headers, { Accept: 'video/mp4' });
	assert.equal(redirected.requests[1].timeoutMilliseconds, 1234);

	const refused = scriptedHttp([
		response(302, new Uint8Array(), { location: 'https://cdn.example/video.mp4' })
	]);
	await assert.rejects(() => createNodeVideoHttpClient(refused.client)({
		method: 'GET',
		url: 'https://provider.example/output',
		headers: { Accept: 'video/mp4' },
		maximumResponseBytes: 32,
		maximumRedirects: 0
	}, new MutableCancellation()), /unexpected redirect/);
	assert.equal(refused.requests.length, 1);

	const oversized = scriptedHttp([response(200, new Uint8Array(33))]);
	await assert.rejects(() => createNodeVideoHttpClient(oversized.client)({
		method: 'GET',
		url: 'https://cdn.example/video.mp4',
		headers: { Accept: 'video/mp4' },
		maximumResponseBytes: 32
	}, new MutableCancellation()), /exceeds the 32-byte limit/);

	let unboundedCalls = 0;
	await assert.rejects(() => createNodeVideoHttpClient(async () => {
		unboundedCalls++;
		return response(200, mp4);
	})({
		method: 'GET',
		url: 'https://cdn.example/video.mp4',
		headers: { Accept: 'video/mp4' },
		maximumResponseBytes: 32,
		maximumRedirects: 6
	}, new MutableCancellation()), /redirect limit.*reviewed range/);
	assert.equal(unboundedCalls, 0);
});

function serialized(provider: string, endpointPath: string): SerializedVideoProviderRequest {
	return {
		provider,
		endpointPath,
		headers: provider === 'alibaba-cloud' ? { 'X-DashScope-Async': 'enable' } : {},
		body: { model: 'reviewed-model', input: { prompt: 'test' } }
	};
}

function access(providerId: string): VideoProviderExecutionAccess {
	return {
		endpoint: 'https://provider.example',
		providerId,
		deploymentId: 'deployment',
		region: 'global',
		authorization: 'bearer',
		apiKey: 'secret'
	};
}

function scriptedHttp(
	responses: readonly VideoHttpResponse[],
	onRequest?: (request: VideoHttpRequest) => void
): { readonly client: VideoHttpClient; readonly requests: VideoHttpRequest[] } {
	const requests: VideoHttpRequest[] = [];
	const pending = [...responses];
	return {
		requests,
		client: async request => {
			requests.push(request);
			onRequest?.(request);
			const next = pending.shift();
			assert.ok(next, `Unexpected HTTP request: ${request.method} ${request.url}`);
			return next;
		}
	};
}

function json(status: number, value: unknown): VideoHttpResponse {
	return response(status, new TextEncoder().encode(JSON.stringify(value)), { 'content-type': 'application/json' });
}

function response(status: number, body: Uint8Array, headers: Readonly<Record<string, string>> = {}): VideoHttpResponse {
	return { status, body, headers };
}

class MutableCancellation implements VideoExecutionCancellation {
	private cancelled = false;
	private readonly listeners = new Set<() => void>();

	get isCancellationRequested(): boolean {
		return this.cancelled;
	}

	readonly onCancellationRequested = (listener: () => void): { dispose(): void } => {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	};

	cancel(): void {
		if (this.cancelled) {
			return;
		}
		this.cancelled = true;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

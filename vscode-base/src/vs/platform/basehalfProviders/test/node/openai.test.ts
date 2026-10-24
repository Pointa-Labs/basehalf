/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { OPENAI } from '../src/providers/openai.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { CatalogParameter, ChoiceParameter, Output } from '../src/providers/types.ts';
import { error, gifHeader, multipartParts, partTargets, png, routed, sendJson, serveFiles, startServer, tinyJpeg, tinyPng, value, webpHeader } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-openai-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

function file(name: string, bytes: Buffer, mimeType: string) {
	const fsPath = join(folder, name);
	writeFileSync(fsPath, bytes);
	return { fsPath, mimeType };
}

const LOTION = file('lotion.png', png(512, 512), 'image/png');
const SOAP = file('soap.jpg', tinyJpeg(), 'image/jpeg');
const TABLE = file('table.webp', webpHeader('VP8X', 1024, 768), 'image/webp');
const MOTION = file('motion.gif', gifHeader(640, 360), 'image/gif');

const KEY = 'sk-proj-test-0123456789abcdef';
const NO_INPUTS = { images: [], videos: [], audios: [] };

function commands(inspector?: () => MediaInspector) {
	return new VideoProviderCommands([OPENAI], { http: { sleep: async () => undefined }, ...(inspector ? { inspector } : {}) });
}

/** Where a request goes: a local server at the path of OpenAI's base URL. */
function access(server: string) {
	return { provider: 'openai', region: 'global', endpoint: `${server}/v1`, credentials: { apiKey: KEY } };
}

/** A request in References mode, with a new target for each image it may make. */
function imageRequest(server: string, model: string, params: Record<string, unknown>, prompt: string, inputs: Record<string, unknown> = NO_INPUTS) {
	const count = typeof params.count === 'number' ? params.count : 1;
	return { ...access(server), model, mode: 'reference', params, prompt, inputs, targets: partTargets(count) };
}

function references(...images: readonly unknown[]) {
	return { images, videos: [], audios: [] };
}

/** OpenAI's answer with these images as base64. */
function imagesAnswer(images: readonly Buffer[]): Record<string, unknown> {
	return {
		created: 1761100000,
		background: 'opaque',
		data: images.map(image => ({ b64_json: image.toString('base64') })),
		output_format: 'png',
		quality: 'high',
		size: '1024x1024',
		usage: { input_tokens: 50, output_tokens: 4160, total_tokens: 4210 }
	};
}

function outputsOf(submitted: unknown): Output[] {
	return (submitted as { readonly outputs: Output[] }).outputs;
}

function summary(parameter: CatalogParameter): string {
	const more = parameter.advanced ? ' (more)' : '';
	switch (parameter.kind) {
		case 'choice':
			return `${parameter.name}=${parameter.options.map(option => option.value).join('|')}:${parameter.default}${more}`;
		case 'integer':
		case 'number':
			return `${parameter.name}=${parameter.min}-${parameter.max}:${parameter.default ?? 'unset'}${more}`;
		default:
			return `${parameter.name}:${String(parameter.default)}${more}`;
	}
}

test('the catalog entry declares the global region, the API key, and the three GPT Image models with their qualities, and no video', () => {
	const provider = buildCatalog([OPENAI]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'openai',
		label: 'OpenAI',
		regions: [{ id: 'global', label: 'Global', baseUrl: 'https://api.openai.com/v1', console: 'https://platform.openai.com/settings/organization/api-keys' }],
		credentials: [{ id: 'apiKey', label: 'API Key' }]
	});
	const models = Object.fromEntries(provider.models.map(model => [model.id, {
		label: model.label,
		kind: model.kind,
		ids: model.providerModels,
		format: model.outputFormat,
		atOnce: model.answersAtOnce,
		prompt: `${model.prompt.required} ${model.prompt.maxLength}`,
		modes: model.modes.map(mode => `${mode.id}: start ${mode.inputs.startFrame}, end ${mode.inputs.endFrame}, images ${mode.inputs.images.min}-${mode.inputs.images.max}, videos ${mode.inputs.videos.max}, audio ${mode.inputs.audios.max}, source ${mode.inputs.source}`),
		limits: model.modes.map(mode => mode.limits),
		parameters: model.parameters.map(summary)
	}]));
	const entry = (label: string, id: string, qualities: string) => ({
		label,
		kind: 'image',
		ids: { global: id },
		format: 'png',
		atOnce: true,
		prompt: 'always 32000',
		modes: ['reference: start none, end none, images 0-16, videos 0, audio 0, source none'],
		limits: [{ imageMaxBytes: 50 * 1024 * 1024 - 1 }],
		parameters: [
			'ratio=16:9|4:3|3:2|1:1|2:3|3:4|9:16|21:9|adaptive:adaptive',
			'resolution=1k|2k|4k:1k',
			`quality=${qualities}:auto`,
			'count=1-10:1',
			'background=opaque|transparent|auto:auto',
			'moderation=auto|low:auto (more)'
		]
	});
	assert.deepEqual(models, {
		'gpt-image-2.5-flare': entry('GPT Image 2.5 Flare', 'gpt-image-2.5-flare', 'low|medium|high|xhigh|max|auto'),
		'gpt-image-2.5-sunburst': entry('GPT Image 2.5 Sunburst', 'gpt-image-2.5-sunburst', 'low|medium|high|xhigh|max|auto'),
		'gpt-image-2': entry('GPT Image 2', 'gpt-image-2', 'low|medium|high|auto')
	});
	const flare = provider.models[0];
	const labels = (name: string) => (flare.parameters.find(parameter => parameter.name === name) as ChoiceParameter).options.map(option => option.label);
	assert.deepEqual({
		resolutions: labels('resolution'),
		qualities: labels('quality'),
		backgrounds: labels('background'),
		videoLocation: OPENAI.videoLocation,
		last: PROVIDER_MODULES.at(-1) === OPENAI,
		deprecated: provider.models.some(model => model.deprecated)
	}, {
		resolutions: ['1K', '2K', '4K'],
		qualities: ['Low', 'Medium', 'High', 'Extra High', 'Max', 'Auto'],
		backgrounds: ['Opaque', 'Transparent', 'Auto'],
		videoLocation: undefined,
		last: true,
		deprecated: false
	});
});

test('an image from the prompt alone is one JSON request to /images/generations, and each image answered as base64 is written to its target', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, imagesAnswer([tinyPng(), tinyPng()])));
	try {
		const request = imageRequest(server.url, 'gpt-image-2.5-flare', { ratio: '16:9', resolution: '2k', quality: 'high', count: 2, background: 'transparent', moderation: 'low' }, 'A glass bottle on a white table.');
		const outputs = outputsOf(value(await commands().submit(request)));
		const [received] = server.received;
		assert.deepEqual({
			sent: server.received.map(entry => `${entry.method} ${entry.path} ${entry.headers.authorization} ${entry.headers['content-type']}`),
			body: JSON.parse(received.body.toString('utf8')),
			outputs,
			written: request.targets.map(target => readFileSync(target).equals(tinyPng()))
		}, {
			sent: [`POST /v1/images/generations Bearer ${KEY} application/json`],
			body: { model: 'gpt-image-2.5-flare', prompt: 'A glass bottle on a white table.', n: 2, size: '2816x1584', quality: 'high', background: 'transparent', output_format: 'png', moderation: 'low' },
			outputs: [
				{ written: request.targets[0], size: tinyPng().byteLength, format: 'png' },
				{ written: request.targets[1], size: tinyPng().byteLength, format: 'png' }
			],
			written: [true, true]
		});
	} finally {
		await server.close();
	}
});

test('an image from references is one multipart request to /images/edits: the fields as text parts, then each image as an image[] file in input order, and no moderation', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, imagesAnswer([tinyPng()])));
	try {
		const request = imageRequest(server.url, 'gpt-image-2', {}, 'Put Image 1 and Image 2 on the table of Image 3.', references(LOTION, SOAP, TABLE));
		value(await commands().submit(request));
		const [received] = server.received;
		const parts = multipartParts(received);
		const files = parts.filter(part => part.fileName !== undefined);
		assert.deepEqual({
			sent: server.received.map(entry => `${entry.method} ${entry.path} ${entry.headers.authorization}`),
			form: /^multipart\/form-data; boundary=\S+$/.test(String(received.headers['content-type'])),
			fields: parts.filter(part => part.fileName === undefined).map(part => `${part.name}=${part.bytes.toString('utf8')}`),
			files: files.map(part => `${part.name} ${part.fileName} ${part.contentType}`),
			same: [LOTION, SOAP, TABLE].map((media, index) => files[index].bytes.equals(readFileSync(media.fsPath)))
		}, {
			sent: [`POST /v1/images/edits Bearer ${KEY}`],
			form: true,
			fields: ['model=gpt-image-2', 'prompt=Put Image 1 and Image 2 on the table of Image 3.', 'n=1', 'size=auto', 'quality=auto', 'background=auto', 'output_format=png'],
			files: ['image[] image-1.png image/png', 'image[] image-2.jpg image/jpeg', 'image[] image-3.webp image/webp'],
			same: [true, true, true]
		});
	} finally {
		await server.close();
	}
});

test('each ratio at each resolution sends a size within OpenAI\'s rules whose area is closest to the resolution\'s, and Adaptive sends auto', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, imagesAnswer([tinyPng()])));
	try {
		const providers = commands();
		const sizes: Record<string, string[]> = {};
		for (const ratio of ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9', 'adaptive']) {
			for (const resolution of ['1k', '2k', '4k']) {
				value(await providers.submit(imageRequest(server.url, 'gpt-image-2.5-sunburst', { ratio, resolution }, 'A test card.')));
				(sizes[ratio] ??= []).push(String(JSON.parse(server.received.at(-1)?.body.toString('utf8') ?? '{}').size));
			}
		}
		const broken = Object.values(sizes).flat().filter(size => size !== 'auto').filter(size => {
			const [width, height] = size.split('x').map(Number);
			return width % 16 !== 0 || height % 16 !== 0 || Math.max(width, height) > 3840 || width * height > 8_294_400 || width * height < 655_360 || Math.max(width, height) > 3 * Math.min(width, height);
		});
		assert.deepEqual({ sizes, broken }, {
			sizes: {
				'16:9': ['1280x720', '2816x1584', '3840x2160'],
				'4:3': ['1152x864', '2368x1776', '3264x2448'],
				'3:2': ['1248x832', '2496x1664', '3504x2336'],
				'1:1': ['1024x1024', '2048x2048', '2880x2880'],
				'2:3': ['832x1248', '1664x2496', '2336x3504'],
				'3:4': ['864x1152', '1776x2368', '2448x3264'],
				'9:16': ['720x1280', '1584x2816', '2160x3840'],
				'21:9': ['1568x672', '3136x1344', '3808x1632'],
				adaptive: ['auto', 'auto', 'auto']
			},
			broken: []
		});
	} finally {
		await server.close();
	}
});

test('the answer keeps OpenAI\'s order: base64 written to its target, an address a relay gives downloaded without the key, and an entry it cannot read refused alone', async () => {
	const files = await startServer(routed(serveFiles({ '/relay/2.png': tinyPng() })));
	let answer: unknown = {};
	const server = await startServer((request, response) => sendJson(response, 200, answer));
	try {
		const providers = commands();
		answer = { data: [{ b64_json: tinyJpeg().toString('base64') }, { url: `${files.url}/relay/2.png` }, { revised_prompt: 'Three cards.' }], output_format: 'jpeg' };
		const request = imageRequest(server.url, 'gpt-image-2', { count: 3 }, 'Three cards.');
		const outputs = outputsOf(value(await providers.submit(request)));
		const target = partTargets(1)[0];
		const downloaded = value(await providers.download({ ...access(server.url), model: 'gpt-image-2', kind: 'image', url: `${files.url}/relay/2.png`, targetFsPath: target }));
		answer = { created: 1761100000 };
		const unreadable = error(await providers.submit(imageRequest(server.url, 'gpt-image-2', {}, 'One card.')));
		answer = imagesAnswer([tinyPng()]);
		const fewer = outputsOf(value(await providers.submit(imageRequest(server.url, 'gpt-image-2', { count: 4 }, 'Four cards.'))));
		assert.deepEqual({ outputs, downloaded, keySent: files.received.map(entry => entry.headers.authorization ?? 'none'), unreadable, fewer: fewer.length }, {
			outputs: [
				{ written: request.targets[0], size: tinyJpeg().byteLength, format: 'jpeg' },
				{ url: `${files.url}/relay/2.png` },
				{ refused: 'OpenAI answered an image AI Video cannot read.' }
			],
			downloaded: { size: tinyPng().byteLength, format: 'png' },
			keySent: ['none'],
			unreadable: { code: 'unknownOutcome', message: 'OpenAI accepted the request but answered no images AI Video can read.' },
			fewer: 1
		});
	} finally {
		await server.close();
		await files.close();
	}
});

test('a wrong key, a country OpenAI does not serve, an organization it has not verified, too many requests, an empty balance, a blocked prompt, a server error, and a dropped answer map as OpenAI means them, each sent once', async () => {
	const failure = (status: number, message: string, type: string, code: string | null, headers: Record<string, string> = {}) => (response: ServerResponse) =>
		sendJson(response, status, { error: { message, type, param: null, code } }, headers);
	const unverified = 'Your organization must be verified to use the model `gpt-image-2.5-flare`. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization. If you just verified, it can take up to 15 minutes for access to propagate.';
	const answers: Record<string, (response: ServerResponse) => void> = {
		key: failure(401, 'Incorrect API key provided: sk-proj-****cdef. You can find your API key at https://platform.openai.com/account/api-keys.', 'invalid_request_error', 'invalid_api_key'),
		country: failure(403, 'Country, region, or territory not supported', 'request_forbidden', 'unsupported_country_region_territory'),
		unverified: failure(403, unverified, 'invalid_request_error', null),
		busy: failure(429, 'Rate limit reached for gpt-image-2.5-flare on images per min (IPM): Limit 20, Used 20, Requested 1.', 'requests', 'rate_limit_exceeded', { 'Retry-After': '7' }),
		slowDown: failure(429, 'Your request rate increased too quickly. Please slow down.', 'rate_limit_error', 'slow_down'),
		credits: failure(429, 'Your organization has no prepaid credits remaining.', 'insufficient_quota', 'credit_balance_exhausted'),
		spend: failure(429, 'Your project reached its spend limit.', 'insufficient_quota', 'project_spend_limit_exceeded'),
		blocked: failure(400, 'Your request was rejected by the safety system.', 'image_generation_user_error', 'moderation_blocked'),
		overloaded: failure(503, 'The model is currently overloaded with other requests.', 'service_unavailable_error', 'server_is_overloaded'),
		broken: failure(500, 'The server had an error while processing your request.', 'server_error', null)
	};
	let current = 'key';
	const server = await startServer((request, response, socket) => {
		if (request.path.startsWith('/drop/')) {
			socket.destroy();
			return;
		}
		answers[current](response);
	});
	try {
		const providers = commands();
		const outcomes: Record<string, unknown> = {};
		for (const name of Object.keys(answers)) {
			current = name;
			outcomes[name] = error(await providers.submit(imageRequest(server.url, 'gpt-image-2.5-flare', {}, 'A storm over the pier.')));
		}
		outcomes.dropped = error(await providers.submit(imageRequest(`${server.url}/drop`, 'gpt-image-2.5-flare', {}, 'A storm over the pier.'))).code;
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: {
				key: { code: 'auth', message: 'Incorrect API key provided: sk-proj-****cdef. You can find your API key at https://platform.openai.com/account/api-keys.', status: 401 },
				// A 403 refuses the request, not the key.
				country: { code: 'rejected', message: 'Country, region, or territory not supported', status: 403 },
				unverified: { code: 'rejected', message: unverified, status: 403 },
				busy: { code: 'rateLimited', message: 'Rate limit reached for gpt-image-2.5-flare on images per min (IPM): Limit 20, Used 20, Requested 1. The provider asks to wait 7 seconds.', status: 429 },
				slowDown: { code: 'rateLimited', message: 'Your request rate increased too quickly. Please slow down.', status: 429 },
				credits: { code: 'balance', message: 'Your organization has no prepaid credits remaining.', status: 429 },
				spend: { code: 'balance', message: 'Your project reached its spend limit.', status: 429 },
				blocked: { code: 'rejected', message: 'Your request was rejected by the safety system.', status: 400 },
				overloaded: { code: 'unknownOutcome', message: 'The model is currently overloaded with other requests.', status: 503 },
				broken: { code: 'unknownOutcome', message: 'The server had an error while processing your request.', status: 500 },
				dropped: 'unknownOutcome'
			},
			// Each request was sent once, never again.
			sent: 11
		});
	} finally {
		await server.close();
	}
});

test('check refuses Moderation Low with references and a request larger than AI Video sends, and the declarations refuse what GPT Image does not take', async () => {
	const problems = async (model: string, params: Record<string, unknown>, prompt: string, inputs: Record<string, unknown>, inspector?: () => MediaInspector) =>
		value(await commands(inspector).check({ provider: 'openai', region: 'global', model, mode: 'reference', params, prompt, inputs })).problems;
	const lowWithReferences = 'OpenAI takes Moderation Low only for an image made from the prompt alone: set Moderation to Auto, or disconnect the reference images.';
	assert.deepEqual(await problems('gpt-image-2.5-flare', { moderation: 'low' }, 'p', NO_INPUTS), []);
	assert.deepEqual(await problems('gpt-image-2.5-flare', { moderation: 'low' }, 'p', references(LOTION)), [lowWithReferences]);
	assert.deepEqual(await problems('gpt-image-2.5-flare', {}, 'p', references(LOTION, SOAP, TABLE)), []);
	const large = () => ({ inspect: async () => ({ name: 'large.png', bytes: 40 * 1024 * 1024, format: 'png' as const, width: 4000, height: 3000 }) });
	assert.deepEqual(await problems('gpt-image-2', {}, 'p', references(LOTION, LOTION, LOTION, LOTION), large), ['The reference images make a request of 160.0 MiB; AI Video sends at most 128 MiB. Use fewer or smaller images.']);
	// What the declarations refuse.
	assert.deepEqual(await problems('gpt-image-2', { quality: 'xhigh' }, 'p', NO_INPUTS), ['Quality cannot be xhigh for GPT Image 2; choose Low, Medium, High, Auto.']);
	assert.deepEqual(await problems('gpt-image-2.5-flare', { count: 11 }, 'p', NO_INPUTS), ['Images must be between 1 and 10.']);
	assert.deepEqual(await problems('gpt-image-2.5-sunburst', {}, 'p', references(...Array(17).fill(LOTION))), ['GPT Image 2.5 Sunburst in References mode takes at most 16 reference images; 17 are planned.']);
	assert.deepEqual(await problems('gpt-image-2.5-sunburst', {}, 'x'.repeat(32_001), NO_INPUTS), ['The prompt is 32001 characters long; GPT Image 2.5 Sunburst takes at most 32000.']);
	assert.deepEqual(await problems('gpt-image-2.5-sunburst', {}, '', NO_INPUTS), ['Write a prompt: GPT Image 2.5 Sunburst needs one.']);
	assert.deepEqual(await problems('gpt-image-2.5-flare', {}, 'p', references(MOTION)), ['Reference image 1 motion.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.']);
});

test('GPT Image has no task: poll refuses one, and cancel answers false without a request', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, {}));
	try {
		const providers = commands();
		const ref = { ...access(server.url), model: 'gpt-image-2', remoteId: 'img-1' };
		assert.deepEqual({ poll: error(await providers.poll(ref)), cancel: value(await providers.cancel(ref)), sent: server.received.length }, {
			poll: { code: 'rejected', message: 'GPT Image 2 answers with its images at once: there is no task to ask about.' },
			cancel: { cancelled: false },
			sent: 0
		});
	} finally {
		await server.close();
	}
});

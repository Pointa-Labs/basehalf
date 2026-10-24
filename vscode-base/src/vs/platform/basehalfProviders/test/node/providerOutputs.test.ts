/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The outputs of a request (providers, "Requests"): what a provider answers at
 * once or from a poll, written to the targets the window names, kept one by
 * one, and downloaded by kind. The test provider's `still-1` answers at once,
 * and `still-tasks` runs as a task.
 */

import { strict as assert } from 'assert';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../../node/commands.js';
import type { BoundHttp } from '../../node/http.js';
import type { OutputLocation } from '../../node/module.js';
import { answerImagesAtOnce, error, partTargets, routed, sendJson, serveFiles, startServer, testModule, tinyJpeg, tinyPng, value } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerOutputs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const KEY = 'sk-outputs-secret-1';
	const NO_INPUTS = { images: [], videos: [], audios: [] };

	function commands(overrides: Parameters<typeof testModule>[0] = {}, options: VideoProviderCommandOptions = {}) {
		return new VideoProviderCommands([testModule(overrides)], { ...options, http: { sleep: async () => undefined, ...options.http } });
	}

	/** A request for the image model that answers at once, making `count` images, with a target for each. */
	function imageRequest(endpoint: string, count: number, overrides: Record<string, unknown> = {}) {
		return {
			provider: 'testprovider',
			region: 'home',
			endpoint,
			credentials: { apiKey: KEY },
			model: 'still-1',
			mode: 'reference',
			params: { count },
			prompt: 'A red kite over the sea.',
			inputs: NO_INPUTS,
			targets: partTargets(count),
			...overrides
		};
	}

	function taskRef(endpoint: string, overrides: Record<string, unknown> = {}) {
		return { provider: 'testprovider', region: 'home', endpoint, credentials: { apiKey: KEY }, model: 'still-tasks', remoteId: 'task-7', ...overrides };
	}

	/** An answer in the form an image API that answers at once uses: each image as base64 or an address, or the error of one it refused. */
	interface ImageEntry {
		readonly b64_json?: string;
		readonly url?: string;
		readonly error?: { readonly message: string };
	}

	/** A module whose submit sends the create once and reads each entry of the answer as an output. */
	const answersAtOnce = {
		async submit(_request: unknown, http: Parameters<ReturnType<typeof testModule>['submit']>[1]) {
			const answer = (await http.create({ method: 'POST', path: '/images', body: { kind: 'json', value: {} } })).object();
			const outputs = (answer.data as ImageEntry[]).map((entry): OutputLocation => entry.b64_json !== undefined
				? { bytes: Buffer.from(entry.b64_json, 'base64'), format: 'png' }
				: entry.url !== undefined ? { url: entry.url } : { refused: entry.error?.message ?? '' });
			return { outputs };
		}
	};

	test('submit of a model that answers at once writes the images to their targets, keeps an address, and reports a refusal, in the provider\'s order', async () => {
		const server = await startServer(routed(answerImagesAtOnce({
			path: '/v1/images',
			images: [tinyPng(), tinyJpeg()],
			as: 'base64',
			shape: images => ({
				data: [
					{ b64_json: images[0] },
					{ url: 'https://cdn.example.com/kite-2.png?sig=1' },
					{ error: { message: `Output 3 was blocked by moderation for key ${KEY}.` } },
					{ b64_json: images[1] }
				]
			})
		})));
		try {
			const request = imageRequest(`${server.url}/v1`, 4);
			const [first, second, third, fourth] = request.targets;
			const answered = value(await commands(answersAtOnce).submit(request));
			assert.deepEqual({
				answered,
				files: [readFileSync(first).equals(tinyPng()), existsSync(second), existsSync(third), readFileSync(fourth).equals(tinyJpeg())],
				sent: server.received.map(entry => `${entry.method} ${entry.path} ${entry.headers.authorization}`)
			}, {
				answered: {
					outputs: [
						{ written: first, size: tinyPng().byteLength, format: 'png' },
						{ url: 'https://cdn.example.com/kite-2.png?sig=1' },
						{ refused: 'Output 3 was blocked by moderation for key ***.' },
						// The module said PNG; the bytes are a JPEG, and they decide.
						{ written: fourth, size: tinyJpeg().byteLength, format: 'jpeg' }
					]
				},
				files: [true, false, false, true],
				sent: [`POST /v1/images Bearer ${KEY}`]
			});
		} finally {
			await server.close();
		}
	});

	test('an output BaseHalf cannot keep is refused on its own with the reason, the others land, and it leaves no file', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		const large = Buffer.concat([tinyPng(), Buffer.alloc(300)]);
		const outputs: OutputLocation[] = [
			{ bytes: Buffer.from('<html>Service unavailable</html>') },
			{ bytes: tinyPng().subarray(0, 6) },
			{ bytes: large },
			{ url: 'http://cdn.example.com/kite.png' },
			{ url: `https://cdn.example.com/${'k'.repeat(9000)}.png` },
			{ refused: ' ' },
			{ bytes: tinyPng() }
		];
		try {
			const providers = commands({
				async submit(_request, http) {
					await http.create({ method: 'POST', path: '/images', body: { kind: 'json', value: {} } });
					return { outputs };
				}
			}, { download: { maxBytes: 200 } });
			const request = imageRequest(`${server.url}/v1`, 4, { params: { count: 4 }, targets: partTargets(7) });
			const answered = value(await providers.submit(request));
			assert.deepEqual({ answered, left: request.targets.map(target => existsSync(target)) }, {
				answered: {
					outputs: [
						{ refused: 'The file does not start like a PNG, JPEG, or WebP image.' },
						{ refused: 'The file is too short to be a PNG, JPEG, or WebP image.' },
						{ refused: `The image is ${large.byteLength} bytes, more than the 200 bytes BaseHalf downloads.` },
						{ refused: 'The provider gave an image address that does not start with https://.' },
						{ refused: 'The provider gave an image address longer than BaseHalf takes.' },
						{ refused: 'The provider refused this image.' },
						{ written: request.targets[6], size: tinyPng().byteLength, format: 'png' }
					]
				},
				left: [false, false, false, false, false, false, true]
			});
		} finally {
			await server.close();
		}
	});

	test('a target that is already there is not written over: its output is refused and the file kept', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const request = imageRequest(`${server.url}/v1`, 2);
			writeFileSync(request.targets[0], 'another file');
			const answered = value(await commands({
				async submit(_request, http) {
					await http.create({ method: 'POST', path: '/images', body: { kind: 'json', value: {} } });
					return { outputs: [{ bytes: tinyPng() }, { bytes: tinyPng() }] };
				}
			}).submit(request));
			const outputs = (answered as { outputs: { refused?: string }[] }).outputs;
			assert.match(outputs[0].refused ?? '', /^BaseHalf could not create the download file: /);
			assert.deepEqual({ second: outputs[1], kept: readFileSync(request.targets[0], 'utf8') }, {
				second: { written: request.targets[1], size: tinyPng().byteLength, format: 'png' },
				kept: 'another file'
			});
		} finally {
			await server.close();
		}
	});

	test('outputs beyond the targets are dropped, and the log says how many', async () => {
		const server = await startServer(routed(answerImagesAtOnce({
			path: '/v1/images',
			images: [tinyPng(), tinyPng(), tinyJpeg()],
			as: 'base64',
			shape: images => ({ data: [...images.map(b64_json => ({ b64_json })), { url: 'https://cdn.example.com/extra.png' }] })
		})));
		try {
			const lines: string[] = [];
			const request = imageRequest(`${server.url}/v1`, 2);
			const answered = value(await commands(answersAtOnce, { http: { log: { info: line => lines.push(line) } } }).submit(request));
			assert.deepEqual({ answered, dropped: lines.filter(line => line.startsWith('Dropped')) }, {
				answered: {
					outputs: [
						{ written: request.targets[0], size: tinyPng().byteLength, format: 'png' },
						{ written: request.targets[1], size: tinyPng().byteLength, format: 'png' }
					]
				},
				dropped: ['Dropped 2 of 4 outputs: the request names 2 files to write them to.']
			});
			assert.match(lines[0], /^POST \/v1\/images 200 \d+ ms$/);
		} finally {
			await server.close();
		}
	});

	test('a model that answers at once is sent nothing unless the request names a new .part file for each output it may make', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, { data: [] }));
		try {
			const providers = commands(answersAtOnce);
			const endpoint = `${server.url}/v1`;
			const refused = async (request: Record<string, unknown>) => error(await providers.submit(request));
			const [target] = partTargets(1);
			const outcomes = {
				none: await refused({ ...imageRequest(endpoint, 1), targets: undefined }),
				fewer: await refused({ ...imageRequest(endpoint, 3), targets: partTargets(2) }),
				empty: await refused({ ...imageRequest(endpoint, 1), targets: [] }),
				relative: await refused({ ...imageRequest(endpoint, 1), targets: ['output-1.part'] }),
				notPart: await refused({ ...imageRequest(endpoint, 1), targets: [target.replace(/\.part$/, '.png')] }),
				twice: await refused({ ...imageRequest(endpoint, 2), targets: [target, target] }),
				tooMany: await refused({ ...imageRequest(endpoint, 1), targets: partTargets(17) })
			};
			const invalid = { code: 'rejected', message: 'BaseHalf writes the outputs of a request only to new .part files, 1 to 16 of them, each named once.' };
			assert.deepEqual({ outcomes, sent: server.received.length }, {
				outcomes: {
					none: { code: 'rejected', message: 'Still 1 may make 1 file, but the request names none to write it to. BaseHalf sent nothing.' },
					fewer: { code: 'rejected', message: 'Still 1 may make 3 files, but the request names 2 to write them to. BaseHalf sent nothing.' },
					empty: invalid,
					relative: invalid,
					notPart: invalid,
					twice: invalid,
					tooMany: invalid
				},
				sent: 0
			});
		} finally {
			await server.close();
		}
	});

	test('files answered without a target fail the command: submit with an unknown outcome, poll as refused; addresses and refusals need none', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const endpoint = `${server.url}/v1`;
			const inline: OutputLocation[] = [{ url: 'https://cdn.example.com/1.png' }, { bytes: tinyPng() }];
			const providers = commands({
				async submit(_request, http) {
					await http.create({ method: 'POST', path: '/images', body: { kind: 'json', value: {} } });
					return { outputs: inline };
				},
				async poll(ref) {
					return { state: 'succeeded', outputs: ref.remoteId === 'task-inline' ? inline : [{ url: 'https://cdn.example.com/1.png' }, { refused: 'Blocked.' }] };
				}
			});
			// A model that runs as a task names no targets when it is sent.
			const submitted = error(await providers.submit({ ...imageRequest(endpoint, 1), model: 'still-tasks', targets: undefined }));
			const polled = error(await providers.poll(taskRef(endpoint, { remoteId: 'task-inline' })));
			const addresses = value(await providers.poll(taskRef(endpoint)));
			assert.deepEqual({ submitted, polled, addresses }, {
				submitted: { code: 'unknownOutcome', message: 'The provider answered with the files themselves, but the request names no file to write them to. They may have been made and charged; check the provider\'s console.' },
				polled: { code: 'rejected', message: 'The provider answered with the files themselves, but the request names no file to write them to.' },
				addresses: { state: 'succeeded', outputs: [{ url: 'https://cdn.example.com/1.png' }, { refused: 'Blocked.' }] }
			});
		} finally {
			await server.close();
		}
	});

	test('poll writes the files of a task that succeeded to the targets named with it, and keeps its addresses and refusals', async () => {
		const server = await startServer(routed(serveFiles({ '/files/2.png': tinyPng() })));
		try {
			const endpoint = `${server.url}/v1`;
			const providers = commands({
				async poll(ref) {
					if (ref.remoteId === 'task-running') {
						return { state: 'running', fraction: 0.4 };
					}
					return { state: 'succeeded', outputs: [{ bytes: tinyJpeg() }, { url: `${server.url}/files/2.png` }, { refused: 'The third image was blocked.' }] };
				}
			});
			const targets = partTargets(3);
			const running = value(await providers.poll(taskRef(endpoint, { remoteId: 'task-running', targets })));
			const succeeded = value(await providers.poll(taskRef(endpoint, { targets })));
			assert.deepEqual({ running, succeeded, written: readFileSync(targets[0]).equals(tinyJpeg()), others: [existsSync(targets[1]), existsSync(targets[2])] }, {
				running: { state: 'running', fraction: 0.4 },
				succeeded: {
					state: 'succeeded',
					outputs: [
						{ written: targets[0], size: tinyJpeg().byteLength, format: 'jpeg' },
						{ url: `${server.url}/files/2.png` },
						{ refused: 'The third image was blocked.' }
					]
				},
				written: true,
				others: [false, false]
			});
		} finally {
			await server.close();
		}
	});

	test('an address with headers of its own is downloaded into its target while the command runs, and its headers never leave the extension', async () => {
		const server = await startServer(routed(serveFiles({ '/v1/files/1.png': tinyPng() })));
		try {
			const endpoint = `${server.url}/v1`;
			const providers = commands({
				async poll() {
					return { state: 'succeeded', outputs: [{ url: `${server.url}/v1/files/1.png`, headers: { 'X-Files-Token': 'files-token-secret' } }] };
				}
			});
			const targets = partTargets(1);
			const answered = value(await providers.poll(taskRef(endpoint, { targets })));
			const download = server.received[0];
			assert.deepEqual({
				answered,
				token: download.headers['x-files-token'],
				key: download.headers.authorization ?? 'none',
				same: readFileSync(targets[0]).equals(tinyPng())
			}, {
				answered: { state: 'succeeded', outputs: [{ written: targets[0], size: tinyPng().byteLength, format: 'png' }] },
				token: 'files-token-secret',
				key: 'none',
				same: true
			});
			assert.ok(!JSON.stringify(answered).includes('files-token-secret'));
		} finally {
			await server.close();
		}
	});

	test('outputs a module answers in a form BaseHalf cannot read fail the command, and a module never answers a file already written', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const endpoint = `${server.url}/v1`;
			const answering = (outputs: unknown) => commands({
				async submit(_request, http) {
					await http.create({ method: 'POST', path: '/images', body: { kind: 'json', value: {} } });
					return { outputs } as never;
				},
				async poll() {
					return { state: 'succeeded', outputs } as never;
				}
			});
			const written = [{ written: '/tmp/output.part', size: 10, format: 'png' }];
			const twoShapes = [{ url: 'https://cdn.example.com/1.png', bytes: tinyPng() }];
			const notBytes = [{ bytes: 'iVBORw0KGgo=' }];
			const badFormat = [{ bytes: tinyPng(), format: 'gif' }];
			const outcomes = {
				submitWritten: error(await answering(written).submit(imageRequest(endpoint, 1))),
				submitTwoShapes: error(await answering(twoShapes).submit(imageRequest(endpoint, 1))).code,
				submitNotBytes: error(await answering(notBytes).submit(imageRequest(endpoint, 1))).code,
				submitBadFormat: error(await answering(badFormat).submit(imageRequest(endpoint, 1))).code,
				submitNoList: error(await answering('three images').submit(imageRequest(endpoint, 1))),
				pollWritten: error(await answering(written).poll(taskRef(endpoint, { targets: partTargets(1) })))
			};
			assert.deepEqual(outcomes, {
				submitWritten: { code: 'unknownOutcome', message: 'The provider accepted the request but answered files BaseHalf cannot read.' },
				submitTwoShapes: 'unknownOutcome',
				submitNotBytes: 'unknownOutcome',
				submitBadFormat: 'unknownOutcome',
				submitNoList: { code: 'unknownOutcome', message: 'The provider accepted the request but gave no task id BaseHalf can read.' },
				pollWritten: { code: 'invalidResponse', message: 'The provider answered files BaseHalf cannot read.' }
			});
		} finally {
			await server.close();
		}
	});

	test('the ten-minute wait is the create\'s time for a model that answers at once, and not for a model that runs as a task', async () => {
		const seen: Record<string, [boolean, number]> = {};
		const providers = commands({
			async submit(request, http) {
				seen[request.model] = [(http as BoundHttp).answersAtOnce, (http as BoundHttp).createTimeoutMs];
				return request.model === 'still-1' ? { outputs: [{ refused: 'Not made.' }] } : 'task-1';
			}
		});
		// Nothing is sent: the module answers without a request.
		const endpoint = 'https://api.example.com/v1';
		value(await providers.submit(imageRequest(endpoint, 1)));
		value(await providers.submit({ ...imageRequest(endpoint, 1), model: 'still-tasks' }));
		value(await providers.submit({ ...imageRequest(endpoint, 1), model: 'clip-1', mode: 'frames', params: {}, targets: undefined }));
		assert.deepEqual(seen, {
			'still-1': [true, 10 * 60 * 1000],
			'still-tasks': [false, 2 * 60 * 1000],
			'clip-1': [false, 2 * 60 * 1000]
		});
	});

	test('download takes the kind of the model and an image\'s address, answers its format, and needs no task id for an address', async () => {
		const cdn = await startServer(routed(serveFiles({ '/1.png': tinyPng(), '/2.jpg': tinyJpeg(), '/page.html': Buffer.from('<html>expired</html>') })));
		try {
			const providers = commands();
			const endpoint = 'https://api.example.com/v1';
			const image = (path: string, overrides: Record<string, unknown> = {}) => ({ ...taskRef(endpoint), kind: 'image', url: `${cdn.url}${path}`, targetFsPath: partTargets(1)[0], ...overrides });
			const outcomes = {
				png: value(await providers.download(image('/1.png'))),
				jpeg: value(await providers.download(image('/2.jpg', { remoteId: undefined }))),
				emptyTaskId: value(await providers.download(image('/1.png', { remoteId: '' }))),
				page: error(await providers.download(image('/page.html'))),
				withoutKind: error(await providers.download(image('/1.png', { kind: undefined }))),
				videoOfImageModel: error(await providers.download(image('/1.png', { kind: 'video' }))),
				imageOfVideoModel: error(await providers.download(image('/1.png', { model: 'clip-1' }))),
				withoutAddress: error(await providers.download(image('/1.png', { url: undefined }))),
				oddKind: error(await providers.download(image('/1.png', { kind: 'audio' }))).code,
				pollWithoutTaskId: error(await providers.poll({ ...taskRef(endpoint), remoteId: undefined })).code
			};
			assert.deepEqual({ outcomes, keySent: cdn.received.some(entry => entry.headers.authorization !== undefined) }, {
				outcomes: {
					png: { size: tinyPng().byteLength, format: 'png' },
					jpeg: { size: tinyJpeg().byteLength, format: 'jpeg' },
					emptyTaskId: { size: tinyPng().byteLength, format: 'png' },
					page: { code: 'notImage', message: 'The file does not start like a PNG, JPEG, or WebP image.' },
					withoutKind: { code: 'rejected', message: 'Still Tasks makes images; BaseHalf downloads only a file of that kind for it.' },
					videoOfImageModel: { code: 'rejected', message: 'Still Tasks makes images; BaseHalf downloads only a file of that kind for it.' },
					imageOfVideoModel: { code: 'rejected', message: 'Clip 1 makes videos; BaseHalf downloads only a file of that kind for it.' },
					withoutAddress: { code: 'rejected', message: 'BaseHalf downloads an image only from the address the provider gave.' },
					oddKind: 'rejected',
					pollWithoutTaskId: 'rejected'
				},
				keySent: false
			});
		} finally {
			await cdn.close();
		}
	});
});

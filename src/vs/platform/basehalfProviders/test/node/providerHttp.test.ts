/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { plainMessage, ProviderFailure } from '../../node/failure.js';
import { BoundHttp, boundToCall, DEFAULT_HTTP_OPTIONS, parseEndpoint, resolveHttpOptions, retryAfterMs, type HttpOptions } from '../../node/http.js';
import { recordingSleep, sendJson, startServer } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerHttp', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function bound(endpoint: string, options: HttpOptions = {}, readError?: (status: number, body: unknown) => { message?: string; code?: 'balance' } | undefined): BoundHttp {
		return new BoundHttp(parseEndpoint(endpoint), () => ({ Authorization: 'Bearer sk-test-secret' }), readError, resolveHttpOptions(options));
	}

	async function failure(promise: Promise<unknown>): Promise<ProviderFailure> {
		try {
			await promise;
		} catch (caught) {
			assert.ok(caught instanceof ProviderFailure, `expected a ProviderFailure, got ${String(caught)}`);
			return caught;
		}
		assert.fail('expected a failure');
	}

	test('a call\'s requests end with its token: one that runs is torn down, none starts after, and a wait before a retry ends (D75)', async () => {
		// The server never answers: only the end of the call ends the request.
		const server = await startServer(() => undefined);
		const source = new CancellationTokenSource();
		try {
			const http = new BoundHttp(parseEndpoint(`${server.url}/api`), () => ({ Authorization: 'Bearer sk-test-secret' }), undefined, boundToCall(resolveHttpOptions({ sleep: () => new Promise<void>(() => undefined) }), source.token));
			const running = failure(http.requestOnce({ method: 'GET', path: '/tasks/1' }));
			for (let tries = 0; server.received.length === 0 && tries < 200; tries++) {
				await new Promise(resolve => setTimeout(resolve, 5));
			}
			const waiting = http.wait(1000).then(() => 'slept', (error: unknown) => isCancellationError(error) ? 'ended' : String(error));
			source.cancel();
			const ended = await running;
			const after = await failure(http.requestOnce({ method: 'GET', path: '/tasks/2' }));
			assert.deepEqual({
				ended: [ended.code, ended.message.includes('The window that asked for this is gone.')],
				after: [after.code, after.message.includes('The window that asked for this is gone.')],
				waiting: await waiting,
				received: server.received.map(entry => entry.path)
			}, {
				ended: ['network', true],
				after: ['rejected', true],
				waiting: 'ended',
				received: ['/api/tasks/1']
			});
		} finally {
			source.dispose();
			await server.close();
		}
	});

	test('a request is retried three times, 1, 2, then 4 seconds apart, on 503, and then fails as a network error', async () => {
		const server = await startServer((request, response) => sendJson(response, 503, { error: { message: 'Busy.' } }));
		try {
			const sleep = recordingSleep();
			const failed = await failure(bound(`${server.url}/api`, { sleep: sleep.sleep }).request({ method: 'GET', path: '/tasks/1' }));
			assert.deepEqual({ code: failed.code, status: failed.status, message: failed.message, waits: sleep.waits, received: server.received.length }, {
				code: 'network', status: 503, message: 'Busy.', waits: [1000, 2000, 4000], received: 4
			});
		} finally {
			await server.close();
		}
	});

	test('a request is retried on 408, 429, 500, 502, and 504, and on a dropped connection, and answers once it gets through', async () => {
		const statuses = [408, 429, 500, 502, 504];
		let calls = 0;
		const server = await startServer((request, response, socket) => {
			calls++;
			if (calls === 1) {
				socket.destroy();
				return;
			}
			if (calls <= 1 + statuses.length) {
				sendJson(response, statuses[calls - 2], {});
				return;
			}
			sendJson(response, 200, { status: 'running' });
		});
		try {
			const sleep = recordingSleep();
			const http = bound(`${server.url}/api`, { sleep: sleep.sleep, retryDelaysMs: [1, 2, 3, 4, 5, 6] });
			const answer = await http.request({ method: 'GET', path: '/tasks/1' });
			assert.deepEqual({ status: answer.status, body: answer.object(), waits: sleep.waits, calls }, { status: 200, body: { status: 'running' }, waits: [1, 2, 3, 4, 5, 6], calls: 7 });
		} finally {
			await server.close();
		}
	});

	test('Retry-After is honored up to 30 seconds; a longer one ends the retries with the wait it asks for', async () => {
		let calls = 0;
		const server = await startServer((request, response) => {
			calls++;
			if (request.path.startsWith('/api/short')) {
				if (calls === 1) {
					sendJson(response, 429, {}, { 'Retry-After': '7' });
				} else {
					sendJson(response, 200, { ok: true });
				}
				return;
			}
			sendJson(response, 429, { error: { message: 'RPM limit of 180 exceeded.' } }, { 'Retry-After': '120' });
		});
		try {
			const sleep = recordingSleep();
			const http = bound(`${server.url}/api`, { sleep: sleep.sleep });
			await http.request({ method: 'GET', path: '/short' });
			const waitedShort = [...sleep.waits];
			calls = 0;
			const long = await failure(http.request({ method: 'GET', path: '/long' }));
			assert.deepEqual({ waitedShort, waitsAfter: sleep.waits.length, calls, code: long.code, message: long.message }, {
				waitedShort: [7000],
				waitsAfter: 1,
				calls: 1,
				code: 'rateLimited',
				message: 'RPM limit of 180 exceeded. The provider asks to wait 120 seconds.'
			});
			assert.equal(retryAfterMs('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 30_000);
			assert.equal(retryAfterMs(undefined), undefined);
		} finally {
			await server.close();
		}
	});

	test('a request that creates a task is sent once: a server error or a dropped connection leaves its outcome unknown', async () => {
		const server = await startServer((request, response, socket) => {
			if (request.path.endsWith('/drop')) {
				socket.destroy();
			} else if (request.path.endsWith('/busy')) {
				sendJson(response, 429, { error: { message: 'Too many tasks in the queue.' } });
			} else {
				sendJson(response, 503, { error: { message: 'Service unavailable.' } });
			}
		});
		try {
			const sleep = recordingSleep();
			const outcome = async (path: string) => {
				const failed = await failure(bound(`${server.url}/api`, { sleep: sleep.sleep }).create({ method: 'POST', path, body: { kind: 'json', value: { prompt: 'p' } } }));
				return [failed.code, failed.status];
			};
			const dropped = await outcome('/drop');
			const serverError = await outcome('/error');
			const busy = await outcome('/busy');
			assert.deepEqual({ dropped, serverError, busy, received: server.received.length, waits: sleep.waits }, {
				dropped: ['unknownOutcome', undefined],
				serverError: ['unknownOutcome', 503],
				busy: ['rateLimited', 429],
				received: 3,
				waits: []
			});
		} finally {
			await server.close();
		}
		// A create that never connected did not go out.
		const refused = await failure(bound(`${server.url}/api`).create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: {} } }));
		assert.equal(refused.code, 'network');
	});

	test('a create whose answer never comes within its time has an unknown outcome', async () => {
		const server = await startServer(() => { /* never answers */ });
		try {
			const failed = await failure(bound(`${server.url}/api`, { createTimeoutMs: 100 }).create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: {} } }));
			assert.equal(failed.code, 'unknownOutcome');
			assert.match(failed.message, /^The connection ended after the request was sent: No answer came in time/);
		} finally {
			await server.close();
		}
	});

	test('a create may take ten minutes for its whole answer when the model answers at once, and two minutes without a byte otherwise', () => {
		const endpoint = parseEndpoint('https://api.example.com/v1');
		const authorize = () => ({ Authorization: 'Bearer sk-test-secret' });
		const atOnce = new BoundHttp(endpoint, authorize, undefined, resolveHttpOptions({}), true);
		const tasks = new BoundHttp(endpoint, authorize, undefined, resolveHttpOptions({}));
		assert.deepEqual({
			atOnce: [atOnce.answersAtOnce, atOnce.createTimeoutMs],
			tasks: [tasks.answersAtOnce, tasks.createTimeoutMs],
			answers: [DEFAULT_HTTP_OPTIONS.maxAnswerBytes, DEFAULT_HTTP_OPTIONS.maxAtOnceAnswerBytes]
		}, {
			atOnce: [true, 10 * 60 * 1000],
			tasks: [false, 2 * 60 * 1000],
			answers: [4 * 1024 * 1024, 256 * 1024 * 1024]
		});
	});

	test('the create of a model that answers at once ends when its whole answer has not come in its time, however the bytes trickle in', async () => {
		// An answer that sends a byte every 20 ms and ends after 800 ms: never quiet, but slow.
		const server = await startServer((request, response) => {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.write('{"id": "t-1"');
			let sent = 0;
			const timer = setInterval(() => {
				if (++sent < 40) {
					response.write(' ');
				} else {
					clearInterval(timer);
					response.end('}');
				}
			}, 20);
			response.on('close', () => clearInterval(timer));
		});
		try {
			const create = (answersAtOnce: boolean) => new BoundHttp(parseEndpoint(`${server.url}/api`), () => ({}), undefined, resolveHttpOptions({ createTimeoutMs: 400, atOnceTimeoutMs: 400 }), answersAtOnce)
				.create({ method: 'POST', path: '/images', body: { kind: 'json', value: {} } });
			const tasks = (await create(false)).object();
			const atOnce = await failure(create(true));
			assert.deepEqual({ tasks, atOnce: atOnce.code, received: server.received.length }, { tasks: { id: 't-1' }, atOnce: 'unknownOutcome', received: 2 });
			assert.match(atOnce.message, /^The connection ended after the request was sent: /);
		} finally {
			await server.close();
		}
	});

	test('the create of a model that answers at once reads a larger answer, unless the call sets its own limit', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, { data: [{ b64_json: 'A'.repeat(5000) }] }));
		try {
			const options = resolveHttpOptions({ maxAnswerBytes: 1000, maxAtOnceAnswerBytes: 10_000 });
			const http = (answersAtOnce: boolean) => new BoundHttp(parseEndpoint(`${server.url}/api`), () => ({}), undefined, options, answersAtOnce);
			const call = { method: 'POST', path: '/images', body: { kind: 'json', value: {} } } as const;
			const atOnce = (await http(true).create(call)).object();
			const tasks = await failure(http(false).create(call));
			const ownLimit = await failure(http(true).create({ ...call, maxAnswerBytes: 1000 }));
			const poll = await failure(http(true).request({ method: 'GET', path: '/images' }));
			assert.deepEqual({ atOnce: Array.isArray(atOnce.data), tasks: tasks.code, ownLimit: ownLimit.code, poll: poll.code }, {
				atOnce: true,
				tasks: 'unknownOutcome',
				ownLimit: 'unknownOutcome',
				poll: 'invalidResponse'
			});
		} finally {
			await server.close();
		}
	});

	test('a command sends at most one create, and requestOnce is not retried', async () => {
		const server = await startServer((request, response) => sendJson(response, request.method === 'DELETE' ? 503 : 200, { id: 't-1' }));
		try {
			const sleep = recordingSleep();
			const http = bound(`${server.url}/api`, { sleep: sleep.sleep });
			await http.create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: {} } });
			await assert.rejects(http.create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: {} } }), /at most one request that creates a task/);
			const once = await failure(http.requestOnce({ method: 'DELETE', path: '/tasks/t-1' }));
			assert.deepEqual({ code: once.code, received: server.received.length, waits: sleep.waits, answered: http.createAnswered }, { code: 'network', received: 2, waits: [], answered: true });
		} finally {
			await server.close();
		}
	});

	test('wait goes through the sleep of the options, as the retries do, and sends nothing', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const sleep = recordingSleep();
			const http = bound(`${server.url}/api`, { sleep: sleep.sleep });
			await http.wait(2000);
			await http.wait(-5);
			await http.wait(Number.NaN);
			assert.deepEqual({ waits: sleep.waits, received: server.received.length }, { waits: [2000, 0, 0], received: 0 });
		} finally {
			await server.close();
		}
	});

	test('retry runs a group of requests again as a whole, under the retry rule of a request, and never a group that created a task', async () => {
		let uploads = 0;
		const server = await startServer((request, response, socket) => {
			if (request.path.endsWith('/slot')) {
				sendJson(response, 200, { slot: server.received.filter(entry => entry.path.endsWith('/slot')).length });
			} else if (request.path.endsWith('/upload')) {
				uploads++;
				if (uploads === 1) {
					socket.destroy();
				} else if (uploads === 2) {
					sendJson(response, 503, {});
				} else if (uploads === 3) {
					sendJson(response, 429, {}, { 'Retry-After': '3' });
				} else {
					response.writeHead(204);
					response.end();
				}
			} else if (request.path.endsWith('/refused')) {
				sendJson(response, 400, { error: { message: 'Bad file.' } });
			} else if (request.path.endsWith('/slow')) {
				sendJson(response, 429, { error: { message: 'Too many uploads.' } }, { 'Retry-After': '120' });
			} else if (request.path.endsWith('/tasks')) {
				sendJson(response, 200, { id: 't-1' });
			} else {
				sendJson(response, 503, { error: { message: 'Busy.' } });
			}
		});
		try {
			const sleep = recordingSleep();
			const http = bound(`${server.url}/api`, { sleep: sleep.sleep });
			// Each attempt asks for a new slot, then uploads to it once.
			const group = async () => {
				const slot = (await http.requestOnce({ method: 'POST', path: '/slot' })).object().slot;
				const answer = await http.requestOnce({ method: 'POST', path: '/upload' });
				return { slot, status: answer.status };
			};
			const uploaded = await http.retry(group);
			const waitsOfUpload = [...sleep.waits];
			const refused = await failure(http.retry(() => http.requestOnce({ method: 'POST', path: '/refused' })));
			const slow = await failure(http.retry(() => http.requestOnce({ method: 'POST', path: '/slow' })));
			sleep.waits.length = 0;
			// A request whose own retries are spent is not sent again by the group around it, nor by a group around that.
			const spent = await failure(http.retry(() => http.retry(() => http.request({ method: 'GET', path: '/busy' }))));
			const busyCalls = server.received.filter(entry => entry.path.endsWith('/busy')).length;
			const waitsOfSpent = [...sleep.waits];
			sleep.waits.length = 0;
			const once = await failure(http.retry(() => http.retry(() => http.requestOnce({ method: 'GET', path: '/busy-once' }))));
			const onceCalls = server.received.filter(entry => entry.path.endsWith('/busy-once')).length;
			const waitsOfOnce = [...sleep.waits];
			sleep.waits.length = 0;
			const afterCreate = await failure(http.retry(async () => {
				await http.create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: {} } });
				return http.requestOnce({ method: 'GET', path: '/after-create' });
			}));
			assert.deepEqual({
				uploaded,
				waitsOfUpload,
				slots: server.received.filter(entry => entry.path.endsWith('/slot')).length,
				refused: [refused.code, refused.message, server.received.filter(entry => entry.path.endsWith('/refused')).length],
				slow: [slow.code, slow.message, server.received.filter(entry => entry.path.endsWith('/slow')).length],
				spent: [spent.code, spent.status, busyCalls, waitsOfSpent],
				once: [once.code, once.status, onceCalls, waitsOfOnce],
				afterCreate: [afterCreate.code, afterCreate.status, server.received.filter(entry => entry.path.endsWith('/tasks')).length, sleep.waits]
			}, {
				uploaded: { slot: 4, status: 204 },
				waitsOfUpload: [1000, 2000, 3000],
				slots: 4,
				refused: ['rejected', 'Bad file.', 1],
				slow: ['rateLimited', 'Too many uploads. The provider asks to wait 120 seconds.', 1],
				spent: ['network', 503, 4, [1000, 2000, 4000]],
				once: ['network', 503, 4, [1000, 2000, 4000]],
				afterCreate: ['network', 503, 1, []]
			});
		} finally {
			await server.close();
		}
	});

	test('error answers map to the contract codes with the provider\'s message', async () => {
		const server = await startServer((request, response) => {
			const status = Number(request.path.split('/').at(-1));
			sendJson(response, status, status === 400 ? { error: { code: 'InvalidParameter', message: 'The parameter ratio is not valid.' } } : status === 418 ? { error: { code: 'NoMoney', message: 'Top up first.' } } : {});
		});
		try {
			const http = bound(`${server.url}/api`, { sleep: async () => undefined }, (status, body) => status === 418 ? { message: (body as { error: { message: string } }).error.message, code: 'balance' } : undefined);
			const codes: Record<string, unknown> = {};
			for (const status of [400, 401, 402, 403, 404, 409, 418, 422, 429]) {
				const failed = await failure(http.request({ method: 'GET', path: `/status/${status}` }));
				codes[status] = [failed.code, failed.message];
			}
			const createNotFound = await failure(bound(`${server.url}/api`).create({ method: 'POST', path: '/status/404', body: { kind: 'json', value: {} } }));
			assert.deepEqual(codes, {
				400: ['rejected', 'The provider answered with HTTP 400.'],
				401: ['auth', 'The provider answered with HTTP 401.'],
				402: ['balance', 'The provider answered with HTTP 402.'],
				403: ['auth', 'The provider answered with HTTP 403.'],
				404: ['notFound', 'The provider answered with HTTP 404.'],
				409: ['rejected', 'The provider answered with HTTP 409.'],
				418: ['balance', 'Top up first.'],
				422: ['rejected', 'The provider answered with HTTP 422.'],
				429: ['rateLimited', 'The provider answered with HTTP 429.']
			});
			assert.equal(createNotFound.code, 'rejected');
			// The common shapes of an error answer are read without a module's reader.
			const message = await failure(bound(`${server.url}/api`).request({ method: 'GET', path: '/status/400' }));
			assert.deepEqual([message.code, message.message, message.status], ['rejected', 'The parameter ratio is not valid.', 400]);
		} finally {
			await server.close();
		}
	});

	test('an answer is read up to its size cap, a redirect is never followed, and an answer that is not JSON is unreadable', async () => {
		const server = await startServer((request, response) => {
			if (request.path.endsWith('/large')) {
				sendJson(response, 200, { padding: 'x'.repeat(5000) });
			} else if (request.path.endsWith('/moved')) {
				response.writeHead(302, { Location: '/elsewhere' });
				response.end();
			} else {
				response.writeHead(200, { 'Content-Type': 'text/html' });
				response.end('<html>gateway</html>');
			}
		});
		try {
			const http = bound(`${server.url}/api`, { maxAnswerBytes: 1000 });
			const large = await failure(http.request({ method: 'GET', path: '/large' }));
			const moved = await failure(http.request({ method: 'GET', path: '/moved' }));
			const html = await http.request({ method: 'GET', path: '/html' });
			const notJson = (() => {
				try {
					html.object();
					return undefined;
				} catch (caught) {
					return (caught as ProviderFailure).code;
				}
			})();
			const createdHtml = await bound(`${server.url}/api`).create({ method: 'POST', path: '/html', body: { kind: 'json', value: {} } });
			assert.throws(() => createdHtml.object(), (caught: ProviderFailure) => caught.code === 'unknownOutcome');
			assert.deepEqual({ large: large.code, moved: moved.code, notJson, paths: server.received.map(entry => entry.path) }, {
				large: 'invalidResponse',
				moved: 'invalidResponse',
				notJson: 'invalidResponse',
				paths: ['/api/large', '/api/moved', '/api/html', '/api/html']
			});
		} finally {
			await server.close();
		}
	});

	test('the credential headers go to the endpoint\'s origin only, and bodies are sent as JSON, multipart forms, or raw bytes', async () => {
		const other = await startServer((request, response) => sendJson(response, 200, {}));
		const api = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const http = bound(`${api.url}/api/v3/`);
			await http.request({ method: 'POST', path: '/json', query: { task_id: 'a b' }, body: { kind: 'json', value: { model: 'm' } } });
			await http.request({ method: 'POST', path: '/form', body: { kind: 'form', parts: [{ name: 'model', value: 'm' }, { name: 'file', file: { bytes: Buffer.from('PNG'), fileName: 'a"b.png', contentType: 'image/png' } }] } });
			await http.request({ method: 'PUT', url: `${other.url}/upload?signature=s`, body: { kind: 'bytes', bytes: Buffer.from('raw bytes'), contentType: 'application/octet-stream' } });
			const [json, form] = api.received;
			const upload = other.received[0];
			assert.deepEqual({
				endpoint: http.endpoint.href,
				jsonPath: json.path,
				jsonType: json.headers['content-type'],
				jsonBody: JSON.parse(json.body.toString('utf8')),
				formType: /^multipart\/form-data; boundary=----BaseHalf[0-9a-f]{32}$/.test(String(form.headers['content-type'])),
				formBody: /name="model"\r\n\r\nm\r\n/.test(form.body.toString('utf8')) && /name="file"; filename="a_b.png"\r\nContent-Type: image\/png\r\n\r\nPNG\r\n/.test(form.body.toString('utf8')),
				keyToApi: api.received.map(entry => entry.headers.authorization),
				uploadKey: upload.headers.authorization ?? null,
				uploadPath: upload.path,
				uploadBody: upload.body.toString('utf8'),
				secrets: [...http.secretValues]
			}, {
				endpoint: `${api.url}/api/v3`,
				jsonPath: '/api/v3/json?task_id=a+b',
				jsonType: 'application/json',
				jsonBody: { model: 'm' },
				formType: true,
				formBody: true,
				keyToApi: ['Bearer sk-test-secret', 'Bearer sk-test-secret'],
				uploadKey: null,
				uploadPath: '/upload?signature=s',
				uploadBody: 'raw bytes',
				secrets: ['sk-test-secret']
			});
		} finally {
			await api.close();
			await other.close();
		}
	});

	test('the log gets the method, the path without its query, the status, and the time, and nothing else', async () => {
		const server = await startServer((request, response) => sendJson(response, request.path.includes('missing') ? 404 : 200, {}));
		try {
			const lines: string[] = [];
			const http = bound(`${server.url}/api`, { log: { info: line => lines.push(line) } });
			await http.request({ method: 'GET', path: '/tasks/t-1', query: { key: 'sk-test-secret' } });
			await failure(http.request({ method: 'GET', path: '/missing' }));
			assert.equal(lines.length, 2);
			assert.match(lines[0], /^GET \/api\/tasks\/t-1 200 \d+ ms$/);
			assert.match(lines[1], /^GET \/api\/missing 404 \d+ ms$/);
			assert.ok(lines.every(line => !line.includes('secret') && !line.includes('127.0.0.1')));
		} finally {
			await server.close();
		}
	});

	test('endpoints are https, or http on this computer, without credentials, query, or fragment', () => {
		assert.equal(parseEndpoint('https://ark.cn-beijing.volces.com/api/v3/').href, 'https://ark.cn-beijing.volces.com/api/v3');
		assert.equal(parseEndpoint('http://127.0.0.1:8123/api/v3').href, 'http://127.0.0.1:8123/api/v3');
		assert.equal(parseEndpoint('http://localhost:8123').origin, 'http://localhost:8123');
		for (const endpoint of ['http://relay.example.com/api/v3', 'https://user:pass@relay.example.com', 'https://relay.example.com/api?x=1', 'ftp://relay.example.com', 'relay.example.com']) {
			assert.throws(() => parseEndpoint(endpoint), (caught: ProviderFailure) => caught.code === 'rejected', endpoint);
		}
	});

	test('an API path is joined to an endpoint without a path, with or without its last slash, and to one with a path', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, { ok: true }));
		try {
			for (const endpoint of [server.url, `${server.url}/`, `${server.url}/api/v3/`]) {
				await bound(endpoint).request({ method: 'GET', path: '/tasks/1' });
			}
			assert.deepEqual(server.received.map(entry => entry.path), ['/tasks/1', '/tasks/1', '/api/v3/tasks/1']);
		} finally {
			await server.close();
		}
	});

	test('messages are plain text of at most 1,000 characters, without secrets, markup, or inline media', () => {
		const image = `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
		assert.equal(plainMessage(`Bad key Bearer sk-very-secret-123 in <b>request</b>\n${image} done`, ['sk-very-secret-123']), 'Bad key Bearer *** in request (data) done');
		assert.equal(plainMessage(`token ${'A'.repeat(200)} end`, []), 'token … end');
		assert.equal(plainMessage('word '.repeat(1000), []).length, 1000);
		assert.equal(plainMessage('short abc', ['abc']), 'short abc');
	});
});

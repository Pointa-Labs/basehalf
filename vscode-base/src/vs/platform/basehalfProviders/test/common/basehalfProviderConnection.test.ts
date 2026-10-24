/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { ChannelClient, ChannelServer, IMessagePassingProtocol } from '../../../../base/parts/ipc/common/ipc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BaseHalfProviderChannel, BaseHalfProviderChannelClient } from '../../common/basehalfProviderChannel.js';
import { BaseHalfProviderConnection } from '../../common/basehalfProviderConnection.js';
import { BASEHALF_PROVIDERS_CHANNEL, IBaseHalfProviderService } from '../../common/basehalfProviders.js';
import type { CheckPayload, DownloadRequest, PlaceRequest, ProviderResponse, SubmitPayload, TaskRef, VoicePreviewRequest, VoicePreviewResult, VoicesRequest } from '../../common/basehalfProviderTypes.js';

type Service = Omit<IBaseHalfProviderService, '_serviceBrand'>;

suite('BaseHalfProviderConnection', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** A service whose calls answer `{ ok: true, value: <call> }`, or never when `hang` holds the call's name. */
	function service(hang: ReadonlySet<string> = new Set()): Service {
		const answer = (name: string) => hang.has(name) ? new Promise<never>(() => undefined) : Promise.resolve({ ok: true as const, value: name as never });
		return {
			catalog: () => answer('catalog'),
			check: () => answer('check'),
			submit: () => answer('submit'),
			poll: () => answer('poll'),
			download: () => answer('download'),
			cancel: () => answer('cancel'),
			place: () => answer('place'),
			voices: () => answer('voices'),
			voicePreview: () => answer('voicePreview')
		};
	}

	const SUBMIT = {} as SubmitPayload;
	const TASK = {} as TaskRef;
	const VOICES = {} as VoicesRequest;
	const SAMPLE = {} as VoicePreviewRequest;

	test('answers as the service does while the shared process runs', async () => {
		const stopped = store.add(new Emitter<void>());
		const connection = store.add(new BaseHalfProviderConnection(service(), stopped.event, Promise.resolve(false)));
		assert.deepStrictEqual([await connection.catalog(), await connection.submit(SUBMIT), await connection.poll(TASK), await connection.voices(VOICES), await connection.voicePreview(SAMPLE)], [
			{ ok: true, value: 'catalog' },
			{ ok: true, value: 'submit' },
			{ ok: true, value: 'poll' },
			{ ok: true, value: 'voices' },
			{ ok: true, value: 'voicePreview' }
		]);
	});

	test('fails every waiting call at once when the shared process stopped, and every later call (D75)', async () => {
		const stopped = store.add(new Emitter<void>());
		const connection = store.add(new BaseHalfProviderConnection(service(new Set(['submit', 'poll', 'voicePreview'])), stopped.event, Promise.resolve(false)));
		const outcome = (call: Promise<unknown>) => call.then(() => 'answered', (error: Error) => error.message);
		const waiting = [outcome(connection.submit(SUBMIT)), outcome(connection.poll(TASK)), outcome(connection.voicePreview(SAMPLE))];
		stopped.fire();
		const later = await outcome(connection.voices(VOICES));
		const message = 'BaseHalf\'s background process stopped. Restart BaseHalf to continue.';
		assert.deepStrictEqual([...await Promise.all(waiting), later], [message, message, message, message]);
	});

	test('fails every call in a window opened after the shared process stopped', async () => {
		const stopped = store.add(new Emitter<void>());
		const connection = store.add(new BaseHalfProviderConnection(service(new Set(['catalog'])), stopped.event, Promise.resolve(true)));
		await Promise.resolve();
		await assert.rejects(connection.catalog(), /background process stopped/);
	});
});

suite('BaseHalfProviderChannel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('gives the calls that send requests their cancellation, which ends with the window that made them (D75)', async () => {
		const seen: string[] = [];
		const token = (value: CancellationToken | undefined) => value === undefined ? 'none' : value.isCancellationRequested ? 'ended' : 'running';
		const recorded: Service = {
			catalog: async () => { seen.push('catalog'); return { ok: true, value: undefined as never }; },
			check: async (request: CheckPayload) => { seen.push(`check ${JSON.stringify(request)}`); return { ok: true, value: undefined as never }; },
			submit: async (request: SubmitPayload, cancellation?: CancellationToken) => { seen.push(`submit ${JSON.stringify(request)} ${token(cancellation)}`); return { ok: true, value: undefined as never }; },
			poll: async (task: TaskRef, cancellation?: CancellationToken) => { seen.push(`poll ${JSON.stringify(task)} ${token(cancellation)}`); return { ok: true, value: undefined as never }; },
			download: async (request: DownloadRequest, cancellation?: CancellationToken) => { seen.push(`download ${JSON.stringify(request)} ${token(cancellation)}`); return { ok: true, value: undefined as never }; },
			cancel: async (task: TaskRef, cancellation?: CancellationToken) => { seen.push(`cancel ${JSON.stringify(task)} ${token(cancellation)}`); return { ok: true, value: undefined as never }; },
			place: async (request: PlaceRequest) => { seen.push(`place ${JSON.stringify(request)}`); return { ok: true, value: undefined as never }; },
			voices: async (request: VoicesRequest, cancellation?: CancellationToken) => { seen.push(`voices ${JSON.stringify(request)} ${token(cancellation)}`); return { ok: true, value: undefined as never }; },
			voicePreview: async (request: VoicePreviewRequest, cancellation?: CancellationToken) => { seen.push(`voicePreview ${JSON.stringify(request)} ${token(cancellation)}`); return { ok: false, error: { code: 'notAudio', message: 'Not a sound.' } }; }
		};
		const channel = new BaseHalfProviderChannel(recorded as IBaseHalfProviderService);
		const source = new CancellationTokenSource();
		const ended = new CancellationTokenSource();
		ended.cancel();
		try {
			await channel.call('window:1', 'catalog', []);
			await channel.call('window:1', 'check', [{ a: 1 }], source.token);
			await channel.call('window:1', 'submit', [{ b: 2 }], source.token);
			await channel.call('window:1', 'poll', [{ c: 3 }], ended.token);
			await channel.call('window:1', 'download', [{ d: 4 }], source.token);
			await channel.call('window:1', 'cancel', [{ e: 5 }], source.token);
			await channel.call('window:1', 'place', [{ f: 6 }], source.token);
			await channel.call('window:1', 'voices', [{ g: 7 }], source.token);
			await channel.call('window:1', 'voicePreview', [{ h: 8 }], ended.token);
			await assert.rejects(channel.call('window:1', 'unknown', []), /no call 'unknown'/);
			assert.throws(() => channel.listen('window:1', 'onDidChange'), /no event 'onDidChange'/);
			assert.deepStrictEqual(seen, [
				'catalog',
				'check {"a":1}',
				'submit {"b":2} running',
				'poll {"c":3} ended',
				'download {"d":4} running',
				'cancel {"e":5} running',
				'place {"f":6}',
				'voices {"g":7} running',
				'voicePreview {"h":8} ended'
			]);
		} finally {
			source.dispose();
			ended.dispose();
		}
	});

	/** Two ends of a connection between processes that hold each message until the other end listens, as VS Code's own tests of the channel do. */
	class QueueProtocol implements IMessagePassingProtocol {
		private buffering = true;
		private buffers: VSBuffer[] = [];
		private readonly emitter = new Emitter<VSBuffer>({
			onDidAddFirstListener: () => {
				for (const buffer of this.buffers) {
					this.emitter.fire(buffer);
				}
				this.buffers = [];
				this.buffering = false;
			},
			onDidRemoveLastListener: () => {
				this.buffering = true;
			}
		});
		readonly onMessage = this.emitter.event;
		other: QueueProtocol | undefined;

		send(buffer: VSBuffer): void {
			this.other?.receive(buffer);
		}

		private receive(buffer: VSBuffer): void {
			if (this.buffering) {
				this.buffers.push(buffer);
			} else {
				this.emitter.fire(buffer);
			}
		}

		dispose(): void {
			this.emitter.dispose();
		}
	}

	test('a voice\'s sample reaches the window as bytes, and its refusal as it is, over the processes\' channel (D78)', async () => {
		const access = { provider: 'testaudio', region: 'home', endpoint: 'https://api.example.com/v1', credentials: { apiKey: 'sk-1' }, model: 'speech-1' };
		const sample = VSBuffer.wrap(Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb]));
		const refusal = { ok: false as const, error: { code: 'notAudio' as const, message: 'The file does not start like an MP3, WAV, FLAC, Ogg, or M4A sound.' } };
		const answers: ProviderResponse<VoicePreviewResult>[] = [{ ok: true, value: { bytes: sample, format: 'mp3' } }, refusal];
		const voices = { voices: [{ id: 'v-1', label: 'Aria', own: true, sample: 'https://cdn.example.com/v-1.mp3' }], truncated: true };
		const unused = () => Promise.reject(new Error('not used'));
		const shared: Service = {
			catalog: unused,
			check: unused,
			submit: unused,
			poll: unused,
			download: unused,
			cancel: unused,
			place: unused,
			voices: async () => ({ ok: true, value: voices }),
			voicePreview: async () => answers.shift() ?? refusal
		};
		const serverEnd = store.add(new QueueProtocol());
		const windowEnd = store.add(new QueueProtocol());
		serverEnd.other = windowEnd;
		windowEnd.other = serverEnd;
		const server = store.add(new ChannelServer(serverEnd, 'window:1'));
		server.registerChannel(BASEHALF_PROVIDERS_CHANNEL, new BaseHalfProviderChannel(shared as IBaseHalfProviderService));
		const client = store.add(new ChannelClient(windowEnd));
		const provider = new BaseHalfProviderChannelClient(client.getChannel(BASEHALF_PROVIDERS_CHANNEL));
		const fetched = await provider.voicePreview({ ...access, sample: 'https://cdn.example.com/v-1.mp3' });
		const refused = await provider.voicePreview({ ...access, sample: 'https://cdn.example.com/v-2.mp3' });
		const listed = await provider.voices(access);
		assert.ok(fetched.ok && fetched.value.bytes instanceof VSBuffer, JSON.stringify(fetched));
		assert.deepStrictEqual({ bytes: [...fetched.value.bytes.buffer], format: fetched.value.format, refused, listed }, {
			bytes: [...sample.buffer],
			format: 'mp3',
			refused,
			listed: { ok: true, value: voices }
		});
	});
});

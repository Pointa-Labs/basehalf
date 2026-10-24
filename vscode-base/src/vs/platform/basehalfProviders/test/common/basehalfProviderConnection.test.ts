/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BaseHalfProviderChannel } from '../../common/basehalfProviderChannel.js';
import { BaseHalfProviderConnection } from '../../common/basehalfProviderConnection.js';
import { IBaseHalfProviderService } from '../../common/basehalfProviders.js';
import type { CheckPayload, DownloadRequest, PlaceRequest, SubmitPayload, TaskRef } from '../../common/basehalfProviderTypes.js';

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
			place: () => answer('place')
		};
	}

	const SUBMIT = {} as SubmitPayload;
	const TASK = {} as TaskRef;

	test('answers as the service does while the shared process runs', async () => {
		const stopped = store.add(new Emitter<void>());
		const connection = store.add(new BaseHalfProviderConnection(service(), stopped.event, Promise.resolve(false)));
		assert.deepStrictEqual([await connection.catalog(), await connection.submit(SUBMIT), await connection.poll(TASK)], [
			{ ok: true, value: 'catalog' },
			{ ok: true, value: 'submit' },
			{ ok: true, value: 'poll' }
		]);
	});

	test('fails every waiting call at once when the shared process stopped, and every later call (D75)', async () => {
		const stopped = store.add(new Emitter<void>());
		const connection = store.add(new BaseHalfProviderConnection(service(new Set(['submit', 'poll'])), stopped.event, Promise.resolve(false)));
		const outcome = (call: Promise<unknown>) => call.then(() => 'answered', (error: Error) => error.message);
		const waiting = [outcome(connection.submit(SUBMIT)), outcome(connection.poll(TASK))];
		stopped.fire();
		const later = await outcome(connection.catalog());
		const message = 'BaseHalf\'s background process stopped. Restart BaseHalf to continue.';
		assert.deepStrictEqual([...await Promise.all(waiting), later], [message, message, message]);
	});

	test('fails every call in a window opened after the shared process stopped', async () => {
		const stopped = store.add(new Emitter<void>());
		const connection = store.add(new BaseHalfProviderConnection(service(new Set(['catalog'])), stopped.event, Promise.resolve(true)));
		await Promise.resolve();
		await assert.rejects(connection.catalog(), /background process stopped/);
	});
});

suite('BaseHalfProviderChannel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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
			place: async (request: PlaceRequest) => { seen.push(`place ${JSON.stringify(request)}`); return { ok: true, value: undefined as never }; }
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
			await assert.rejects(channel.call('window:1', 'unknown', []), /no call 'unknown'/);
			assert.throws(() => channel.listen('window:1', 'onDidChange'), /no event 'onDidChange'/);
			assert.deepStrictEqual(seen, [
				'catalog',
				'check {"a":1}',
				'submit {"b":2} running',
				'poll {"c":3} ended',
				'download {"d":4} running',
				'cancel {"e":5} running',
				'place {"f":6}'
			]);
		} finally {
			source.dispose();
			ended.dispose();
		}
	});
});

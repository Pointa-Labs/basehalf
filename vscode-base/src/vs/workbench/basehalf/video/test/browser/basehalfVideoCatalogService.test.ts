/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfProviderService } from '../../../../../platform/basehalfProviders/common/basehalfProviders.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { BaseHalfVideoCatalogService } from '../../browser/basehalfVideoCatalogService.js';
import { IBaseHalfVideoCheckRequest } from '../../common/basehalfVideoCatalog.js';
import { ACME, ACME_MOTION, BOREALIS } from '../common/basehalfVideoCatalogFixture.js';

/** The catalog and the check of the provider service, scripted; a call with no answer left does not reach it. */
class CatalogCommands {
	readonly calls: string[] = [];
	answers: (() => unknown)[] = [];
	check: (request: IBaseHalfVideoCheckRequest) => unknown = () => ({ ok: true, value: { problems: [] } });

	readonly service: IBaseHalfProviderService = {
		_serviceBrand: undefined,
		catalog: async () => {
			this.calls.push('catalog');
			const answer = this.answers.shift();
			if (!answer) {
				// What the window's connection answers once the shared process stopped (D75).
				throw new Error('BaseHalf\'s background process stopped. Restart BaseHalf to continue.');
			}
			return await answer() as never;
		},
		check: async request => {
			this.calls.push('check');
			return await this.check(request) as never;
		},
		submit: () => { throw new Error('not used'); },
		poll: () => { throw new Error('not used'); },
		download: () => { throw new Error('not used'); },
		cancel: () => { throw new Error('not used'); },
		place: () => { throw new Error('not used'); }
	};
}

suite('BaseHalfVideoCatalogService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(commands: CatalogCommands, retryDelay = 1_000): BaseHalfVideoCatalogService {
		return disposables.add(new BaseHalfVideoCatalogService(retryDelay, commands.service, new NullLogService()));
	}

	test('asks the provider service once when the catalog is first needed, and keeps the answer', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const commands = new CatalogCommands();
		commands.answers = [() => ({ ok: true, value: { schema: 1, providers: [ACME, BOREALIS] } })];
		const service = createService(commands);
		const changes: string[] = [];
		disposables.add(service.onDidChange(() => changes.push(service.state.kind)));
		const before = commands.calls.length;
		const first = service.state.kind;
		const catalog = await service.whenReady();
		service.load();
		await service.whenReady();
		assert.deepStrictEqual({
			before,
			first,
			changes,
			providers: catalog.providers.map(provider => provider.id),
			asked: commands.calls
		}, {
			before: 0,
			first: 'loading',
			changes: ['ready'],
			providers: ['acme', 'borealis'],
			asked: ['catalog']
		});
	}));

	test('tries a failed request once more, says why it failed, and asks again when it is needed again', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const commands = new CatalogCommands();
		commands.answers = [
			() => { throw new Error('Channel name \'basehalfProviders\' timed out after 1000ms'); },
			() => ({ ok: false, error: { code: 'network', message: 'The catalog could not be built.' } })
		];
		const service = createService(commands);
		await assert.rejects(() => service.whenReady(), /The catalog could not be built\./);
		const answeredWithError = service.state;
		// A call that does not reach the provider service fails with why.
		commands.answers = [];
		await assert.rejects(() => service.whenReady(), /BaseHalf's background process stopped\. Restart BaseHalf to continue\./);
		const unanswered = service.state;
		commands.answers = [() => ({ ok: true, value: { schema: 1, providers: [{ ...ACME, models: [ACME_MOTION, { id: 'broken' }] }] } })];
		service.load();
		const loadingAgain = service.state.kind;
		const catalog = await service.whenReady();
		assert.deepStrictEqual({ answeredWithError, unanswered, loadingAgain, models: catalog.providers[0].models.map(model => model.id), asked: commands.calls.length }, {
			answeredWithError: { kind: 'failed', message: 'The catalog could not be built.' },
			unanswered: { kind: 'failed', message: 'BaseHalf\'s background process stopped. Restart BaseHalf to continue.' },
			loadingAgain: 'loading',
			models: ['acme-motion-2'],
			asked: 5
		});
	}));

	test('waits for the catalog no longer than it is asked to', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const commands = new CatalogCommands();
		const store = disposables.add(new DisposableStore());
		let answer: ((value: unknown) => void) | undefined;
		commands.answers = [() => new Promise(resolve => answer = resolve)];
		const service = createService(commands);
		store.add({ dispose: () => answer?.({ ok: true, value: { schema: 1, providers: [] } }) });
		await assert.rejects(() => service.whenReady(5_000), /BaseHalf did not get the models in time/);
		answer?.({ ok: true, value: { schema: 1, providers: [BOREALIS] } });
		await timeout(0);
		assert.deepStrictEqual((await service.whenReady(5_000)).providers.map(provider => provider.id), ['borealis']);
		store.dispose();
	}));

	test('checks a planned generation, and answers nothing when the provider service does not', async () => {
		const commands = new CatalogCommands();
		const service = createService(commands, 0);
		const request: IBaseHalfVideoCheckRequest = {
			provider: 'acme', region: 'east', model: 'acme-motion-2', mode: 'frames',
			params: { resolution: '720p', duration: 5, sound: true }, prompt: ['Rain'],
			inputs: { startFrame: { fsPath: '/workspace/frames/a.png', mimeType: 'image/png' }, images: [], videos: [], audios: [] }
		};
		const seen: IBaseHalfVideoCheckRequest[] = [];
		commands.check = checked => {
			seen.push(checked);
			return { ok: true, value: { problems: ['The start frame is smaller than 300 pixels.'], prompt: 'Rain' } };
		};
		const answered = await service.check(request);
		commands.check = () => ({ ok: false, error: { code: 'unknownProvider', message: 'No such provider.' } });
		const refused = await service.check(request);
		commands.check = () => { throw new Error('BaseHalf\'s background process stopped. Restart BaseHalf to continue.'); };
		const crashed = await service.check(request);
		assert.deepStrictEqual({ answered, refused, crashed, seen }, {
			answered: { problems: ['The start frame is smaller than 300 pixels.'], prompt: 'Rain' },
			refused: undefined,
			crashed: undefined,
			seen: [request]
		});
	});
});

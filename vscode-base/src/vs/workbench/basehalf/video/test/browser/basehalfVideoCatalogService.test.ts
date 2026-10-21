/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandEvent, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { BaseHalfVideoCatalogService } from '../../browser/basehalfVideoCatalogService.js';
import { BASEHALF_VIDEO_PROVIDER_COMMANDS, IBaseHalfVideoCheckRequest } from '../../common/basehalfVideoCatalog.js';
import { ACME, ACME_MOTION, BOREALIS } from '../common/basehalfVideoCatalogFixture.js';

/** AI Video's catalog and check commands, scripted. */
class CatalogCommands implements ICommandService {
	declare readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly onDidExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly calls: string[] = [];
	answers: (() => unknown)[] = [];
	check: (request: IBaseHalfVideoCheckRequest) => unknown = () => ({ ok: true, value: { problems: [] } });

	async executeCommand<R = unknown>(id: string, ...args: unknown[]): Promise<R> {
		this.calls.push(id);
		if (id === BASEHALF_VIDEO_PROVIDER_COMMANDS.check) {
			return this.check(args[0] as IBaseHalfVideoCheckRequest) as R;
		}
		const answer = this.answers.shift();
		if (!answer) {
			throw new Error(`command '${id}' not found`);
		}
		return answer() as R;
	}
}

suite('BaseHalfVideoCatalogService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(commands: CatalogCommands, retryDelay = 1_000): BaseHalfVideoCatalogService {
		return disposables.add(new BaseHalfVideoCatalogService(retryDelay, commands, new NullLogService()));
	}

	test('asks AI Video once when the catalog is first needed, and keeps the answer', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
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
			asked: [BASEHALF_VIDEO_PROVIDER_COMMANDS.catalog]
		});
	}));

	test('tries a failed request once more, says why it failed, and asks again when it is needed again', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const commands = new CatalogCommands();
		commands.answers = [
			() => { throw new Error('Extension host terminated.'); },
			() => ({ ok: false, error: { code: 'network', message: 'The catalog could not be built.' } })
		];
		const service = createService(commands);
		await assert.rejects(() => service.whenReady(), /The catalog could not be built\./);
		const answeredWithError = service.state;
		// AI Video never registered its command in this test: when nothing answers, it does not run.
		commands.answers = [];
		await assert.rejects(() => service.whenReady(), /AI Video, which provides the video models, is not running\./);
		const unanswered = service.state;
		commands.answers = [() => ({ ok: true, value: { schema: 1, providers: [{ ...ACME, models: [ACME_MOTION, { id: 'broken' }] }] } })];
		service.load();
		const loadingAgain = service.state.kind;
		const catalog = await service.whenReady();
		assert.deepStrictEqual({ answeredWithError, unanswered, loadingAgain, models: catalog.providers[0].models.map(model => model.id), asked: commands.calls.length }, {
			answeredWithError: { kind: 'failed', message: 'The catalog could not be built.' },
			unanswered: { kind: 'failed', message: 'AI Video, which provides the video models, is not running.' },
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
		await assert.rejects(() => service.whenReady(5_000), /did not answer with the video models in time/);
		answer?.({ ok: true, value: { schema: 1, providers: [BOREALIS] } });
		await timeout(0);
		assert.deepStrictEqual((await service.whenReady(5_000)).providers.map(provider => provider.id), ['borealis']);
		store.dispose();
	}));

	test('checks a planned generation, and answers nothing when AI Video does not', async () => {
		const commands = new CatalogCommands();
		const service = createService(commands, 0);
		const request: IBaseHalfVideoCheckRequest = {
			provider: 'acme', region: 'east', model: 'acme-motion-2', mode: 'frames',
			params: { resolution: '720p', duration: 5, sound: true }, prompt: 'Rain',
			inputs: { startFrame: { fsPath: '/workspace/frames/a.png', mimeType: 'image/png' }, images: [], videos: [], audios: [] }
		};
		const seen: IBaseHalfVideoCheckRequest[] = [];
		commands.check = checked => {
			seen.push(checked);
			return { ok: true, value: { problems: ['The start frame is smaller than 300 pixels.'] } };
		};
		const answered = await service.check(request);
		commands.check = () => ({ ok: false, error: { code: 'unknownProvider', message: 'No such provider.' } });
		const refused = await service.check(request);
		commands.check = () => { throw new Error('Extension host terminated.'); };
		const crashed = await service.check(request);
		assert.deepStrictEqual({ answered, refused, crashed, seen }, {
			answered: { problems: ['The start frame is smaller than 300 pixels.'] },
			refused: undefined,
			crashed: undefined,
			seen: [request]
		});
	});
});

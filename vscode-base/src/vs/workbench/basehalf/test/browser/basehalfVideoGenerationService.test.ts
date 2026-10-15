/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { decodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { BaseHalfVideoChannelService } from '../../browser/basehalfVideoChannelService.js';
import {
	BASEHALF_VIDEO_ORPHANED_SUBMISSION_AGE,
	BASEHALF_VIDEO_TASK_TIME_LIMIT,
	BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT,
	BaseHalfVideoGenerationService,
	orphanedSubmissionMessage,
	rasterizeBaseHalfVideoImage,
	unknownOutcomeMessage
} from '../../browser/basehalfVideoGenerationService.js';
import { BaseHalfVideoGenerationError, IBaseHalfVideoChannel } from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoGenerationSettings, IBaseHalfVideoNodeFields, IBaseHalfVideoTask } from '../../common/basehalfVideoNode.js';
import { BASEHALF_VIDEO_PROVIDER_COMMANDS, IBaseHalfVideoProviderDownloadRequest, IBaseHalfVideoProviderRequest } from '../../common/basehalfVideoProviders.js';
import { FAKE_MP4, FakeProviderCommands, FakeVideoNodeStore, InMemoryCredentialStore } from './basehalfVideoTestFixtures.js';

const START = Date.parse('2026-10-15T08:00:00.000Z');
const SEEDANCE = 'doubao-seedance-2-5-260628';
const { submit: SUBMIT, poll: POLL, download: DOWNLOAD, cancel: CANCEL } = BASEHALF_VIDEO_PROVIDER_COMMANDS;
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

suite('BaseHalfVideoGenerationService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.file('/workspace');

	interface IHarness {
		readonly fileService: FileService;
		readonly store: FakeVideoNodeStore;
		readonly commands: FakeProviderCommands;
		readonly channels: BaseHalfVideoChannelService;
		readonly channel: IBaseHalfVideoChannel;
		readonly service: BaseHalfVideoGenerationService;
		readonly rasterized: string[];
		window(commands: FakeProviderCommands): BaseHalfVideoGenerationService;
	}

	async function createHarness(options: { readonly key?: string | false } = {}): Promise<IHarness> {
		const owner = disposables.add(new DisposableStore());
		const fileService = owner.add(new FileService(new NullLogService()));
		owner.add(fileService.registerProvider(Schemas.file, owner.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(root);
		const store = new FakeVideoNodeStore(root);
		owner.add({ dispose: () => store.dispose() });
		const commands = new FakeProviderCommands(fileService);
		const channels = owner.add(new BaseHalfVideoChannelService(owner.add(new InMemoryStorageService()), new InMemoryCredentialStore(), commands));
		let channel = await channels.addChannel('ark');
		if (options.key !== false) {
			await channels.setKey(channel.id, options.key ?? 'ark-test-key');
			channel = channels.getChannel(channel.id)!;
		}
		const rasterized: string[] = [];
		const window = (windowCommands: FakeProviderCommands) => owner.add(new BaseHalfVideoGenerationService(async (_bytes, mimeType) => {
			rasterized.push(mimeType);
			return PNG_DATA_URL;
		}, store, channels, windowCommands, fileService, new NullLogService()));
		return { fileService, store, commands, channels, channel, service: window(commands), rasterized, window };
	}

	function settings(channel: IBaseHalfVideoChannel, overrides: Partial<IBaseHalfVideoGenerationSettings> = {}): IBaseHalfVideoGenerationSettings {
		return { channel: channel.id, model: SEEDANCE, mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true, ...overrides };
	}

	async function writeInputs(harness: IHarness): Promise<void> {
		await harness.fileService.writeFile(joinPath(root, 'frames/start.png'), VSBuffer.fromString('start-png'));
		await harness.fileService.writeFile(joinPath(root, 'frames/end.png'), VSBuffer.fromString('end-png'));
		await harness.fileService.writeFile(joinPath(root, 'frames/third.png'), VSBuffer.fromString('third-png'));
		await harness.fileService.writeFile(joinPath(root, 'notes/scene.md'), VSBuffer.fromString('---\nupstream:\n  - brief.md\n---\n# Scene\n\nThe sea at dusk.\n'));
		for (const path of ['frames/start.png', 'frames/end.png', 'frames/third.png', 'notes/scene.md', 'clips/ref.mp4']) {
			harness.store.addInput(path);
		}
		harness.store.addInput('docs/plan.pdf');
	}

	function shotNode(harness: IHarness, fields: Partial<IBaseHalfVideoNodeFields> = {}, upstream: readonly string[] = ['frames/start.png', 'frames/end.png', 'frames/third.png', 'clips/ref.mp4', 'notes/scene.md', 'docs/plan.pdf']): URI {
		return harness.store.addNode('shots/Shot 1.bhnode', { prompt: '图片1里的人骑车经过海边', generation: settings(harness.channel), ...fields }, upstream, 'Shot 1');
	}

	function runningTask(harness: IHarness, startedAt = START, overrides: Partial<IBaseHalfVideoTask> = {}): IBaseHalfVideoTask {
		return {
			id: '20261015T080000-abcd',
			state: 'running',
			startedAt: new Date(startedAt).toISOString(),
			channel: harness.channel.id,
			remoteId: 'cgt-resumed',
			request: { provider: 'ark', model: SEEDANCE, prompt: 'p', inputs: [], mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true },
			...overrides
		} as IBaseHalfVideoTask;
	}

	async function until(condition: () => boolean, step = 500, limit = 3 * BASEHALF_VIDEO_TASK_TIME_LIMIT): Promise<void> {
		for (let waited = 0; !condition(); waited += step) {
			if (waited > limit) {
				throw new Error('The condition did not come true.');
			}
			await timeout(step);
		}
	}

	async function outputFiles(harness: IHarness): Promise<string[]> {
		const found: string[] = [];
		const visit = async (folder: URI): Promise<void> => {
			const stat = await harness.fileService.resolve(folder).catch(() => undefined);
			for (const child of stat?.children ?? []) {
				if (child.isDirectory) {
					await visit(child.resource);
				} else {
					found.push(child.resource.path.slice(root.path.length + 1));
				}
			}
		};
		await visit(joinPath(root, 'outputs'));
		return found.sort();
	}

	function states(harness: IHarness, node: URI): string[] {
		return harness.store.history(node).map(fields => fields.result ? `result ${fields.result.artifact.path}` : `${fields.task?.state}${fields.task?.remoteId ? ` ${fields.task.remoteId}` : ''}`);
	}

	test('runs a generation from the file to a video in outputs, through submitting and running', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		await writeInputs(harness);
		const node = shotNode(harness);
		const polls = [
			{ ok: true, value: { state: 'pending' } },
			{ ok: true, value: { state: 'running', fraction: 0.4 } },
			{ ok: true, value: { state: 'succeeded', videoUrl: 'https://cdn.example.com/v.mp4' } }
		];
		harness.commands.poll = () => polls.shift();
		const phases: string[] = [];
		disposables.add(harness.service.onDidChangeProgress(resource => {
			const progress = harness.service.getProgress(resource);
			const phase = progress ? `${progress.phase}${progress.fraction !== undefined ? ` ${progress.fraction}` : ''}` : 'ended';
			if (phases.at(-1) !== phase) {
				phases.push(phase);
			}
		}));

		const ran = await harness.service.generate(node);
		const task = harness.store.fields(node).task!;
		assert.deepStrictEqual({ ran: ran.toString(), state: task.state, startedAt: task.startedAt, id: /^20261015T080000-[a-z0-9]{4}$/.test(task.id), generating: harness.service.isGenerating(node) },
			{ ran: node.toString(), state: 'submitting', startedAt: '2026-10-15T08:00:00.000Z', id: true, generating: true });

		await until(() => !harness.service.isGenerating(node));
		const fields = harness.store.fields(node);
		const target = `outputs/node-1/${task.id}.mp4`;
		assert.deepStrictEqual(states(harness, node), ['submitting', 'running cgt-remote-1', `result ${target}`]);
		assert.deepStrictEqual(fields.task, undefined);
		assert.deepStrictEqual(fields.result, {
			source: 'generated',
			artifact: { kind: 'video', path: target, size: FAKE_MP4.byteLength },
			generation: {
				taskId: task.id,
				remoteId: 'cgt-remote-1',
				startedAt: '2026-10-15T08:00:00.000Z',
				completedAt: fields.result?.source === 'generated' ? fields.result.generation.completedAt : '',
				request: {
					provider: 'ark',
					model: SEEDANCE,
					prompt: '图片1里的人骑车经过海边',
					inputs: ['frames/start.png', 'frames/end.png', 'notes/scene.md'],
					mode: 'frames',
					ratio: 'adaptive',
					resolution: '720p',
					duration: 5,
					audio: true
				}
			}
		});
		assert.deepStrictEqual(await outputFiles(harness), [target]);
		assert.strictEqual((await harness.fileService.readFile(joinPath(root, target))).value.toString(), FAKE_MP4.toString());

		const request = harness.commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoProviderRequest;
		assert.deepStrictEqual(request, {
			provider: 'ark',
			baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
			apiKey: 'ark-test-key',
			model: SEEDANCE,
			prompt: '图片1里的人骑车经过海边\n\n# Scene\n\nThe sea at dusk.',
			mode: 'frames',
			ratio: 'adaptive',
			resolution: '720p',
			duration: 5,
			audio: true,
			startFrame: { fsPath: joinPath(root, 'frames/start.png').fsPath, mimeType: 'image/png' },
			endFrame: { fsPath: joinPath(root, 'frames/end.png').fsPath, mimeType: 'image/png' },
			referenceImages: [],
			referenceVideos: [],
			referenceAudios: []
		});
		const download = harness.commands.calls.find(call => call.id === DOWNLOAD)?.argument as IBaseHalfVideoProviderDownloadRequest;
		assert.deepStrictEqual({ remoteId: download.remoteId, videoUrl: download.videoUrl, part: download.targetFsPath.startsWith(joinPath(root, target).fsPath + '.') && download.targetFsPath.endsWith('.part') },
			{ remoteId: 'cgt-remote-1', videoUrl: 'https://cdn.example.com/v.mp4', part: true });
		assert.deepStrictEqual(harness.commands.calls.map(call => call.id), [SUBMIT, POLL, POLL, POLL, DOWNLOAD]);
		assert.deepStrictEqual(phases, ['preparing', 'submitting', 'queued', 'generating 0.4', 'downloading', 'ended']);
		assert.deepStrictEqual(harness.channels.getLastUsed(), settings(harness.channel));
	}));

	test('runs a model id the user added on a relay with the general profile, in references mode with the images and the video', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		await writeInputs(harness);
		await harness.fileService.writeFile(joinPath(root, 'clips/ref.mp4'), FAKE_MP4);
		const relay = await harness.channels.addChannel('openai');
		await harness.channels.updateChannel(relay.id, { baseUrl: 'http://127.0.0.1:8123/v1', models: ['my-relay-model'] });
		await harness.channels.setKey(relay.id, 'sk-relay');
		const node = shotNode(harness, { generation: { ...settings(harness.channels.getChannel(relay.id)!, { model: 'my-relay-model', mode: 'reference', duration: 8 }) } });
		harness.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await harness.service.generate(node);
		const request = harness.commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoProviderRequest;
		const file = (path: string, mimeType: string) => ({ fsPath: joinPath(root, path).fsPath, mimeType });
		assert.deepStrictEqual({
			channel: harness.store.fields(node).task?.channel,
			request: { ...request, prompt: request.prompt.split('\n\n').length },
			inputs: harness.store.fields(node).task?.request.inputs
		}, {
			channel: relay.id,
			request: {
				provider: 'openai',
				baseUrl: 'http://127.0.0.1:8123/v1',
				apiKey: 'sk-relay',
				model: 'my-relay-model',
				prompt: 3,
				mode: 'reference',
				ratio: '16:9',
				resolution: '720p',
				duration: 8,
				audio: true,
				referenceImages: [file('frames/start.png', 'image/png'), file('frames/end.png', 'image/png'), file('frames/third.png', 'image/png')],
				referenceVideos: [file('clips/ref.mp4', 'video/mp4')],
				referenceAudios: []
			},
			inputs: ['frames/start.png', 'frames/end.png', 'frames/third.png', 'clips/ref.mp4', 'notes/scene.md']
		});
		await harness.service.stop(node);
	}));

	test('asks the provider 3 seconds after it accepted the task and then every 5 seconds', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		const asked: number[] = [];
		harness.commands.poll = () => {
			asked.push(Date.now() - START);
			return asked.length < 3 ? { ok: true, value: { state: 'running' } } : { ok: true, value: { state: 'succeeded' } };
		};
		await harness.service.generate(node);
		await until(() => !harness.service.isGenerating(node));
		assert.deepStrictEqual(asked, [3_000, 8_000, 13_000]);
	}));

	test('refuses with the first blocker and writes nothing', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const messages: string[] = [];
		const attempt = async (fields: IBaseHalfVideoNodeFields, upstream: readonly string[] = []) => {
			const node = harness.store.addNode(`n${messages.length}.bhnode`, fields, upstream);
			try {
				await harness.service.generate(node);
				messages.push('ran');
			} catch (error) {
				messages.push(error instanceof BaseHalfVideoGenerationError ? error.message : `unexpected ${error}`);
			}
			assert.deepStrictEqual(harness.store.history(node), []);
			assert.strictEqual(harness.service.isGenerating(node), false);
		};
		await attempt({ prompt: 'a', generation: { mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true } });
		await attempt({ prompt: 'a', generation: settings(harness.channel, { model: 'not-offered' }) });
		await attempt({ prompt: '', generation: settings(harness.channel) }, ['docs/plan.pdf']);
		await attempt({ prompt: 'a', generation: settings(harness.channel), task: runningTask(harness) });

		const relay = await harness.channels.addChannel('openai');
		await harness.channels.updateChannel(relay.id, { models: ['relay-video-1'] });
		await attempt({ prompt: 'a', generation: settings(relay, { model: 'relay-video-1' }) });
		await harness.channels.updateChannel(relay.id, { baseUrl: 'https://relay.example.com/v1' });
		await attempt({ prompt: 'a', generation: settings(relay, { model: 'relay-video-1' }) });

		assert.deepStrictEqual(messages, [
			'Choose a model first.',
			'No video provider on this computer offers this model. Add it in Video Providers.',
			'Write a prompt or connect an input first.',
			'This node is generating.',
			'The video provider of this model has no endpoint. Enter it in Video Providers.',
			'The video provider of this model has no API key. Set it in Video Providers.'
		]);
		assert.strictEqual(harness.commands.count(SUBMIT), 0);
	}));

	test('draws an SVG start frame to PNG and refuses a 25 MiB image by name before writing anything', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		await harness.fileService.writeFile(joinPath(root, 'frames/start.svg'), VSBuffer.fromString('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
		harness.store.addInput('frames/start.svg');
		const svgNode = shotNode(harness, {}, ['frames/start.svg']);
		harness.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await harness.service.generate(svgNode);
		const request = harness.commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoProviderRequest;
		assert.deepStrictEqual({ startFrame: request.startFrame, rasterized: harness.rasterized }, { startFrame: { dataUrl: PNG_DATA_URL }, rasterized: ['image/svg+xml'] });
		await harness.service.stop(svgNode);

		await harness.fileService.writeFile(joinPath(root, 'frames/huge.png'), VSBuffer.alloc(25 * 1024 * 1024));
		harness.store.addInput('frames/huge.png');
		const hugeNode = harness.store.addNode('shots/Huge.bhnode', { prompt: 'p', generation: settings(harness.channel) }, ['frames/huge.png']);
		await assert.rejects(() => harness.service.generate(hugeNode), (error: Error) => error instanceof BaseHalfVideoGenerationError && error.message === 'huge.png is larger than 20 MiB. Providers take inputs of at most 20 MiB.');

		harness.store.addInput('frames/gone.png');
		const goneNode = harness.store.addNode('shots/Gone.bhnode', { prompt: 'p', generation: settings(harness.channel) }, ['frames/gone.png']);
		await assert.rejects(() => harness.service.generate(goneNode), (error: Error) => error.message === 'gone.png is missing. Connect it again or remove its connection.');
		assert.deepStrictEqual([harness.store.history(hugeNode), harness.store.history(goneNode), harness.commands.count(SUBMIT)], [[], [], 1]);
	}));

	test('ends with the provider\'s message when the key is refused', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		harness.commands.submit = () => ({ ok: false, error: { code: 'auth', message: 'The API key format is incorrect.', status: 401 } });
		await harness.service.generate(node);
		await until(() => !harness.service.isGenerating(node));
		const task = harness.store.fields(node).task!;
		assert.deepStrictEqual({ state: task.state, error: task.error, states: states(harness, node), submits: harness.commands.count(SUBMIT) },
			{ state: 'failed', error: 'The provider refused the key: The API key format is incorrect.', states: ['submitting', 'failed'], submits: 1 });
	}));

	test('never sends a request again when its outcome is unknown', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const answered = shotNode(harness, {}, []);
		harness.commands.submit = () => ({ ok: false, error: { code: 'unknownOutcome', message: 'The connection closed after the request was sent.' } });
		await harness.service.generate(answered);
		await until(() => !harness.service.isGenerating(answered));
		await timeout(10 * 60_000);

		// AI Video stopped while it sent the request.
		disposables.add(CommandsRegistry.registerCommand(SUBMIT, () => undefined));
		const crashed = harness.store.addNode('shots/Crashed.bhnode', { prompt: 'p', generation: settings(harness.channel) });
		harness.commands.submit = () => { throw new Error('Extension host terminated.'); };
		await harness.service.generate(crashed);
		await until(() => !harness.service.isGenerating(crashed));
		await timeout(10 * 60_000);

		assert.deepStrictEqual({
			answered: harness.store.fields(answered).task?.error,
			crashed: harness.store.fields(crashed).task?.error,
			submits: harness.commands.count(SUBMIT),
			polls: harness.commands.count(POLL)
		}, {
			answered: `${unknownOutcomeMessage()} (The connection closed after the request was sent.)`,
			crashed: `${unknownOutcomeMessage()} (Extension host terminated.)`,
			submits: 2,
			polls: 0
		});
	}));

	test('stops: records the stop, cancels the task, and keeps no video that arrives later', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		harness.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await harness.service.generate(node);
		await until(() => harness.commands.count(POLL) === 1);
		harness.commands.poll = () => ({ ok: true, value: { state: 'succeeded', videoUrl: 'https://cdn.example.com/late.mp4' } });
		await harness.service.stop(node);
		await timeout(60_000);
		assert.deepStrictEqual({
			states: states(harness, node),
			generating: harness.service.isGenerating(node),
			cancel: harness.commands.calls.filter(call => call.id === CANCEL).map(call => (call.argument as { remoteId: string }).remoteId),
			calls: harness.commands.calls.map(call => call.id),
			files: await outputFiles(harness)
		}, { states: ['submitting', 'running cgt-remote-1', 'stopped cgt-remote-1'], generating: false, cancel: ['cgt-remote-1'], calls: [SUBMIT, POLL, CANCEL], files: [] });
	}));

	test('stops while the request is on its way and cancels the task the provider made after all', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		const submitted = new DeferredPromise<unknown>();
		harness.commands.submit = () => submitted.p;
		await harness.service.generate(node);
		await harness.service.stop(node);
		submitted.complete({ ok: true, value: { remoteId: 'cgt-late' } });
		await timeout(30_000);
		assert.deepStrictEqual({
			states: states(harness, node),
			calls: harness.commands.calls.map(call => `${call.id} ${(call.argument as { remoteId?: string }).remoteId ?? ''}`.trim())
		}, { states: ['submitting', 'stopped'], calls: [SUBMIT, `${CANCEL} cgt-late`] });
	}));

	test('stops during the download and deletes what arrives', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		const downloading = new DeferredPromise<void>();
		const release = new DeferredPromise<void>();
		const original = harness.commands.download;
		harness.commands.download = async request => {
			downloading.complete();
			await release.p;
			return original(request);
		};
		await harness.service.generate(node);
		await downloading.p;
		await harness.service.stop(node);
		release.complete();
		await timeout(10_000);
		assert.deepStrictEqual({ states: states(harness, node), files: await outputFiles(harness) }, { states: ['submitting', 'running cgt-remote-1', 'stopped cgt-remote-1'], files: [] });
	}));

	test('ends with the provider\'s failure, after 30 minutes without an answer, and after two hours', () => runWithFakedTimers({ startTime: START, maxTaskCount: 50_000 }, async () => {
		const harness = await createHarness();
		const failed = shotNode(harness, {}, []);
		harness.commands.poll = () => ({ ok: true, value: { state: 'failed', message: 'The output video may contain sensitive content.' } });
		await harness.service.generate(failed);
		await until(() => !harness.service.isGenerating(failed));

		const unreachable = harness.store.addNode('shots/Unreachable.bhnode', { prompt: 'p', generation: settings(harness.channel) });
		let networkErrors = 0;
		harness.commands.poll = () => {
			networkErrors++;
			return { ok: false, error: { code: 'network', message: 'getaddrinfo ENOTFOUND ark.cn-beijing.volces.com' } };
		};
		const unreachableStart = Date.now();
		await harness.service.generate(unreachable);
		await until(() => !harness.service.isGenerating(unreachable), 5_000);
		const unreachableTook = Date.now() - unreachableStart;

		const slow = harness.store.addNode('shots/Slow.bhnode', { prompt: 'p', generation: settings(harness.channel) });
		harness.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const slowStart = Date.now();
		await harness.service.generate(slow);
		await until(() => !harness.service.isGenerating(slow), 5_000);
		const slowTook = Date.now() - slowStart;

		assert.deepStrictEqual({
			failed: harness.store.fields(failed).task?.error,
			unreachable: harness.store.fields(unreachable).task?.error,
			unreachableInWindow: unreachableTook >= BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT && unreachableTook < BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT + 10_000,
			retried: networkErrors > 300,
			slow: harness.store.fields(slow).task?.error,
			slowInWindow: slowTook >= BASEHALF_VIDEO_TASK_TIME_LIMIT && slowTook < BASEHALF_VIDEO_TASK_TIME_LIMIT + 10_000
		}, {
			failed: 'The provider could not make the video: The output video may contain sensitive content.',
			unreachable: 'BaseHalf could not reach the provider for 30 minutes. The video may still be made there: check the provider\'s console. (getaddrinfo ENOTFOUND ark.cn-beijing.volces.com)',
			unreachableInWindow: true,
			retried: true,
			slow: 'The provider did not finish the video within two hours.',
			slowInWindow: true
		});
	}));

	test('follows a running task again after a reload and completes it', () => runWithFakedTimers({ startTime: START + 60_000, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, { task: runningTask(harness) }, []);
		harness.service.resume(node);
		harness.service.resume(node);
		await until(() => harness.service.isGenerating(node));
		await until(() => !harness.service.isGenerating(node));
		assert.deepStrictEqual({
			states: states(harness, node),
			polled: harness.commands.calls.filter(call => call.id === POLL).map(call => (call.argument as { remoteId: string }).remoteId),
			submits: harness.commands.count(SUBMIT)
		}, { states: ['result outputs/node-1/20261015T080000-abcd.mp4'], polled: ['cgt-resumed'], submits: 0 });
	}));

	test('settles a request that was on its way when BaseHalf closed, once it is two minutes old, and never sends it', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const submitting = (startedAt: number): IBaseHalfVideoTask => {
			const { remoteId: _remoteId, ...task } = runningTask(harness, startedAt, { state: 'submitting' });
			return task as IBaseHalfVideoTask;
		};
		const old = harness.store.addNode('shots/Old.bhnode', { prompt: 'p', generation: settings(harness.channel), task: submitting(START - 3 * 60_000) });
		const young = harness.store.addNode('shots/Young.bhnode', { prompt: 'p', generation: settings(harness.channel), task: submitting(START - 30_000) });
		const accepted = harness.store.addNode('shots/Accepted.bhnode', { prompt: 'p', generation: settings(harness.channel), task: submitting(START - 30_000) });
		for (const node of [old, young, accepted]) {
			harness.service.resume(node);
		}
		await timeout(1_000);
		const youngBefore = harness.store.fields(young).task?.state;
		// Another window records the provider's task id meanwhile.
		harness.store.replace(accepted, { ...harness.store.fields(accepted), task: runningTask(harness, START - 30_000) });
		harness.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await timeout(BASEHALF_VIDEO_ORPHANED_SUBMISSION_AGE);
		assert.deepStrictEqual({
			old: harness.store.fields(old).task?.error,
			youngBefore,
			young: harness.store.fields(young).task?.error,
			accepted: harness.service.isGenerating(accepted),
			submits: harness.commands.count(SUBMIT)
		}, { old: orphanedSubmissionMessage(), youngBefore: 'submitting', young: orphanedSubmissionMessage(), accepted: true, submits: 0 });
		await harness.service.stop(accepted);
	}));

	test('generates from a node with a video in a new node beside it and leaves the original unchanged', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		await writeInputs(harness);
		const result: IBaseHalfVideoNodeFields['result'] = {
			source: 'generated',
			artifact: { kind: 'video', path: 'outputs/node-1/old.mp4', size: 10 },
			generation: { taskId: 'old', remoteId: 'cgt-old', startedAt: '2026-10-14T08:00:00.000Z', completedAt: '2026-10-14T08:01:00.000Z', request: runningTask(harness).request }
		};
		const original = shotNode(harness, { result }, ['frames/start.png', 'notes/scene.md']);
		const before = harness.store.fields(original);
		const ran = await harness.service.generate(original);
		await until(() => !harness.service.isGenerating(ran));
		const sibling = harness.store.fields(ran);
		assert.deepStrictEqual({
			ran: ran.path,
			original: harness.store.fields(original) === before,
			siblings: harness.store.siblings.map(entry => ({ from: entry.from.path, fields: entry.fields, upstream: entry.upstream })),
			result: sibling.result?.artifact.path.startsWith('outputs/node-2/')
		}, {
			ran: '/workspace/shots/Shot 1-2.bhnode',
			original: true,
			siblings: [{ from: '/workspace/shots/Shot 1.bhnode', fields: { prompt: '图片1里的人骑车经过海边', generation: settings(harness.channel) }, upstream: ['frames/start.png', 'notes/scene.md'] }],
			result: true
		});
	}));

	test('of two windows that follow one task, the first that writes the result wins and the other deletes its download', () => runWithFakedTimers({ startTime: START + 60_000, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, { task: runningTask(harness) }, []);
		// Both windows download the video; this one finishes first.
		const firstDownload = harness.commands.download;
		harness.commands.download = async request => {
			await timeout(1_000);
			return firstDownload(request);
		};
		const otherCommands = new FakeProviderCommands(harness.fileService);
		const otherDownloads: string[] = [];
		otherCommands.download = async request => {
			otherDownloads.push(request.targetFsPath);
			await timeout(2_000);
			await harness.fileService.writeFile(URI.file(request.targetFsPath), FAKE_MP4);
			return { ok: true, value: { size: FAKE_MP4.byteLength } };
		};
		const other = harness.window(otherCommands);
		harness.service.resume(node);
		other.resume(node);
		await until(() => harness.service.isGenerating(node) && other.isGenerating(node));
		await until(() => !harness.service.isGenerating(node) && !other.isGenerating(node));
		assert.deepStrictEqual({
			states: states(harness, node),
			otherDownloaded: otherDownloads.length,
			files: await outputFiles(harness)
		}, { states: ['result outputs/node-1/20261015T080000-abcd.mp4'], otherDownloaded: 1, files: ['outputs/node-1/20261015T080000-abcd.mp4'] });
	}));

	test('records a video another window moved into place but did not record', () => runWithFakedTimers({ startTime: START + 60_000, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, { task: runningTask(harness) }, []);
		const target = joinPath(root, 'outputs/node-1/20261015T080000-abcd.mp4');
		await harness.fileService.writeFile(target, FAKE_MP4);
		harness.service.resume(node);
		await until(() => harness.service.isGenerating(node));
		await until(() => !harness.service.isGenerating(node));
		assert.deepStrictEqual({ states: states(harness, node), downloads: harness.commands.count(DOWNLOAD), files: await outputFiles(harness) },
			{ states: ['result outputs/node-1/20261015T080000-abcd.mp4'], downloads: 1, files: ['outputs/node-1/20261015T080000-abcd.mp4'] });
	}));

	test('draws an SVG to a PNG on white in the window, at least 1024 pixels on its long side', async () => {
		const svg = VSBuffer.fromString('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>');
		const dataUrl = await rasterizeBaseHalfVideoImage(svg, 'image/svg+xml');
		const png = decodeBase64(dataUrl.slice(dataUrl.indexOf(',') + 1)).buffer;
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		assert.deepStrictEqual({
			prefix: dataUrl.startsWith('data:image/png;base64,'),
			signature: [...png.subarray(0, 4)],
			width: view.getUint32(16),
			height: view.getUint32(20)
		}, { prefix: true, signature: [0x89, 0x50, 0x4e, 0x47], width: 1024, height: 512 });
	});

	test('deletes a download and writes nothing when the node no longer runs the task', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		const original = harness.commands.download;
		harness.commands.download = async request => {
			// The file is replaced while the video downloads.
			harness.store.replace(node, { prompt: 'replaced', generation: settings(harness.channel) });
			return original(request);
		};
		await harness.service.generate(node);
		await until(() => !harness.service.isGenerating(node));
		assert.deepStrictEqual({ fields: harness.store.fields(node), states: states(harness, node), files: await outputFiles(harness) },
			{ fields: { prompt: 'replaced', generation: settings(harness.channel) }, states: ['submitting', 'running cgt-remote-1'], files: [] });
	}));
});

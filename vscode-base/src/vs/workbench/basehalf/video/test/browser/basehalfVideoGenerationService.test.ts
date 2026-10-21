/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { decodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { BaseHalfVideoCatalogService } from '../../browser/basehalfVideoCatalogService.js';
import {
	BASEHALF_VIDEO_ORPHANED_SUBMISSION_AGE,
	BASEHALF_VIDEO_TASK_TIME_LIMIT,
	BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT,
	BaseHalfVideoGenerationService,
	orphanedSubmissionMessage,
	rasterizeBaseHalfVideoImage,
	unknownOutcomeMessage
} from '../../browser/basehalfVideoGenerationService.js';
import { BaseHalfVideoProviderSettingsService } from '../../browser/basehalfVideoProviderSettingsService.js';
import { BASEHALF_VIDEO_PROVIDER_COMMANDS, IBaseHalfVideoCheckRequest, IBaseHalfVideoDownloadRequest, IBaseHalfVideoGenerationChoice, IBaseHalfVideoSubmitRequest, planBaseHalfVideoInputs } from '../../common/basehalfVideoCatalog.js';
import { BaseHalfVideoGenerationError, IBaseHalfVideoResolvedInput } from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoGenerationRecord, IBaseHalfVideoNodeFields, IBaseHalfVideoTask } from '../../common/basehalfVideoNode.js';
import { TEST_VIDEO_CATALOG, testVideoModel } from '../common/basehalfVideoCatalogFixture.js';
import { FAKE_MP4, FakeProviderCommands, FakeVideoNodeStore, InMemoryCredentialStore } from './basehalfVideoTestFixtures.js';

const START = Date.parse('2026-10-15T08:00:00.000Z');
const { catalog: CATALOG, check: CHECK, submit: SUBMIT, poll: POLL, download: DOWNLOAD, cancel: CANCEL } = BASEHALF_VIDEO_PROVIDER_COMMANDS;
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const KEY = 'acme-test-key-0123';
const [ACME, BOREALIS] = TEST_VIDEO_CATALOG.providers;

suite('BaseHalfVideoGenerationService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.file('/workspace');

	interface IHarness {
		readonly fileService: FileService;
		readonly store: FakeVideoNodeStore;
		readonly commands: FakeProviderCommands;
		readonly providers: BaseHalfVideoProviderSettingsService;
		readonly service: BaseHalfVideoGenerationService;
		readonly rasterized: string[];
		window(commands: FakeProviderCommands): BaseHalfVideoGenerationService;
	}

	async function createHarness(options: { readonly key?: false } = {}): Promise<IHarness> {
		const owner = disposables.add(new DisposableStore());
		const fileService = owner.add(new FileService(new NullLogService()));
		owner.add(fileService.registerProvider(Schemas.file, owner.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(root);
		const store = new FakeVideoNodeStore(root);
		owner.add({ dispose: () => store.dispose() });
		const commands = new FakeProviderCommands(fileService);
		const providers = owner.add(new BaseHalfVideoProviderSettingsService(owner.add(new InMemoryStorageService()), new InMemoryCredentialStore(), commands, new NullLogService()));
		if (options.key !== false) {
			await providers.setCredential(ACME, 'apiKey', KEY);
		}
		const rasterized: string[] = [];
		const window = (windowCommands: FakeProviderCommands) => {
			const catalog = owner.add(new BaseHalfVideoCatalogService(0, windowCommands, new NullLogService()));
			return owner.add(new BaseHalfVideoGenerationService(async (_bytes, mimeType) => {
				rasterized.push(mimeType);
				return PNG_DATA_URL;
			}, store, catalog, providers, windowCommands, fileService, new NullLogService()));
		};
		return { fileService, store, commands, providers, service: window(commands), rasterized, window };
	}

	function generation(overrides: Partial<IBaseHalfVideoGenerationChoice> = {}): IBaseHalfVideoGenerationChoice {
		return { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true }, ...overrides };
	}

	async function writeInputs(harness: IHarness): Promise<void> {
		await harness.fileService.writeFile(joinPath(root, 'frames/start.png'), VSBuffer.fromString('start-png'));
		await harness.fileService.writeFile(joinPath(root, 'frames/end.png'), VSBuffer.fromString('end-png'));
		await harness.fileService.writeFile(joinPath(root, 'frames/third.png'), VSBuffer.fromString('third-png'));
		await harness.fileService.writeFile(joinPath(root, 'notes/scene.md'), VSBuffer.fromString('---\nupstream:\n  - brief.md\n---\n# Scene\n\nThe sea at dusk.\n'));
		await harness.fileService.writeFile(joinPath(root, 'clips/ref.mp4'), FAKE_MP4);
		for (const path of ['frames/start.png', 'frames/end.png', 'frames/third.png', 'notes/scene.md', 'clips/ref.mp4']) {
			harness.store.addInput(path);
		}
		harness.store.addInput('docs/plan.pdf');
	}

	function shotNode(harness: IHarness, fields: Partial<IBaseHalfVideoNodeFields> = {}, upstream: readonly string[] = ['frames/start.png', 'frames/end.png', 'frames/third.png', 'clips/ref.mp4', 'notes/scene.md', 'docs/plan.pdf']): URI {
		return harness.store.addNode('shots/Shot 1.bhnode', { prompt: '图片1里的人骑车经过海边', generation: generation(), ...fields }, upstream, 'Shot 1');
	}

	function record(overrides: Partial<IBaseHalfVideoGenerationRecord> = {}): IBaseHalfVideoGenerationRecord {
		return {
			provider: 'acme',
			region: 'east',
			model: 'acme-motion-2',
			providerModel: 'acme-motion-2-e-260101',
			mode: 'frames',
			params: { resolution: '720p', duration: 5, sound: true },
			prompt: 'p',
			inputs: [],
			...overrides
		};
	}

	function runningTask(startedAt = START, overrides: Partial<IBaseHalfVideoTask> = {}): IBaseHalfVideoTask {
		return {
			id: '20261015T080000-abcd',
			state: 'running',
			startedAt: new Date(startedAt).toISOString(),
			remoteId: 'cgt-resumed',
			request: record(),
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

	const file = (path: string, mimeType: string) => ({ fsPath: joinPath(root, path).fsPath, mimeType });

	test('runs a generation from the file to a video in outputs, through the check, submitting, and running', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
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
		const sentPrompt = '图片1里的人骑车经过海边\n\n# Scene\n\nThe sea at dusk.';
		const inputs = { startFrame: file('frames/start.png', 'image/png'), endFrame: file('frames/end.png', 'image/png'), images: [], videos: [], audios: [] };
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
				request: record({ prompt: sentPrompt, inputs: ['frames/start.png', 'frames/end.png', 'notes/scene.md'] })
			}
		});
		assert.deepStrictEqual(await outputFiles(harness), [target]);
		assert.strictEqual((await harness.fileService.readFile(joinPath(root, target))).value.toString(), FAKE_MP4.toString());

		const checked = harness.commands.calls.find(call => call.id === CHECK)?.argument as IBaseHalfVideoCheckRequest;
		assert.deepStrictEqual(checked, { provider: 'acme', region: 'east', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true }, prompt: sentPrompt, inputs });
		const request = harness.commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoSubmitRequest;
		assert.deepStrictEqual(request, {
			provider: 'acme',
			region: 'east',
			endpoint: 'https://east.acme.example/api/v1',
			credentials: { apiKey: KEY },
			model: 'acme-motion-2',
			mode: 'frames',
			params: { resolution: '720p', duration: 5, sound: true },
			prompt: sentPrompt,
			inputs
		});
		const download = harness.commands.calls.find(call => call.id === DOWNLOAD)?.argument as IBaseHalfVideoDownloadRequest;
		assert.deepStrictEqual({ remoteId: download.remoteId, model: download.model, videoUrl: download.videoUrl, part: download.targetFsPath.startsWith(joinPath(root, target).fsPath + '.') && download.targetFsPath.endsWith('.part') },
			{ remoteId: 'cgt-remote-1', model: 'acme-motion-2', videoUrl: 'https://cdn.example.com/v.mp4', part: true });
		assert.deepStrictEqual(harness.commands.calls.map(call => call.id), [CATALOG, CHECK, SUBMIT, POLL, POLL, POLL, DOWNLOAD]);
		assert.deepStrictEqual(phases, ['preparing', 'submitting', 'queued', 'generating 0.4', 'downloading', 'ended']);
		assert.deepStrictEqual(harness.providers.getLastUsed(), generation());
	}));

	test('sends the images and the video of references mode, with the defaults of the mode filled in, to the region set up', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		await writeInputs(harness);
		await harness.providers.setRegion(ACME, 'west');
		await harness.providers.setEndpoint(ACME, 'http://127.0.0.1:8123/relay');
		const node = shotNode(harness, { generation: generation({ mode: 'reference', params: { duration: 8, seed: 'not a number' } }) });
		harness.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await harness.service.generate(node);
		const request = harness.commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoSubmitRequest;
		const task = harness.store.fields(node).task!;
		assert.deepStrictEqual({
			request: { ...request, prompt: request.prompt.split('\n\n').length },
			record: { region: task.request.region, providerModel: task.request.providerModel, params: task.request.params, inputs: task.request.inputs }
		}, {
			request: {
				provider: 'acme',
				region: 'west',
				endpoint: 'http://127.0.0.1:8123/relay',
				credentials: { apiKey: KEY },
				model: 'acme-motion-2',
				mode: 'reference',
				params: { resolution: '720p', ratio: '16:9', duration: 8, sound: true },
				prompt: 3,
				inputs: {
					images: [file('frames/start.png', 'image/png'), file('frames/end.png', 'image/png'), file('frames/third.png', 'image/png')],
					videos: [file('clips/ref.mp4', 'video/mp4')],
					audios: []
				}
			},
			record: {
				region: 'west',
				providerModel: 'acme-motion-2-w-260101',
				params: { resolution: '720p', ratio: '16:9', duration: 8, sound: true },
				inputs: ['frames/start.png', 'frames/end.png', 'frames/third.png', 'clips/ref.mp4', 'notes/scene.md']
			}
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

	test('refuses with the first blocker, or the first problem the provider module reports, and writes nothing', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		await harness.fileService.writeFile(joinPath(root, 'frames/start.png'), VSBuffer.fromString('start-png'));
		harness.store.addInput('frames/start.png');
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
		await attempt({ prompt: 'a', generation: { provider: 'acme' } });
		await attempt({ prompt: 'a', generation: generation({ model: 'acme-motion-9' }) });
		await attempt({ prompt: '', generation: generation() }, ['docs/plan.pdf']);
		await attempt({ prompt: 'a', generation: generation(), task: runningTask() });
		await attempt({ prompt: 'a', generation: { provider: 'borealis', model: 'borealis-one' } });
		harness.commands.check = () => ({ ok: true, value: { problems: ['The start frame is smaller than 300 pixels.'] } });
		await attempt({ prompt: 'a', generation: generation() }, ['frames/start.png']);
		await harness.providers.setRegion(ACME, 'west');
		await attempt({ prompt: 'a', generation: { provider: 'acme', model: 'acme-still' } });

		assert.deepStrictEqual(messages, [
			'Choose a model to generate.',
			'acme-motion-9 is not a model BaseHalf offers. Choose another model.',
			'Write a prompt or connect an input to generate.',
			'This node is generating.',
			'Borealis Media is not set up. Set it up in Video Providers.',
			'The start frame is smaller than 300 pixels.',
			'Acme Still is not offered in West · Acme Global. Choose another model, or another region in Video Providers.'
		]);
		assert.strictEqual(harness.commands.count(SUBMIT), 0);
		assert.deepStrictEqual(BOREALIS.credentials.map(credential => credential.id), ['accessKey', 'secretKey']);
	}));

	test('refuses with the reason when the catalog cannot be loaded', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		harness.commands.catalog = () => { throw new Error('command not found'); };
		const node = shotNode(harness, {}, []);
		await assert.rejects(() => harness.service.generate(node), (error: Error) => error instanceof BaseHalfVideoGenerationError
			&& error.message === 'BaseHalf could not load the video models: AI Video, which provides the video models, is not running.');
		assert.deepStrictEqual([harness.store.history(node), harness.commands.count(SUBMIT)], [[], 0]);
	}));

	test('sends nothing when the provider module cannot check the generation', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		harness.commands.check = () => ({ ok: false, error: { code: 'unknownProvider', message: `No module answers for this provider with ${KEY}.` } });
		await assert.rejects(() => harness.service.generate(node), (error: Error) => error instanceof BaseHalfVideoGenerationError
			&& error.message === 'AI Video could not check the generation, and nothing was sent: No module answers for this provider with ***.');
		harness.commands.check = () => { throw new Error('Extension host terminated.'); };
		await assert.rejects(() => harness.service.generate(node), (error: Error) => error.message === 'AI Video could not check the generation, and nothing was sent: AI Video, which sends the request, is not running.');
		assert.deepStrictEqual([harness.store.history(node), harness.commands.count(SUBMIT)], [[], 0]);
	}));

	test('draws an SVG start frame to PNG, has the provider module measure the files, and refuses a missing input by name', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		await harness.fileService.writeFile(joinPath(root, 'frames/start.svg'), VSBuffer.fromString('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
		harness.store.addInput('frames/start.svg');
		const svgNode = shotNode(harness, {}, ['frames/start.svg']);
		harness.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await harness.service.generate(svgNode);
		const request = harness.commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoSubmitRequest;
		assert.deepStrictEqual({ startFrame: request.inputs.startFrame, rasterized: harness.rasterized }, { startFrame: { dataUrl: PNG_DATA_URL }, rasterized: ['image/svg+xml'] });
		await harness.service.stop(svgNode);

		await harness.fileService.writeFile(joinPath(root, 'frames/huge.png'), VSBuffer.alloc(1024));
		harness.store.addInput('frames/huge.png');
		// The provider module measures the files it is given against the mode's limits.
		harness.commands.check = checked => JSON.stringify(checked.inputs).includes('huge.png')
			? { ok: true, value: { problems: ['huge.png is larger than 30 MiB, the most Acme Motion 2 takes.'] } }
			: { ok: true, value: { problems: [] } };
		const hugeNode = harness.store.addNode('shots/Huge.bhnode', { prompt: 'p', generation: generation() }, ['frames/huge.png']);
		await assert.rejects(() => harness.service.generate(hugeNode), (error: Error) => error instanceof BaseHalfVideoGenerationError && error.message === 'huge.png is larger than 30 MiB, the most Acme Motion 2 takes.');

		harness.store.addInput('frames/gone.png');
		const goneNode = harness.store.addNode('shots/Gone.bhnode', { prompt: 'p', generation: generation() }, ['frames/gone.png']);
		await assert.rejects(() => harness.service.generate(goneNode), (error: Error) => error.message === 'gone.png is missing. Connect it again or remove its connection.');
		assert.deepStrictEqual([harness.store.history(hugeNode), harness.store.history(goneNode), harness.commands.count(SUBMIT)], [[], [], 1]);
	}));

	test('sends and records no value that the start frame sets, and keeps it in the node', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const frameSets = { ...ACME, models: ACME.models.map(model => model.id === 'acme-motion-2' ? { ...model, parameters: model.parameters.map(parameter => parameter.name === 'ratio' ? { ...parameter, modes: undefined, setByStartFrame: true } : parameter) } : model) };
		const commands = new FakeProviderCommands(harness.fileService);
		commands.catalog = () => ({ ok: true, value: { schema: 1, providers: [frameSets, BOREALIS] } });
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const service = harness.window(commands);
		await harness.fileService.writeFile(joinPath(root, 'frames/start.png'), VSBuffer.fromString('start-png'));
		harness.store.addInput('frames/start.png');
		const node = shotNode(harness, { generation: generation({ params: { resolution: '720p', duration: 5, sound: true, ratio: '9:16' } }) }, ['frames/start.png']);
		await service.generate(node);
		const checked = commands.calls.find(call => call.id === CHECK)?.argument as { params: Record<string, unknown> };
		const submitted = commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoSubmitRequest;
		const fields = harness.store.fields(node);
		assert.deepStrictEqual({ checked: checked.params, submitted: submitted.params, recorded: fields.task?.request.params, kept: fields.generation?.params }, {
			checked: { resolution: '720p', duration: 5, sound: true },
			submitted: { resolution: '720p', duration: 5, sound: true },
			recorded: { resolution: '720p', duration: 5, sound: true },
			kept: { resolution: '720p', duration: 5, sound: true, ratio: '9:16' }
		});
		await service.stop(node);
	}));

	test('draws an image of a format the mode does not take to PNG, and records the provider id the module would send', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const pngAndJpeg = { ...ACME, models: ACME.models.map(model => ({ ...model, modes: model.modes.map(mode => mode.id === 'frames' ? { ...mode, limits: { ...mode.limits, imageFormats: ['png', 'jpeg'] as const } } : mode) })) };
		const commands = new FakeProviderCommands(harness.fileService);
		commands.catalog = () => ({ ok: true, value: { schema: 1, providers: [pngAndJpeg, BOREALIS] } });
		commands.check = () => ({ ok: true, value: { problems: [], providerModel: 'acme-motion-2-image-260101' } });
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const service = harness.window(commands);
		await harness.fileService.writeFile(joinPath(root, 'frames/start.webp'), VSBuffer.fromString('start-webp'));
		await harness.fileService.writeFile(joinPath(root, 'frames/end.jpg'), VSBuffer.fromString('end-jpg'));
		harness.store.addInput('frames/start.webp');
		harness.store.addInput('frames/end.jpg');
		const node = shotNode(harness, {}, ['frames/start.webp', 'frames/end.jpg']);
		await service.generate(node);
		const request = commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoSubmitRequest;
		assert.deepStrictEqual({
			startFrame: request.inputs.startFrame,
			endFrame: request.inputs.endFrame,
			rasterized: harness.rasterized,
			providerModel: harness.store.fields(node).task?.request.providerModel
		}, {
			startFrame: { dataUrl: PNG_DATA_URL },
			endFrame: file('frames/end.jpg', 'image/jpeg'),
			rasterized: ['image/webp'],
			providerModel: 'acme-motion-2-image-260101'
		});
		await service.stop(node);
	}));

	test('prepares the planned inputs for the panel\'s check as a generation sends them, draws an image to PNG once until it changes, and names an input it cannot send', async () => {
		const harness = await createHarness();
		const remote = disposables.add(new DisposableStore());
		remote.add(harness.fileService.registerProvider(Schemas.vscodeRemote, remote.add(new InMemoryFileSystemProvider())));
		const far = URI.from({ scheme: Schemas.vscodeRemote, authority: 'host', path: '/workspace/frames/far.png' });
		await harness.fileService.writeFile(far, VSBuffer.fromString('far-png'));
		await harness.fileService.writeFile(joinPath(root, 'frames/start.svg'), VSBuffer.fromString('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
		await harness.fileService.writeFile(joinPath(root, 'frames/end.png'), VSBuffer.fromString('end-png'));
		const input = (path: string, file = joinPath(root, path)): IBaseHalfVideoResolvedInput => ({ path, kind: 'image', available: true, file });
		const frames = testVideoModel('acme', 'acme-motion-2').modes[0].inputs;
		const prepare = (inputs: IBaseHalfVideoResolvedInput[]) => harness.service.prepareInputMedia(planBaseHalfVideoInputs(frames, inputs, 'en'), inputs, ['png', 'jpeg', 'webp']);
		const planned = [input('frames/start.svg'), input('frames/end.png')];
		const first = await prepare(planned);
		const again = (await prepare(planned)).startFrame;
		const drawnOnce = [...harness.rasterized];
		await harness.fileService.writeFile(joinPath(root, 'frames/start.svg'), VSBuffer.fromString('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>'));
		await prepare(planned);
		const refusal = (inputs: IBaseHalfVideoResolvedInput[]) => prepare(inputs).then(() => 'prepared', error => `${error instanceof BaseHalfVideoGenerationError}: ${error.message}`);
		assert.deepStrictEqual({
			first,
			again,
			drawnOnce,
			drawnAfterTheChange: harness.rasterized,
			notLocal: await refusal([input('frames/far.png', far)]),
			missing: await refusal([input('frames/gone.png')])
		}, {
			first: { startFrame: { dataUrl: PNG_DATA_URL }, endFrame: file('frames/end.png', 'image/png'), images: [], videos: [], audios: [] },
			again: { dataUrl: PNG_DATA_URL },
			drawnOnce: ['image/svg+xml'],
			drawnAfterTheChange: ['image/svg+xml', 'image/svg+xml'],
			notLocal: 'true: far.png is not a file on this computer.',
			missing: 'true: gone.png is missing. Connect it again or remove its connection.'
		});
	});

	test('ends with the provider\'s message when the credentials are refused, and never shows them', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, {}, []);
		harness.commands.submit = () => ({ ok: false, error: { code: 'auth', message: `The API key ${KEY} is incorrect.`, status: 401 } });
		await harness.service.generate(node);
		await until(() => !harness.service.isGenerating(node));
		const task = harness.store.fields(node).task!;
		assert.deepStrictEqual({ state: task.state, error: task.error, states: states(harness, node), submits: harness.commands.count(SUBMIT) },
			{ state: 'failed', error: 'The provider refused the credentials: The API key *** is incorrect.', states: ['submitting', 'failed'], submits: 1 });
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
		const crashed = harness.store.addNode('shots/Crashed.bhnode', { prompt: 'p', generation: generation() });
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
		}, { states: ['submitting', 'running cgt-remote-1', 'stopped cgt-remote-1'], generating: false, cancel: ['cgt-remote-1'], calls: [CATALOG, CHECK, SUBMIT, POLL, CANCEL], files: [] });
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
			calls: harness.commands.calls.filter(call => call.id !== CATALOG && call.id !== CHECK).map(call => `${call.id} ${(call.argument as { remoteId?: string }).remoteId ?? ''}`.trim())
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

		const unreachable = harness.store.addNode('shots/Unreachable.bhnode', { prompt: 'p', generation: generation() });
		let networkErrors = 0;
		harness.commands.poll = () => {
			networkErrors++;
			return { ok: false, error: { code: 'network', message: 'getaddrinfo ENOTFOUND east.acme.example' } };
		};
		const unreachableStart = Date.now();
		await harness.service.generate(unreachable);
		await until(() => !harness.service.isGenerating(unreachable), 5_000);
		const unreachableTook = Date.now() - unreachableStart;

		const slow = harness.store.addNode('shots/Slow.bhnode', { prompt: 'p', generation: generation() });
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
			unreachable: 'BaseHalf could not reach the provider for 30 minutes. The video may still be made there: check the provider\'s console. (getaddrinfo ENOTFOUND east.acme.example)',
			unreachableInWindow: true,
			retried: true,
			slow: 'The provider did not finish the video within two hours.',
			slowInWindow: true
		});
	}));

	test('follows a running task again after a reload in the region its request records, and completes it', () => runWithFakedTimers({ startTime: START + 60_000, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		// The provider moved to another region since, with a relay of its own.
		await harness.providers.setRegion(ACME, 'west');
		await harness.providers.setEndpoint(ACME, 'https://relay.example.com/west');
		const node = shotNode(harness, { task: runningTask() }, []);
		harness.service.resume(node);
		harness.service.resume(node);
		await until(() => harness.service.isGenerating(node));
		await until(() => !harness.service.isGenerating(node));
		assert.deepStrictEqual({
			states: states(harness, node),
			polled: harness.commands.calls.filter(call => call.id === POLL).map(call => {
				const ref = call.argument as { remoteId: string; region: string; endpoint: string; model: string };
				return `${ref.remoteId} ${ref.region} ${ref.endpoint} ${ref.model}`;
			}),
			submits: harness.commands.count(SUBMIT)
		}, { states: ['result outputs/node-1/20261015T080000-abcd.mp4'], polled: ['cgt-resumed east https://east.acme.example/api/v1 acme-motion-2'], submits: 0 });
	}));

	test('leaves a task whose provider is not set up on this computer to a window that can follow it', () => runWithFakedTimers({ startTime: START + 60_000, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness({ key: false });
		const node = shotNode(harness, { task: runningTask() }, []);
		harness.service.resume(node);
		await timeout(30_000);
		assert.deepStrictEqual({ generating: harness.service.isGenerating(node), state: harness.store.fields(node).task?.state, polls: harness.commands.count(POLL) }, { generating: false, state: 'running', polls: 0 });
	}));

	test('settles a request that was on its way when BaseHalf closed, once it is two minutes old, and never sends it', () => runWithFakedTimers({ startTime: START, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const submitting = (startedAt: number): IBaseHalfVideoTask => {
			const { remoteId: _remoteId, ...task } = runningTask(startedAt, { state: 'submitting' });
			return task as IBaseHalfVideoTask;
		};
		const old = harness.store.addNode('shots/Old.bhnode', { prompt: 'p', generation: generation(), task: submitting(START - 3 * 60_000) });
		const young = harness.store.addNode('shots/Young.bhnode', { prompt: 'p', generation: generation(), task: submitting(START - 30_000) });
		const accepted = harness.store.addNode('shots/Accepted.bhnode', { prompt: 'p', generation: generation(), task: submitting(START - 30_000) });
		for (const node of [old, young, accepted]) {
			harness.service.resume(node);
		}
		await timeout(1_000);
		const youngBefore = harness.store.fields(young).task?.state;
		// Another window records the provider's task id meanwhile.
		harness.store.replace(accepted, { ...harness.store.fields(accepted), task: runningTask(START - 30_000) });
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
			generation: { taskId: 'old', remoteId: 'cgt-old', startedAt: '2026-10-14T08:00:00.000Z', completedAt: '2026-10-14T08:01:00.000Z', request: record() }
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
			siblings: [{ from: '/workspace/shots/Shot 1.bhnode', fields: { prompt: '图片1里的人骑车经过海边', generation: generation() }, upstream: ['frames/start.png', 'notes/scene.md'] }],
			result: true
		});
	}));

	test('of two windows that follow one task, the first that writes the result wins and the other deletes its download', () => runWithFakedTimers({ startTime: START + 60_000, maxTaskCount: 1_000 }, async () => {
		const harness = await createHarness();
		const node = shotNode(harness, { task: runningTask() }, []);
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
		const node = shotNode(harness, { task: runningTask() }, []);
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
			harness.store.replace(node, { prompt: 'replaced', generation: generation() });
			return original(request);
		};
		await harness.service.generate(node);
		await until(() => !harness.service.isGenerating(node));
		assert.deepStrictEqual({ fields: harness.store.fields(node), states: states(harness, node), files: await outputFiles(harness) },
			{ fields: { prompt: 'replaced', generation: generation() }, states: ['submitting', 'running cgt-remote-1'], files: [] });
	}));
});

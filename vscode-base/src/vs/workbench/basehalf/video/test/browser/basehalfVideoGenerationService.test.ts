/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { IBaseHalfReferenceIndexService } from '../../../references/common/basehalfReferenceIndex.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfGenerationCardStore } from '../../browser/basehalfGenerationCardStore.js';
import { baseHalfGenerationTaskFolder, BaseHalfGenerationTaskStore } from '../../browser/basehalfGenerationTaskStore.js';
import { BaseHalfVideoCatalogService } from '../../browser/basehalfVideoCatalogService.js';
import {
	BASEHALF_VIDEO_TASK_TIME_LIMIT,
	BaseHalfVideoGenerationService,
	closedWhileAnsweringMessage,
	orphanedSubmissionMessage,
	unknownOutcomeMessage
} from '../../browser/basehalfVideoGenerationService.js';
import { BaseHalfVideoProviderSettingsService } from '../../browser/basehalfVideoProviderSettingsService.js';
import {
	createBaseHalfGenerationTask,
	heartbeatBaseHalfGenerationTask,
	IBaseHalfGenerationInfo,
	IBaseHalfGenerationRequest,
	IBaseHalfGenerationTask,
	landBaseHalfGenerationTask,
	parseBaseHalfGenerationMade,
	parseBaseHalfGenerationTask,
	recordBaseHalfGenerationLanding,
	runBaseHalfGenerationTask,
	serializeBaseHalfGenerationInfo,
	serializeBaseHalfGenerationTask,
	submitBaseHalfGenerationTask
} from '../../common/basehalfGenerationInfo.js';
import { BASEHALF_VIDEO_PROVIDER_COMMANDS, IBaseHalfVideoDownloadRequest, IBaseHalfVideoSubmitRequest, IBaseHalfVideoTaskRef, planBaseHalfVideoInputs } from '../../common/basehalfVideoCatalog.js';
import { BaseHalfVideoGenerationError, IBaseHalfVideoResolvedInput } from '../../common/basehalfVideoGeneration.js';
import { ACME, BOREALIS, CORVID, TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';
import {
	BaseHalfTestFileSystemProvider,
	FAKE_JPEG,
	FAKE_MP4,
	FAKE_PNG,
	FakeDraftOperations,
	FakeProviderCommands,
	InMemoryCredentialStore,
	RecordingCanvasMirror,
	RecordingUndoRedoService,
	TestChecksumService,
	testDigestHex
} from './basehalfVideoTestFixtures.js';

const START = Date.parse('2026-10-22T08:00:00.000Z');
const { catalog: CATALOG, check: CHECK, submit: SUBMIT, poll: POLL, download: DOWNLOAD, cancel: CANCEL } = BASEHALF_VIDEO_PROVIDER_COMMANDS;
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const KEY = 'acme-test-key-0123';
const CORVID_KEY = 'corvid-test-key-4567';
const [ACME_PROVIDER, , CORVID_PROVIDER] = TEST_GENERATION_CATALOG.providers;

const VIDEO: IBaseHalfGenerationInfo = { prompt: '图片1 rides along the sea.', provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } };
const IMAGE: IBaseHalfGenerationInfo = { prompt: 'A heron at dawn.', provider: 'corvid', model: 'corvid-paint', mode: 'reference', params: { resolution: '1k', count: 1 } };
const REQUEST: IBaseHalfGenerationRequest = {
	provider: 'acme', region: 'east', model: 'acme-motion-2', providerModel: 'acme-motion-2-e-260101', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true }, prompt: 'Rain.', inputs: []
};

interface IWindow {
	readonly service: BaseHalfVideoGenerationService;
	readonly tasks: BaseHalfGenerationTaskStore;
	readonly cards: BaseHalfGenerationCardStore;
	readonly commands: FakeProviderCommands;
	readonly drafts: FakeDraftOperations;
}

interface IHarness {
	readonly root: URI;
	readonly fileService: FileService;
	readonly providers: BaseHalfVideoProviderSettingsService;
	readonly canvas: RecordingCanvasMirror;
	readonly undo: RecordingUndoRedoService;
	readonly rasterized: string[];
	readonly first: IWindow;
	/** Another window of the same workspace on this computer. */
	window(): IWindow;
	resource(path: string): URI;
	write(path: string, content: string | VSBuffer): Promise<void>;
	read(path: string): Promise<string | undefined>;
	exists(path: string): Promise<boolean>;
	/** Makes a card's generation information, and its upstream list when given. */
	card(path: string, info: IBaseHalfGenerationInfo, upstream?: readonly string[]): Promise<URI>;
	/** The task records on disk. */
	records(): Promise<IBaseHalfGenerationTask[]>;
	/** The names in `.bh/cache/generation/`. */
	cache(): Promise<string[]>;
	dispose(): void;
}

suite('BaseHalfVideoGenerationService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.file('/workspace');

	async function createHarness(options: { readonly records?: readonly IBaseHalfGenerationTask[]; readonly files?: Readonly<Record<string, string | VSBuffer>> } = {}): Promise<IHarness> {
		const owner = disposables.add(new DisposableStore());
		const fileService = owner.add(new FileService(new NullLogService()));
		owner.add(fileService.registerProvider(Schemas.file, owner.add(new BaseHalfTestFileSystemProvider())));
		await fileService.createFolder(root);
		for (const [path, content] of Object.entries(options.files ?? {})) {
			await fileService.writeFile(joinPath(root, ...path.split('/')), typeof content === 'string' ? VSBuffer.fromString(content) : content);
		}
		for (const task of options.records ?? []) {
			await fileService.writeFile(joinPath(baseHalfGenerationTaskFolder(root), `${task.id}.json`), VSBuffer.fromString(serializeBaseHalfGenerationTask(task)));
		}
		const resource = (path: string) => joinPath(root, ...path.split('/'));
		const storage = owner.add(new InMemoryStorageService());
		const credentials = new InMemoryCredentialStore();
		const uriIdentity = owner.add(new UriIdentityService(fileService));
		const canvas = new RecordingCanvasMirror(root);
		const undo = new RecordingUndoRedoService();
		const rasterized: string[] = [];
		const settingsCommands = new FakeProviderCommands(fileService);
		const providers = owner.add(new BaseHalfVideoProviderSettingsService(storage, credentials, settingsCommands, new NullLogService()));
		await providers.setCredential(ACME_PROVIDER, 'apiKey', KEY);
		await providers.setCredential(CORVID_PROVIDER, 'apiKey', CORVID_KEY);
		const window = (): IWindow => {
			const commands = new FakeProviderCommands(fileService);
			commands.catalog = () => ({ ok: true, value: { schema: 1, providers: [ACME, BOREALIS, CORVID] } });
			const context = new TestContextService(testWorkspace(root));
			const catalogService = owner.add(new BaseHalfVideoCatalogService(0, commands, new NullLogService()));
			const tasks = owner.add(new BaseHalfGenerationTaskStore(fileService, context, uriIdentity, new NullLogService()));
			const cards = owner.add(new BaseHalfGenerationCardStore(
				fileService,
				context,
				uriIdentity,
				{} as IBaseHalfReferenceEditService,
				{ acceptSavedContent: () => { } } as Partial<IBaseHalfReferenceIndexService> as IBaseHalfReferenceIndexService,
				canvas.asService(),
				catalogService,
				new TestNotificationService(),
				new NullLogService()
			));
			const drafts = new FakeDraftOperations(fileService, root);
			drafts.taskStore = tasks;
			const service = owner.add(new BaseHalfVideoGenerationService(
				async (_bytes, mimeType) => {
					rasterized.push(mimeType);
					return PNG_DATA_URL;
				},
				cards,
				tasks,
				drafts,
				catalogService,
				providers,
				new BaseHalfWorkspaceMutationCoordinator(),
				canvas.asService(),
				new TestChecksumService(fileService),
				undo.asService(),
				commands,
				fileService,
				context,
				uriIdentity,
				new TestNotificationService(),
				new NullLogService()
			));
			return { service, tasks, cards, commands, drafts };
		};
		const read = async (path: string) => {
			try {
				return (await fileService.readFile(resource(path))).value.toString();
			} catch {
				return undefined;
			}
		};
		const write = async (path: string, content: string | VSBuffer) => {
			await fileService.writeFile(resource(path), typeof content === 'string' ? VSBuffer.fromString(content) : content);
		};
		return {
			root,
			fileService,
			providers,
			canvas,
			undo,
			rasterized,
			first: window(),
			window,
			resource,
			write,
			read,
			exists: path => fileService.exists(resource(path)),
			card: async (path, info, upstream) => {
				await write(`.bh/mirror/${path}/generation.yaml`, serializeBaseHalfGenerationInfo(info));
				if (upstream) {
					await write(`.bh/mirror/${path}/upstream.yaml`, `upstream:\n${upstream.map(entry => `  - ${entry}\n`).join('')}`);
				}
				return resource(path);
			},
			records: async () => {
				const stat = await fileService.resolve(baseHalfGenerationTaskFolder(root)).catch(() => undefined);
				const records: IBaseHalfGenerationTask[] = [];
				for (const child of stat?.children ?? []) {
					if (child.name.endsWith('.json')) {
						records.push(parseBaseHalfGenerationTask((await fileService.readFile(child.resource)).value.toString())!);
					}
				}
				return records;
			},
			cache: async () => ((await fileService.resolve(baseHalfGenerationTaskFolder(root)).catch(() => undefined))?.children ?? []).map(child => child.name).sort(),
			dispose: () => owner.dispose()
		};
	}

	async function until(condition: () => boolean | Promise<boolean>, step = 500, limit = 3 * BASEHALF_VIDEO_TASK_TIME_LIMIT): Promise<void> {
		for (let waited = 0; !await condition(); waited += step) {
			if (waited > limit) {
				throw new Error('The condition did not come true.');
			}
			await timeout(step);
		}
	}

	/** A record that a window which is gone left behind: said alive two minutes ago. */
	function staleTask(state: 'preparing' | 'submitting' | 'running' | 'landing', options: { readonly id?: string; readonly cards?: readonly string[]; readonly answersAtOnce?: boolean; readonly kind?: 'image' | 'video'; readonly startedAt?: number } = {}): IBaseHalfGenerationTask {
		const started = new Date(options.startedAt ?? START - 120_000).toISOString();
		let task = createBaseHalfGenerationTask({ id: options.id ?? '20261022T075800-dead0001', kind: options.kind ?? 'video', cards: options.cards ?? ['shots/video.mp4'], follower: 'wgone', now: started });
		if (state === 'preparing') {
			return task;
		}
		task = submitBaseHalfGenerationTask(task, REQUEST, 'Rain.', options.answersAtOnce ?? false);
		if (state === 'submitting') {
			return task;
		}
		task = runBaseHalfGenerationTask(task, 'cgt-7');
		return state === 'running' ? task : landBaseHalfGenerationTask(task);
	}

	test('runs a task from Generate to the file on its card: preparing, submitting, running, landing, made.yaml, and the record removed', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		await harness.write('frames/start.png', FAKE_PNG);
		await harness.write('frames/end.png', FAKE_PNG);
		await harness.write('notes/scene.md', '---\nupstream: []\n---\n# Scene\n\nThe sea at dusk.\n');
		const video = await harness.card('shots/video.mp4', VIDEO, ['frames/start.png', 'frames/end.png', 'notes/scene.md']);
		const { service, tasks, commands } = harness.first;
		const polls = [
			{ ok: true, value: { state: 'pending' } },
			{ ok: true, value: { state: 'running', fraction: 0.4 } },
			{ ok: true, value: { state: 'succeeded', videoUrl: 'https://cdn.example.com/v.mp4' } }
		];
		commands.poll = () => polls.shift();
		const states: string[] = [];
		disposables.add(tasks.onDidChange(() => {
			const state = tasks.list().map(task => `${task.state}${task.remoteId ? ` ${task.remoteId}` : ''}`).join() || 'removed';
			if (states.at(-1) !== state) {
				states.push(state);
			}
		}));
		const phases: string[] = [];
		disposables.add(service.onDidChangeProgress(card => {
			const progress = service.getProgress(card);
			const phase = progress ? `${progress.phase}${progress.fraction !== undefined ? ` ${progress.fraction}` : ''}` : 'ended';
			if (phases.at(-1) !== phase) {
				phases.push(phase);
			}
		}));

		const cards = await service.generate(video);
		const started = tasks.forCard(video)!;
		const whileSubmitting = [started.state, service.isGenerating(video)];
		await until(() => !service.isGenerating(video));

		const made = parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/video.mp4/made.yaml'))!);
		const submitted = commands.calls.find(call => call.id === SUBMIT)?.argument as IBaseHalfVideoSubmitRequest;
		const download = commands.calls.find(call => call.id === DOWNLOAD)?.argument as IBaseHalfVideoDownloadRequest;
		const sentPrompt = '图片1 rides along the sea.\n\n# Scene\n\nThe sea at dusk.';
		assert.deepStrictEqual({
			cards: cards.map(card => card.path),
			whileSubmitting,
			states,
			phases,
			file: (await harness.read('shots/video.mp4')) === FAKE_MP4.toString(),
			made: { ...made, finishedAt: undefined },
			cache: await harness.cache(),
			calls: commands.calls.map(call => call.id),
			submitted: { ...submitted, inputs: Object.keys(submitted.inputs), targets: submitted.targets?.map(target => target.slice(root.fsPath.length)) },
			download: { url: download.url, kind: download.kind, remoteId: download.remoteId, target: download.targetFsPath.slice(root.fsPath.length) },
			lastUsed: harness.providers.getLastUsed('video')
		}, {
			cards: ['/workspace/shots/video.mp4'],
			whileSubmitting: ['submitting', true],
			states: ['preparing', 'submitting', 'running cgt-remote-1', 'landing cgt-remote-1', 'removed'],
			phases: ['preparing', 'waiting', 'generating 0.4', 'saving', 'ended'],
			file: true,
			made: {
				id: started.id,
				startedAt: started.startedAt,
				finishedAt: undefined,
				remoteId: 'cgt-remote-1',
				provider: 'acme',
				region: 'east',
				model: 'acme-motion-2',
				providerModel: 'acme-motion-2-e-260101',
				mode: 'frames',
				params: { resolution: '720p', duration: 5, sound: true },
				prompt: '图片1 rides along the sea.',
				inputs: ['frames/start.png', 'frames/end.png', 'notes/scene.md']
			},
			cache: [],
			calls: [CATALOG, CHECK, SUBMIT, POLL, POLL, POLL, DOWNLOAD],
			submitted: {
				provider: 'acme',
				region: 'east',
				endpoint: 'https://east.acme.example/api/v1',
				credentials: { apiKey: KEY },
				model: 'acme-motion-2',
				mode: 'frames',
				params: { resolution: '720p', duration: 5, sound: true },
				prompt: sentPrompt,
				inputs: ['startFrame', 'endFrame', 'images', 'videos', 'audios'],
				targets: [`/.bh/cache/generation/${started.id}-1.part`]
			},
			download: { url: 'https://cdn.example.com/v.mp4', kind: 'video', remoteId: 'cgt-remote-1', target: `/.bh/cache/generation/${started.id}-1.part` },
			lastUsed: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } }
		});
		harness.dispose();
	}));

	test('lands the files of a provider that answers at once without asking about a task, and keeps the last values of images apart', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', IMAGE);
		const { service, commands } = harness.first;
		commands.submit = async request => ({ ok: true, value: { outputs: [await commands.write(request.targets![0], FAKE_PNG)] } });
		const cards = await service.generate(image);
		await until(() => !service.isGenerating(image));
		assert.deepStrictEqual({
			cards: cards.map(card => card.path),
			file: (await harness.read('shots/image.png')) === FAKE_PNG.toString(),
			made: parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/image.png/made.yaml'))!)?.providerModel,
			calls: commands.calls.map(call => call.id),
			cache: await harness.cache(),
			lastUsed: [harness.providers.getLastUsed('image')?.model, harness.providers.getLastUsed('video')]
		}, {
			cards: ['/workspace/shots/image.png'],
			file: true,
			made: 'paint-n-1',
			calls: [CATALOG, CHECK, SUBMIT],
			cache: [],
			lastUsed: ['corvid-paint', undefined]
		});
		harness.dispose();
	}));

	test('several images make their drafts in a row to the right before sending, land one image on each, and fail a refused one alone', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		harness.canvas.place('shots', { path: 'shots/image.png', kind: 'file', x: 0, y: 0, width: 300, height: 220 });
		const image = await harness.card('shots/image.png', { ...IMAGE, params: { count: 4 } }, ['refs/look.png']);
		await harness.write('refs/look.png', FAKE_PNG);
		const { service, commands, tasks } = harness.first;
		let draftsWhenSent: boolean[] = [];
		commands.submit = async request => {
			draftsWhenSent = await Promise.all(['image-2.png', 'image-3.png', 'image-4.png'].map(name => harness.exists(`.bh/mirror/shots/${name}/generation.yaml`)));
			const targets = request.targets!;
			return { ok: true, value: { outputs: [await commands.write(targets[0], FAKE_PNG), await commands.write(targets[1], FAKE_PNG), { refused: 'The image showed a real person.' }, await commands.write(targets[3], FAKE_PNG)] } };
		};
		const cards = await service.generate(image);
		await until(async () => (await harness.records()).some(task => task.state === 'failed'));
		const record = (await harness.records())[0];
		const madeOf = async (name: string) => {
			const made = parseBaseHalfGenerationMade((await harness.read(`.bh/mirror/shots/${name}/made.yaml`)) ?? '');
			return made ? `${made.id.slice(-2)} ${made.output}/${made.outputs}` : undefined;
		};
		assert.deepStrictEqual({
			cards: cards.map(card => card.path.slice('/workspace/'.length)),
			draftsWhenSent,
			copies: [await harness.read('.bh/mirror/shots/image-2.png/generation.yaml'), await harness.read('.bh/mirror/shots/image-3.png/upstream.yaml')],
			files: await Promise.all(['image.png', 'image-2.png', 'image-3.png', 'image-4.png'].map(name => harness.exists(`shots/${name}`))),
			made: [await madeOf('image.png'), await madeOf('image-2.png'), await madeOf('image-3.png'), await madeOf('image-4.png')],
			record: [record.state, record.cards.map(card => `${card.path}:${card.state}${card.error ? `: ${card.error}` : ''}`)],
			refusedCard: tasks.forCard(harness.resource('shots/image-3.png'))?.state,
			rows: harness.canvas.layouts.get('shots')?.map(card => `${card.path} ${card.x},${card.y} ${card.width}x${card.height}`),
			undoSteps: harness.undo.elements.map(element => element.label)
		}, {
			cards: ['shots/image.png', 'shots/image-2.png', 'shots/image-3.png', 'shots/image-4.png'],
			draftsWhenSent: [true, true, true],
			copies: [serializeBaseHalfGenerationInfo({ ...IMAGE, params: { count: 4 } }), 'upstream:\n  - refs/look.png\n'],
			files: [true, true, false, true],
			made: ['-1 1/4', '-2 2/4', undefined, '-4 4/4'],
			record: ['failed', [
				'shots/image.png:landed',
				'shots/image-2.png:landed',
				'shots/image-3.png:failed: The provider refused this one: The image showed a real person.',
				'shots/image-4.png:landed'
			]],
			refusedCard: 'failed',
			rows: [
				'shots/image.png 0,0 300x220',
				'shots/image-2.png 340,0 300x220',
				'shots/image-3.png 680,0 300x220',
				'shots/image-4.png 1020,0 300x220'
			],
			undoSteps: ['Generate']
		});
		harness.dispose();
	}));

	test('the cards that the provider made no image for fail as such', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', { ...IMAGE, params: { count: 3 } });
		const { service, commands } = harness.first;
		commands.submit = async request => ({ ok: true, value: { outputs: [await commands.write(request.targets![0], FAKE_PNG), await commands.write(request.targets![1], FAKE_PNG)] } });
		await service.generate(image);
		await until(async () => (await harness.records()).some(task => task.state === 'failed'));
		assert.deepStrictEqual((await harness.records())[0].cards.map(card => `${card.state}${card.error ? `: ${card.error}` : ''}`), ['landed', 'landed', 'failed: The provider made fewer images than asked.']);
		harness.dispose();
	}));

	test('an image that arrives in another format renames its draft to that format\'s extension and lands there', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', IMAGE);
		const { service, commands, drafts } = harness.first;
		commands.submit = async request => ({ ok: true, value: { outputs: [await commands.write(request.targets![0], FAKE_JPEG)] } });
		await service.generate(image);
		await until(async () => !(await harness.records()).length && await harness.exists('.bh/mirror/shots/image.jpg/made.yaml'));
		assert.deepStrictEqual({
			moves: drafts.moves,
			png: await harness.exists('shots/image.png'),
			jpg: (await harness.read('shots/image.jpg')) === FAKE_JPEG.toString(),
			made: !!parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/image.jpg/made.yaml'))!),
			draftLeft: await harness.exists('.bh/mirror/shots/image.png')
		}, { moves: ['shots/image.png -> shots/image.jpg'], png: false, jpg: true, made: true, draftLeft: false });
		harness.dispose();
	}));

	test('a folder that is gone is made again for the file, and a path taken by then gets the next free name with a copy of the card\'s settings', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		harness.canvas.place('scenes/new', { path: 'scenes/new/clip.mp4', kind: 'file', x: 0, y: 0, width: 720, height: 405 });
		const clip = await harness.card('scenes/new/clip.mp4', VIDEO);
		const taken = await harness.card('shots/taken.mp4', VIDEO);
		const { service, commands } = harness.first;
		let release: () => void = () => { };
		const held = new Promise<void>(resolve => release = resolve);
		commands.poll = async request => {
			await held;
			return { ok: true, value: { state: 'succeeded', videoUrl: `https://cdn.example.com/${request.remoteId}.mp4` } };
		};
		await service.generate(clip);
		await service.generate(taken);
		// A file appears at the path of the second draft while it generates: it becomes that draft's file.
		await harness.write('shots/taken.mp4', 'dropped by the user');
		release();
		await until(async () => !(await harness.records()).length && await harness.exists('.bh/mirror/shots/taken-2.mp4/made.yaml') && await harness.exists('.bh/mirror/scenes/new/clip.mp4/made.yaml'));
		assert.deepStrictEqual({
			made: (await harness.read('scenes/new/clip.mp4')) === FAKE_MP4.toString(),
			dropped: await harness.read('shots/taken.mp4'),
			beside: (await harness.read('shots/taken-2.mp4')) === FAKE_MP4.toString(),
			besideInfo: await harness.read('.bh/mirror/shots/taken-2.mp4/generation.yaml'),
			besideMade: !!await harness.read('.bh/mirror/shots/taken-2.mp4/made.yaml'),
			takenMade: await harness.exists('.bh/mirror/shots/taken.mp4/made.yaml')
		}, {
			made: true,
			dropped: 'dropped by the user',
			beside: true,
			besideInfo: serializeBaseHalfGenerationInfo(VIDEO),
			besideMade: true,
			takenMade: false
		});
		harness.dispose();
	}));

	test('after a crash between the move and made.yaml, the window that takes the record over writes made.yaml without a second download', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const landing = recordBaseHalfGenerationLanding(staleTask('landing'), 0, { path: 'shots/video.mp4', size: FAKE_MP4.byteLength, sha256: testDigestHex(FAKE_MP4) });
		// The window that followed it is gone; this one opens the workspace.
		const harness = await createHarness({
			records: [landing],
			files: { 'shots/video.mp4': FAKE_MP4, '.bh/mirror/shots/video.mp4/generation.yaml': serializeBaseHalfGenerationInfo(VIDEO) }
		});
		await until(async () => !(await harness.records()).length);
		const made = parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/video.mp4/made.yaml'))!);
		assert.deepStrictEqual({
			made: [made?.id, made?.remoteId],
			calls: harness.first.commands.calls.map(call => call.id).filter(id => id !== CATALOG),
			file: (await harness.read('shots/video.mp4')) === FAKE_MP4.toString()
		}, { made: [landing.id, 'cgt-7'], calls: [], file: true });
		harness.dispose();
	}));

	test('Stop ends the task as stopped, asks the provider to cancel, and keeps no file that arrives later', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const image = await harness.card('shots/image.png', IMAGE);
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running', fraction: 0.2 } });
		await service.generate(video);
		await until(() => service.getProgress(video)?.phase === 'generating');
		await service.stop(video);
		// A provider that answers at once answers after the stop.
		const answer = new DeferredPromise<void>();
		commands.submit = async request => {
			await answer.p;
			return { ok: true, value: { outputs: [await commands.write(request.targets![0], FAKE_PNG)] } };
		};
		await service.generate(image);
		await service.stop(image);
		answer.complete();
		await timeout(20_000);
		const records = await harness.records();
		assert.deepStrictEqual({
			states: records.map(task => `${task.cards[0].path}:${task.state}`).sort(),
			cancelled: commands.calls.filter(call => call.id === CANCEL).map(call => (call.argument as IBaseHalfVideoTaskRef).remoteId),
			files: [await harness.exists('shots/video.mp4'), await harness.exists('shots/image.png')],
			cache: (await harness.cache()).filter(name => name.endsWith('.part')),
			generating: [service.isGenerating(video), service.isGenerating(image)]
		}, {
			states: ['shots/image.png:stopped', 'shots/video.mp4:stopped'],
			cancelled: ['cgt-remote-1'],
			files: [false, false],
			cache: [],
			generating: [false, false]
		});
		harness.dispose();
	}));

	test('another window settles what a window that is gone left: a request on its way fails with the message of its provider, one not yet sent is removed, and one alive is left', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const tasks = staleTask('submitting', { id: '20261022T075800-dead0002', cards: ['shots/a.mp4'] });
		const atOnce = staleTask('submitting', { id: '20261022T075800-dead0003', cards: ['shots/b.mp4'], answersAtOnce: true });
		const preparing = staleTask('preparing', { id: '20261022T075800-dead0004', cards: ['shots/c.mp4'] });
		const alive = heartbeatBaseHalfGenerationTask(staleTask('submitting', { id: '20261022T075800-dead0005', cards: ['shots/d.mp4'] }), 'walive', new Date(START - 10_000).toISOString());
		const harness = await createHarness({ records: [tasks, atOnce, preparing, alive] });
		const byId = async () => new Map((await harness.records()).map(task => [task.id, task]));
		await until(async () => (await byId()).get(tasks.id)?.state === 'failed' && (await byId()).get(atOnce.id)?.state === 'failed' && !(await byId()).has(preparing.id));
		const meanwhile = (await byId()).get(alive.id)?.state;
		await until(async () => (await byId()).get(alive.id)?.state === 'failed');
		const records = await byId();
		assert.deepStrictEqual({
			tasks: records.get(tasks.id)?.error,
			atOnce: records.get(atOnce.id)?.error,
			meanwhile,
			alive: [records.get(alive.id)?.error, Date.now() - START >= 80_000],
			sent: harness.first.commands.count(SUBMIT)
		}, {
			tasks: orphanedSubmissionMessage(),
			atOnce: closedWhileAnsweringMessage(),
			meanwhile: 'submitting',
			alive: [orphanedSubmissionMessage(), true],
			sent: 0
		});
		harness.dispose();
	}));

	test('another window takes over a running task that no window follows, asks about it in the region it records, and lands it', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const running = staleTask('running');
		const harness = await createHarness({ records: [running], files: { '.bh/mirror/shots/video.mp4/generation.yaml': serializeBaseHalfGenerationInfo(VIDEO) } });
		const { commands } = harness.first;
		const polls = [{ ok: true, value: { state: 'running' } }, { ok: true, value: { state: 'running' } }];
		commands.poll = () => polls.shift() ?? { ok: true, value: { state: 'succeeded' } };
		await until(async () => (await harness.records()).some(task => task.follower === harness.first.service.follower));
		const taken = (await harness.records())[0];
		await until(async () => !(await harness.records()).length, 500, 60_000);
		const poll = commands.calls.find(call => call.id === POLL)?.argument as IBaseHalfVideoTaskRef;
		const download = commands.calls.find(call => call.id === DOWNLOAD)?.argument as IBaseHalfVideoDownloadRequest;
		assert.deepStrictEqual({
			taken: [taken.state, Date.parse(taken.aliveAt) >= START],
			poll: [poll.remoteId, poll.region, poll.endpoint],
			download: [download.remoteId, download.url],
			file: (await harness.read('shots/video.mp4')) === FAKE_MP4.toString(),
			made: parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/video.mp4/made.yaml'))!)?.id,
			submits: commands.count(SUBMIT)
		}, {
			taken: ['running', true],
			poll: ['cgt-7', 'east', 'https://east.acme.example/api/v1'],
			download: ['cgt-7', undefined],
			file: true,
			made: running.id,
			submits: 0
		});
		harness.dispose();
	}));

	test('a window says every 30 seconds that it follows its generation, and another window leaves that generation alone', () => runWithFakedTimers({ startTime: START, maxTaskCount: 20_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const other = harness.window();
		await service.generate(video);
		await timeout(200_000);
		const record = (await harness.records())[0];
		assert.deepStrictEqual({
			follower: record.follower === service.follower,
			alive: Date.now() - Date.parse(record.aliveAt) <= 31_000,
			otherPolled: other.commands.count(POLL),
			otherGenerating: other.service.isGenerating(video)
		}, { follower: true, alive: true, otherPolled: 0, otherGenerating: true });
		await service.stop(video);
		harness.dispose();
	}));

	test('two windows that generate the same draft at once send one request; the other is told that the card is already generating', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const second = harness.window();
		harness.first.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		second.commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const results = await Promise.allSettled([harness.first.service.generate(video), second.service.generate(video)]);
		const again = await second.service.generate(video).then(() => 'started', (error: Error) => error.message);
		assert.deepStrictEqual({
			outcomes: results.map(result => result.status === 'fulfilled' ? 'started' : (result.reason as Error).message).sort(),
			sent: harness.first.commands.count(SUBMIT) + second.commands.count(SUBMIT),
			records: (await harness.records()).length,
			again
		}, {
			outcomes: ['This card is already generating.', 'started'],
			sent: 1,
			records: 1,
			again: 'This card is already generating.'
		});
		await harness.first.service.stop(video);
		harness.dispose();
	}));

	test('generating from a card with its file makes a draft to its right with the same prompt, settings, and inputs; a blocker stops before any draft', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		harness.canvas.place('shots', { path: 'shots/shot.mp4', kind: 'file', x: 100, y: 50, width: 720, height: 405 });
		const shot = await harness.card('shots/shot.mp4', VIDEO, ['refs/a.png']);
		await harness.write('shots/shot.mp4', FAKE_MP4);
		await harness.write('shots/shot-2.mp4', FAKE_MP4);
		await harness.write('.bh/mirror/shots/shot.mp4/made.yaml', 'id: "earlier"\n');
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const cards = await service.generate(shot);
		const blocked = await harness.card('shots/other.mp4', { ...VIDEO, provider: 'borealis', model: 'borealis-one', mode: undefined, params: undefined });
		await harness.write('shots/other.mp4', FAKE_MP4);
		const refusal = await service.generate(blocked).then(() => 'started', (error: Error) => `${error instanceof BaseHalfVideoGenerationError}: ${error.message}`);
		assert.deepStrictEqual({
			cards: cards.map(card => card.path),
			info: await harness.read('.bh/mirror/shots/shot-3.mp4/generation.yaml'),
			upstream: await harness.read('.bh/mirror/shots/shot-3.mp4/upstream.yaml'),
			original: [await harness.read('.bh/mirror/shots/shot.mp4/made.yaml'), service.isGenerating(shot)],
			row: harness.canvas.layouts.get('shots')?.find(card => card.path === 'shots/shot-3.mp4'),
			refusal,
			noDraft: await harness.exists('.bh/mirror/shots/other-2.mp4'),
			records: (await harness.records()).map(task => task.cards.map(card => card.path).join())
		}, {
			cards: ['/workspace/shots/shot-3.mp4'],
			info: serializeBaseHalfGenerationInfo(VIDEO),
			upstream: 'upstream:\n  - refs/a.png\n',
			original: ['id: "earlier"\n', false],
			row: { path: 'shots/shot-3.mp4', kind: 'file', x: 860, y: 50, width: 720, height: 405 },
			refusal: 'true: Borealis Media is not set up. Set it up in Providers.',
			noDraft: false,
			records: ['shots/shot-3.mp4']
		});
		await service.stop(cards[0]);
		harness.dispose();
	}));

	test('an agent\'s request stops with the first value the model does not accept, and a card whose input is a draft does not generate', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', { ...VIDEO, params: { duration: 99 } });
		const withDraft = await harness.card('shots/next.mp4', VIDEO, ['shots/still.png']);
		await harness.card('shots/still.png', IMAGE);
		const { service, commands } = harness.first;
		const refusals = await Promise.all([
			service.generate(video, { agent: true }).then(() => 'started', (error: Error) => error.message),
			service.generate(withDraft).then(() => 'started', (error: Error) => error.message)
		]);
		assert.deepStrictEqual({ refusals, sent: commands.count(SUBMIT), records: (await harness.records()).length }, {
			refusals: ['Acme Motion 2 does not accept 99 for Duration.', 'still.png has no file yet. Generate it first, or remove its connection.'],
			sent: 0,
			records: 0
		});
		harness.dispose();
	}));

	test('ends with the provider\'s message when the credentials are refused, never showing them, and never sends again a request whose outcome is unknown', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const refused = await harness.card('shots/refused.mp4', VIDEO);
		const unknown = await harness.card('shots/unknown.mp4', VIDEO);
		const { service, commands } = harness.first;
		commands.submit = () => ({ ok: false, error: { code: 'auth', message: `The API key ${KEY} is incorrect.`, status: 401 } });
		await service.generate(refused);
		commands.submit = () => ({ ok: false, error: { code: 'unknownOutcome', message: 'The connection closed after the request was sent.' } });
		await service.generate(unknown);
		await until(async () => (await harness.records()).filter(task => task.state === 'failed').length === 2);
		await timeout(60_000);
		const errors = new Map((await harness.records()).map(task => [task.cards[0].path, task.error]));
		assert.deepStrictEqual({ refused: errors.get('shots/refused.mp4'), unknown: errors.get('shots/unknown.mp4'), sent: commands.count(SUBMIT), polls: commands.count(POLL) }, {
			refused: 'The provider refused the credentials: The API key *** is incorrect.',
			unknown: `${unknownOutcomeMessage()} (The connection closed after the request was sent.)`,
			sent: 2,
			polls: 0
		});
		harness.dispose();
	}));

	test('a task that has not ended two hours after its start fails with a message that says so', () => runWithFakedTimers({ startTime: START, maxTaskCount: 50_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await service.generate(video);
		await until(async () => (await harness.records())[0]?.state === 'failed', 60_000);
		assert.deepStrictEqual([(await harness.records())[0].error, Date.now() - START >= BASEHALF_VIDEO_TASK_TIME_LIMIT], ['The provider did not finish the video within two hours.', true]);
		harness.dispose();
	}));

	test('a card deleted while its generation of several images runs gets no file, and the others land', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', { ...IMAGE, model: 'corvid-print', params: { count: 2 } });
		const { service, commands } = harness.first;
		let polls = 0;
		commands.poll = () => ++polls < 3
			? { ok: true, value: { state: 'running' } }
			: { ok: true, value: { state: 'succeeded', outputs: [{ url: 'https://cdn.corvid.example/1.jpg' }, { url: 'https://cdn.corvid.example/2.jpg' }] } };
		commands.download = async request => {
			await harness.fileService.writeFile(URI.file(request.targetFsPath), FAKE_JPEG);
			return { ok: true, value: { size: FAKE_JPEG.byteLength, format: 'jpeg' } };
		};
		const [, second] = await service.generate(image);
		await until(() => polls >= 1);
		await service.releaseCard(second);
		// The canvas deletes the draft's card information after releasing it.
		await harness.fileService.del(harness.resource('.bh/mirror/shots/image-2.png'), { recursive: true });
		await until(async () => !(await harness.records()).length);
		const downloads = commands.calls.filter(call => call.id === DOWNLOAD).map(call => (call.argument as IBaseHalfVideoDownloadRequest).url);
		assert.deepStrictEqual({
			downloads,
			files: [await harness.exists('shots/image.jpg'), await harness.exists('shots/image-2.jpg'), await harness.exists('shots/image-2.png')],
			made: parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/image.jpg/made.yaml'))!)?.output
		}, {
			downloads: ['https://cdn.corvid.example/1.jpg'],
			files: [true, false, false],
			made: 1
		});
		harness.dispose();
	}));

	test('draws an SVG start frame to PNG, has the provider module measure the files, and refuses an input it cannot send by name', async () => {
		const harness = await createHarness();
		const remote = disposables.add(new DisposableStore());
		remote.add(harness.fileService.registerProvider(Schemas.vscodeRemote, remote.add(new BaseHalfTestFileSystemProvider())));
		const far = URI.from({ scheme: Schemas.vscodeRemote, authority: 'host', path: '/workspace/frames/far.png' });
		await harness.fileService.writeFile(far, VSBuffer.fromString('far-png'));
		await harness.write('frames/start.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
		await harness.write('frames/end.png', FAKE_PNG);
		const input = (path: string, file = harness.resource(path)): IBaseHalfVideoResolvedInput => ({ path, kind: 'image', available: true, file });
		const frames = TEST_GENERATION_CATALOG.providers[0].models[0].modes[0];
		const prepare = (inputs: IBaseHalfVideoResolvedInput[]) => harness.first.service.prepareInputMedia(planBaseHalfVideoInputs(frames.inputs, inputs, 'en'), inputs, ['png', 'jpeg', 'webp']);
		const planned = [input('frames/start.svg'), input('frames/end.png')];
		const first = await prepare(planned);
		await prepare(planned);
		const drawnOnce = [...harness.rasterized];
		const refusal = (inputs: IBaseHalfVideoResolvedInput[]) => prepare(inputs).then(() => 'prepared', error => `${error instanceof BaseHalfVideoGenerationError}: ${error.message}`);
		assert.deepStrictEqual({
			first,
			drawnOnce,
			notLocal: await refusal([input('frames/far.png', far)]),
			missing: await refusal([input('frames/gone.png')])
		}, {
			first: { startFrame: { dataUrl: PNG_DATA_URL }, endFrame: { fsPath: harness.resource('frames/end.png').fsPath, mimeType: 'image/png' }, images: [], videos: [], audios: [] },
			drawnOnce: ['image/svg+xml'],
			notLocal: 'true: far.png is not a file on this computer.',
			missing: 'true: gone.png is missing. Connect it again or remove its connection.'
		});
		harness.dispose();
	});
});

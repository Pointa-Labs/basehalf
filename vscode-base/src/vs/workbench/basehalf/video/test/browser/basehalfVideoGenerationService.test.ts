/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { dirname, joinPath } from '../../../../../base/common/resources.js';
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
import { baseHalfCanvasGenerationCardSize } from '../../../canvas/common/basehalfCanvasModel.js';
import {
	baseHalfGenerationInfoOfMade,
	createBaseHalfGenerationTask,
	failBaseHalfGenerationTask,
	heartbeatBaseHalfGenerationTask,
	IBaseHalfGenerationInfo,
	IBaseHalfGenerationMade,
	IBaseHalfGenerationRequest,
	IBaseHalfGenerationTask,
	landBaseHalfGenerationTask,
	parseBaseHalfGenerationMade,
	parseBaseHalfGenerationTask,
	recordBaseHalfGenerationLanding,
	runBaseHalfGenerationTask,
	serializeBaseHalfGenerationInfo,
	serializeBaseHalfGenerationMade,
	serializeBaseHalfGenerationTask,
	stopBaseHalfGenerationTask,
	submitBaseHalfGenerationTask
} from '../../common/basehalfGenerationInfo.js';
import { BASEHALF_VIDEO_PROVIDER_COMMANDS, IBaseHalfVideoCatalogProvider, IBaseHalfVideoDownloadRequest, IBaseHalfVideoPlaceRequest, IBaseHalfVideoSubmitRequest, IBaseHalfVideoTaskRef, planBaseHalfVideoInputs } from '../../common/basehalfVideoCatalog.js';
import { BaseHalfVideoGenerationError, IBaseHalfVideoResolvedInput } from '../../common/basehalfVideoGeneration.js';
import { ACME, BOREALIS, CORVID, TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';
import {
	BaseHalfTestFileSystemProvider,
	FAKE_JPEG,
	FAKE_MP4,
	FAKE_PNG,
	fakeWrittenPrompt,
	FakeDraftOperations,
	FakeMovedItemsService,
	FakeProviderCommands,
	FakeReferenceEditService,
	InMemoryCredentialStore,
	RecordingCanvasMirror,
	RecordingUndoRedoService,
	TestChecksumService,
	testDigestHex
} from './basehalfVideoTestFixtures.js';

const START = Date.parse('2026-10-22T08:00:00.000Z');
const { catalog: CATALOG, check: CHECK, submit: SUBMIT, poll: POLL, download: DOWNLOAD, cancel: CANCEL, place: PLACE } = BASEHALF_VIDEO_PROVIDER_COMMANDS;
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const KEY = 'acme-test-key-0123';
const CORVID_KEY = 'corvid-test-key-4567';
const [ACME_PROVIDER, , CORVID_PROVIDER] = TEST_GENERATION_CATALOG.providers;

const VIDEO: IBaseHalfGenerationInfo = { prompt: 'A rider passes along the sea.', provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } };
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
	readonly provider: BaseHalfTestFileSystemProvider;
	readonly providers: BaseHalfVideoProviderSettingsService;
	readonly canvas: RecordingCanvasMirror;
	readonly moves: FakeMovedItemsService;
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

	async function createHarness(options: { readonly records?: readonly IBaseHalfGenerationTask[]; readonly files?: Readonly<Record<string, string | VSBuffer>>; readonly caseInsensitive?: boolean; readonly catalogProviders?: readonly IBaseHalfVideoCatalogProvider[] } = {}): Promise<IHarness> {
		const owner = disposables.add(new DisposableStore());
		const fileService = owner.add(new FileService(new NullLogService()));
		const provider = owner.add(new BaseHalfTestFileSystemProvider({ caseInsensitive: options.caseInsensitive }));
		owner.add(fileService.registerProvider(Schemas.file, provider));
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
		const references = new FakeReferenceEditService(fileService);
		const moves = new FakeMovedItemsService();
		const undo = new RecordingUndoRedoService();
		const rasterized: string[] = [];
		const settingsCommands = new FakeProviderCommands(fileService);
		const providers = owner.add(new BaseHalfVideoProviderSettingsService(storage, credentials, settingsCommands, new NullLogService()));
		await providers.setCredential(ACME_PROVIDER, 'apiKey', KEY);
		await providers.setCredential(CORVID_PROVIDER, 'apiKey', CORVID_KEY);
		const window = (): IWindow => {
			const commands = new FakeProviderCommands(fileService);
			commands.catalog = () => ({ ok: true, value: { schema: 1, providers: [...(options.catalogProviders ?? [ACME, BOREALIS, CORVID])] } });
			const context = new TestContextService(testWorkspace(root));
			const catalogService = owner.add(new BaseHalfVideoCatalogService(0, commands, new NullLogService()));
			const tasks = owner.add(new BaseHalfGenerationTaskStore(fileService, context, uriIdentity, new NullLogService()));
			const cards = owner.add(new BaseHalfGenerationCardStore(
				fileService,
				context,
				uriIdentity,
				references.asService(),
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
				moves.asService(),
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
			provider,
			providers,
			canvas,
			moves,
			undo,
			rasterized,
			first: window(),
			window,
			resource,
			write,
			read,
			exists: path => fileService.exists(resource(path)),
			card: async (path, info, upstream) => {
				// A card is on the canvas of a folder that exists.
				await fileService.createFolder(dirname(resource(path)));
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

	/** What made a file: its `made.yaml`. */
	function madeRecord(request: IBaseHalfGenerationRequest, id = '20261022T075000-made0001'): IBaseHalfGenerationMade {
		return { ...request, id, startedAt: new Date(START - 600_000).toISOString(), finishedAt: new Date(START - 540_000).toISOString() };
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
		// The prompt mentions the start frame and the note (D74).
		const video = await harness.card('shots/video.mp4', { ...VIDEO, prompt: '@[frames/start.png] rides along the sea, as @[notes/scene.md] says.' }, ['frames/start.png', 'frames/end.png', 'notes/scene.md']);
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
		const placed = commands.calls.find(call => call.id === PLACE)?.argument as IBaseHalfVideoPlaceRequest;
		// Each mention as its input's place in the request, which the provider module names; the note under its name.
		const sentPrompt = [{ input: 'startFrame' }, ' rides along the sea, as "scene" says.\n\nscene:\n# Scene\n\nThe sea at dusk.'];
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
			placed: { from: placed.from.slice(root.fsPath.length), to: placed.to.slice(root.fsPath.length) },
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
				prompt: '@[frames/start.png] rides along the sea, as @[notes/scene.md] says.',
				inputs: ['frames/start.png', 'frames/end.png', 'notes/scene.md']
			},
			cache: [],
			calls: [CATALOG, CHECK, SUBMIT, POLL, POLL, POLL, DOWNLOAD, PLACE],
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
			// The complete partial download gets the card's name in one step: nothing partial is ever in the card's folder.
			placed: { from: `/.bh/cache/generation/${started.id}-1.part`, to: '/shots/video.mp4' },
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
			calls: [CATALOG, CHECK, SUBMIT, PLACE],
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
			// Each card that landed is a card with its file: its record says what made it, and its generation.yaml is gone (D67).
			copies: [undefined, 'upstream:\n  - refs/look.png\n'],
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
			inTheLandingLease: drafts.leased,
			png: await harness.exists('shots/image.png'),
			jpg: (await harness.read('shots/image.jpg')) === FAKE_JPEG.toString(),
			made: !!parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/image.jpg/made.yaml'))!),
			draftLeft: await harness.exists('.bh/mirror/shots/image.png')
		}, { moves: ['shots/image.png -> shots/image.jpg'], inTheLandingLease: [true], png: false, jpg: true, made: true, draftLeft: false });
		harness.dispose();
	}));

	test('a folder that is gone is made again for the file, and a path taken by then gets the next free name with its own record', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
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
		// The folder of the first draft is deleted to the trash while it generates; its card information stays.
		await harness.fileService.del(harness.resource('scenes/new'), { recursive: true });
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
			besideInfo: undefined,
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

	test('generating a card with its file, as an agent does, makes a new version to its right from its record without the seed, and generates that; a blocker stops before any draft (D67)', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		harness.canvas.place('shots', { path: 'shots/shot.mp4', kind: 'file', x: 100, y: 50, width: 720, height: 405 });
		const shot = harness.resource('shots/shot.mp4');
		await harness.write('shots/shot.mp4', FAKE_MP4);
		await harness.write('shots/shot-2.mp4', FAKE_MP4);
		// What an earlier build left beside the file is not read: its record says what made it.
		await harness.write('.bh/mirror/shots/shot.mp4/generation.yaml', serializeBaseHalfGenerationInfo({ ...VIDEO, prompt: 'Changed since.' }));
		const record = madeRecord({ ...REQUEST, params: { ...REQUEST.params, seed: 7 }, prompt: VIDEO.prompt, inputs: ['refs/a.png'] });
		await harness.write('.bh/mirror/shots/shot.mp4/made.yaml', serializeBaseHalfGenerationMade(record));
		await harness.write('.bh/mirror/shots/shot.mp4/upstream.yaml', 'upstream:\n  - refs/a.png\n');
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const cards = await service.generate(shot, { agent: true });
		await until(async () => harness.undo.elements.length > 0);
		const other = harness.resource('shots/other.mp4');
		await harness.write('shots/other.mp4', FAKE_MP4);
		await harness.write('.bh/mirror/shots/other.mp4/made.yaml', serializeBaseHalfGenerationMade(madeRecord({ ...REQUEST, provider: 'borealis', region: 'main', model: 'borealis-one', providerModel: 'b1' }, 'other')));
		const refusal = await service.generate(other, { agent: true }).then(() => 'started', (error: Error) => `${error instanceof BaseHalfVideoGenerationError}: ${error.message}`);
		assert.deepStrictEqual({
			cards: cards.map(card => card.path),
			info: await harness.read('.bh/mirror/shots/shot-3.mp4/generation.yaml'),
			upstream: await harness.read('.bh/mirror/shots/shot-3.mp4/upstream.yaml'),
			original: [await harness.read('.bh/mirror/shots/shot.mp4/made.yaml') === serializeBaseHalfGenerationMade(record), service.isGenerating(shot)],
			row: harness.canvas.layouts.get('shots')?.find(card => card.path === 'shots/shot-3.mp4'),
			undoSteps: harness.undo.elements.map(element => element.label),
			refusal,
			noDraft: await harness.exists('.bh/mirror/shots/other-2.mp4'),
			records: (await harness.records()).map(task => task.cards.map(card => card.path).join())
		}, {
			cards: ['/workspace/shots/shot-3.mp4'],
			info: serializeBaseHalfGenerationInfo(baseHalfGenerationInfoOfMade(record)),
			upstream: 'upstream:\n  - refs/a.png\n',
			original: [true, false],
			row: { path: 'shots/shot-3.mp4', kind: 'file', x: 860, y: 50, ...baseHalfCanvasGenerationCardSize('video') },
			undoSteps: ['New Version'],
			refusal: 'true: Borealis Media is not set up. Set it up in Providers.',
			noDraft: false,
			records: ['shots/shot-3.mp4']
		});
		await service.stop(cards[0]);
		harness.dispose();
	}));

	test('a prompt that mentions a file that is not connected does not generate; the task record keeps the prompt as the module wrote it (D74)', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		await harness.write('refs/a.png', FAKE_PNG);
		const stray = await harness.card('shots/stray.mp4', { ...VIDEO, prompt: '@[refs/a.png] meets @[refs/hero.png].' }, ['refs/a.png']);
		const named = await harness.card('shots/named.mp4', { ...VIDEO, prompt: 'From @[refs/a.png] on.' }, ['refs/a.png']);
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const refusal = await service.generate(stray).then(() => 'started', (error: Error) => error.message);
		const sentBefore = commands.count(SUBMIT);
		const [card] = await service.generate(named);
		const record = (await harness.records()).find(task => task.cards.some(candidate => candidate.path === 'shots/named.mp4'));
		assert.deepStrictEqual({ refusal, sentBefore, sentPrompt: record?.sentPrompt, recorded: record?.request?.prompt }, {
			refusal: 'The prompt mentions hero.png, which is not connected.',
			sentBefore: 0,
			sentPrompt: 'From <startFrame> on.',
			recorded: 'From @[refs/a.png] on.'
		});
		await service.stop(card);
		harness.dispose();
	}));

	test('a draft whose input no mode of its model can use does not generate, and the mode that is used follows the inputs (D67)', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		await harness.write('refs/a.png', FAKE_PNG);
		await harness.write('refs/clip.mp4', FAKE_MP4);
		await harness.write('refs/second.mp4', FAKE_MP4);
		const twoVideos = await harness.card('shots/two.mp4', VIDEO, ['refs/clip.mp4', 'refs/second.mp4']);
		const withVideo = await harness.card('shots/with.mp4', VIDEO, ['refs/a.png', 'refs/clip.mp4']);
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const refusal = await service.generate(twoVideos).then(() => 'started', (error: Error) => error.message);
		const [card] = await service.generate(withVideo);
		const record = (await harness.records()).find(task => task.cards.some(candidate => candidate.path === 'shots/with.mp4'));
		assert.deepStrictEqual({
			refusal,
			sentMode: commands.calls.filter(call => call.id === SUBMIT).map(call => (call.argument as IBaseHalfVideoSubmitRequest).mode),
			recordedMode: record?.request?.mode,
			ownMode: (await harness.read('.bh/mirror/shots/with.mp4/generation.yaml'))?.includes('mode: "frames"')
		}, {
			refusal: 'second.mp4 cannot be sent: Acme Motion 2 takes one video at most.',
			sentMode: ['reference'],
			recordedMode: 'reference',
			ownMode: true
		});
		await service.stop(card);
		harness.dispose();
	}));

	test('Generate asks the region about the mode that is used, as the panel does (D67)', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		// Frames only in the west, and the key is set up in the east.
		const westFrames: IBaseHalfVideoCatalogProvider = { ...ACME, models: ACME.models.map(model => model.id === 'acme-motion-2' ? { ...model, modes: model.modes.map(mode => mode.id === 'frames' ? { ...mode, regions: ['west'] } : mode) } : model) };
		const harness = await createHarness({ catalogProviders: [westFrames, BOREALIS, CORVID] });
		await harness.write('refs/a.png', FAKE_PNG);
		await harness.write('refs/clip.mp4', FAKE_MP4);
		const framesOnly = await harness.card('shots/frames.mp4', VIDEO, ['refs/a.png']);
		// A video among the inputs: the references mode is used, which the east offers.
		const withVideo = await harness.card('shots/with.mp4', VIDEO, ['refs/a.png', 'refs/clip.mp4']);
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const refusal = await service.generate(framesOnly).then(() => 'started', (error: Error) => error.message);
		const [card] = await service.generate(withVideo);
		assert.deepStrictEqual({
			refusal,
			sentMode: commands.calls.filter(call => call.id === SUBMIT).map(call => (call.argument as IBaseHalfVideoSubmitRequest).mode)
		}, {
			refusal: 'Acme Motion 2 offers Frames mode only in West · Acme Global. Choose another mode, or another region in Providers.',
			sentMode: ['reference']
		});
		await service.stop(card);
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

	test('a draft whose card information is gone when its file arrives gets no file, however it was deleted', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands } = harness.first;
		let polls = 0;
		commands.poll = request => ++polls < 3
			? { ok: true, value: { state: 'running' } }
			: { ok: true, value: { state: 'succeeded', videoUrl: `https://cdn.example.com/${request.remoteId}.mp4` } };
		await service.generate(video);
		await until(() => polls >= 1);
		// Deleted without the generation being released first.
		await harness.fileService.del(harness.resource('.bh/mirror/shots/video.mp4'), { recursive: true });
		await until(async () => !(await harness.records()).length);
		assert.deepStrictEqual({
			file: await harness.exists('shots/video.mp4'),
			information: await harness.exists('.bh/mirror/shots/video.mp4'),
			cache: await harness.cache()
		}, { file: false, information: false, cache: [] });
		harness.dispose();
	}));

	test('a generation that finished while no window asked lands, however long after its start it is asked', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		// The laptop slept, or BaseHalf was closed, for three hours; the provider finished long ago.
		const running = staleTask('running', { startedAt: START - 3 * 60 * 60_000 });
		const harness = await createHarness({ records: [running], files: { '.bh/mirror/shots/video.mp4/generation.yaml': serializeBaseHalfGenerationInfo(VIDEO) } });
		const { commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'succeeded', videoUrl: 'https://cdn.example.com/late.mp4' } });
		await until(async () => !(await harness.records()).length, 500, 60_000);
		assert.deepStrictEqual({
			file: (await harness.read('shots/video.mp4')) === FAKE_MP4.toString(),
			made: parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/video.mp4/made.yaml'))!)?.id,
			polls: commands.count(POLL)
		}, { file: true, made: running.id, polls: 1 });
		harness.dispose();
	}));

	test('a request that AI Video was running when it stopped has an unknown outcome; nothing was sent only when the command was never there', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const lost = await harness.card('shots/lost.mp4', VIDEO);
		const missing = await harness.card('shots/missing.mp4', VIDEO);
		const { service, commands } = harness.first;
		// The extension host stopped while the request was on its way: the call is refused, and the command is gone with it.
		commands.submit = () => { throw new Error('Canceled'); };
		await service.generate(lost);
		commands.submit = () => { throw new Error(`command '${SUBMIT}' not found`); };
		await service.generate(missing);
		await until(async () => (await harness.records()).filter(task => task.state === 'failed').length === 2, 500, 60_000);
		const errors = new Map((await harness.records()).map(task => [task.cards[0].path, task.error]));
		assert.deepStrictEqual([errors.get('shots/lost.mp4'), errors.get('shots/missing.mp4')], [
			`${unknownOutcomeMessage()} (Canceled)`,
			'Nothing was sent to the provider: AI Video, which sends the request, is not running.'
		]);
		harness.dispose();
	}));

	test('files a provider answers after another window ended the record as failed land all the same', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', IMAGE);
		const { service, commands, tasks } = harness.first;
		const answer = new DeferredPromise<void>();
		commands.submit = async request => {
			await answer.p;
			return { ok: true, value: { outputs: [await commands.write(request.targets![0], FAKE_PNG)] } };
		};
		await service.generate(image);
		// Another window took this one for gone, as after a sleep, and ended the record while the provider made the image.
		const record = (await harness.records())[0];
		await harness.fileService.writeFile(joinPath(baseHalfGenerationTaskFolder(root), `${record.id}.json`), VSBuffer.fromString(serializeBaseHalfGenerationTask(failBaseHalfGenerationTask(record, closedWhileAnsweringMessage(), new Date(Date.now()).toISOString()))));
		await until(() => tasks.get(record.id)?.state === 'failed');
		answer.complete();
		await until(async () => !(await harness.records()).length, 500, 60_000);
		assert.deepStrictEqual({
			file: (await harness.read('shots/image.png')) === FAKE_PNG.toString(),
			made: parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots/image.png/made.yaml'))!)?.id,
			cache: await harness.cache()
		}, { file: true, made: record.id, cache: [] });
		harness.dispose();
	}));

	test('a file whose draft information is not where its record says lands beside its card with its own record', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO, ['refs/a.png']);
		const { service, commands } = harness.first;
		let release: () => void = () => { };
		const held = new Promise<void>(resolve => release = resolve);
		commands.poll = async request => {
			await held;
			return { ok: true, value: { state: 'succeeded', videoUrl: `https://cdn.example.com/${request.remoteId}.mp4` } };
		};
		await service.generate(video);
		// A move that went half way: the draft's generation.yaml went to its new name, its connections stayed, and the record still names the old one.
		await harness.fileService.move(harness.resource('.bh/mirror/shots/video.mp4/generation.yaml'), harness.resource('.bh/mirror/shots/moved.mp4/generation.yaml'));
		release();
		await until(async () => !(await harness.records()).length, 500, 120_000);
		assert.deepStrictEqual({
			beside: (await harness.read('shots/video-2.mp4')) === FAKE_MP4.toString(),
			info: await harness.read('.bh/mirror/shots/video-2.mp4/generation.yaml'),
			made: !!(await harness.read('.bh/mirror/shots/video-2.mp4/made.yaml')),
			old: await harness.exists('shots/video.mp4')
		}, { beside: true, info: undefined, made: true, old: false });
		harness.dispose();
	}));

	test('a file whose card information is gone while a move is followed is kept on its card\'s path, with its record', () => runWithFakedTimers({ startTime: START, maxTaskCount: 20_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands } = harness.first;
		let release: () => void = () => { };
		const held = new Promise<void>(resolve => release = resolve);
		commands.poll = async request => {
			await held;
			return { ok: true, value: { state: 'succeeded', videoUrl: `https://cdn.example.com/${request.remoteId}.mp4` } };
		};
		await service.generate(video);
		// Following a move outside BaseHalf has taken the card information away and not finished.
		harness.moves.settled = false;
		harness.moves.moving.add('shots/video.mp4');
		await harness.fileService.del(harness.resource('.bh/mirror/shots/video.mp4'), { recursive: true });
		release();
		await until(async () => !(await harness.records()).length, 500, 300_000);
		assert.deepStrictEqual({
			file: (await harness.read('shots/video.mp4')) === FAKE_MP4.toString(),
			info: await harness.read('.bh/mirror/shots/video.mp4/generation.yaml'),
			made: !!(await harness.read('.bh/mirror/shots/video.mp4/made.yaml'))
		}, { file: true, info: undefined, made: true });
		harness.dispose();
	}));

	test('undoing the new version that generating a card with its file made, once it got its file, changes nothing, and the next undo goes to the step before', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const shot = harness.resource('shots/shot.mp4');
		await harness.write('shots/shot.mp4', FAKE_MP4);
		await harness.write('.bh/mirror/shots/shot.mp4/made.yaml', serializeBaseHalfGenerationMade(madeRecord(REQUEST)));
		const { service, drafts } = harness.first;
		await service.generate(shot, { agent: true });
		await until(async () => !(await harness.records()).length && harness.undo.elements.length > 0);
		const [step] = harness.undo.elements;
		await step.undo();
		assert.deepStrictEqual({
			label: step.label,
			steps: harness.undo.elements.length,
			deleted: drafts.deleted,
			file: await harness.exists('shots/shot-2.mp4'),
			made: await harness.exists('.bh/mirror/shots/shot-2.mp4/made.yaml')
		}, { label: 'New Version', steps: 1, deleted: [], file: true, made: true });
		harness.dispose();
	}));

	test('undoing Generate removes the further drafts of several images when they are as the generation made them, in whatever order the card\'s settings were written', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const print = await harness.card('shots/print.jpg', IMAGE);
		// As an agent may write them: the values of params in an order of its own.
		await harness.write('.bh/mirror/shots/print.jpg/generation.yaml', 'prompt: "Rain."\nprovider: "corvid"\nmodel: "corvid-print"\nmode: "reference"\nparams:\n  count: 2\n  resolution: "2k"\n');
		const { service, commands, drafts } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const [draft] = await service.generate(print);
		await service.stop(draft);
		await harness.undo.elements[0].undo();
		assert.deepStrictEqual({ deleted: drafts.deleted, steps: harness.undo.elements.length }, { deleted: ['shots/print-2.jpg'], steps: 1 });
		harness.dispose();
	}));

	test('a card whose file is gone does not generate: a missing file is not a draft', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		await harness.write('.bh/mirror/shots/video.mp4/made.yaml', 'id: "earlier"\n');
		const { service, commands } = harness.first;
		const refusal = await service.generate(video).then(() => 'started', (error: Error) => `${error instanceof BaseHalfVideoGenerationError}: ${error.message}`);
		assert.deepStrictEqual({ refusal, sent: commands.count(SUBMIT), records: (await harness.records()).length }, {
			refusal: 'true: video.mp4 is not there any more: it was moved or deleted. Restore it to generate from it.',
			sent: 0,
			records: 0
		});
		harness.dispose();
	}));

	test('a window says it follows its generation from the moment it writes the record, so a long preparation is not taken for a window that is gone', () => runWithFakedTimers({ startTime: START, maxTaskCount: 20_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands } = harness.first;
		const other = harness.window();
		// The provider module takes long to check, as a keychain prompt or a slow check can.
		commands.check = async request => {
			await timeout(150_000);
			return { ok: true, value: { problems: [], prompt: fakeWrittenPrompt(request.prompt) } };
		};
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		const started = await service.generate(video).then(() => 'started', (error: Error) => error.message);
		assert.deepStrictEqual({ started, sent: commands.count(SUBMIT), records: (await harness.records()).length, otherPolled: other.commands.count(POLL) }, {
			started: 'started',
			sent: 1,
			records: 1,
			otherPolled: 0
		});
		await service.stop(video);
		harness.dispose();
	}));

	test('a problem before the file is moved keeps the file and tries again', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const clip = await harness.card('scenes/new/clip.mp4', VIDEO);
		const { service, commands } = harness.first;
		let release: () => void = () => { };
		const held = new Promise<void>(resolve => release = resolve);
		commands.poll = async request => {
			await held;
			return { ok: true, value: { state: 'succeeded', videoUrl: `https://cdn.example.com/${request.remoteId}.mp4` } };
		};
		await service.generate(clip);
		await harness.fileService.del(harness.resource('scenes/new'), { recursive: true });
		// Making the folder again is refused once.
		harness.provider.failures.set('mkdir:/workspace/scenes/new', 1);
		release();
		await until(async () => !(await harness.records()).length, 500, 120_000);
		assert.deepStrictEqual({
			file: (await harness.read('scenes/new/clip.mp4')) === FAKE_MP4.toString(),
			made: !!(await harness.read('.bh/mirror/scenes/new/clip.mp4/made.yaml'))
		}, { file: true, made: true });
		harness.dispose();
	}));

	test('a file that is in place without the record of how it was made says so, and stays', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service } = harness.first;
		harness.provider.failures.set('exclusive:/workspace/.bh/mirror/shots/video.mp4/made.yaml', 10);
		await service.generate(video);
		await until(async () => (await harness.records())[0]?.state === 'failed', 500, 120_000);
		const error = (await harness.records())[0].cards[0].error ?? '';
		assert.deepStrictEqual({
			file: (await harness.read('shots/video.mp4')) === FAKE_MP4.toString(),
			error: error.startsWith('The video is in its folder, but BaseHalf could not record how it was made: ')
		}, { file: true, error: true });
		harness.dispose();
	}));

	test('the sizes and SHA-256 of every file a provider answered with at once are in the record before the first of them lands', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', { ...IMAGE, params: { count: 3 } });
		const { service, commands, tasks } = harness.first;
		commands.submit = async request => {
			const outputs = [];
			for (const target of request.targets!) {
				outputs.push(await commands.write(target, FAKE_PNG));
			}
			return { ok: true, value: { outputs } };
		};
		let firstMarked: number[] | undefined;
		disposables.add(tasks.onDidChange(() => {
			const task = tasks.list()[0];
			if (!firstMarked && task?.cards.some(card => card.landing)) {
				firstMarked = task.cards.flatMap((card, index) => card.landing ? [index] : []);
			}
		}));
		await service.generate(image);
		await until(async () => !(await harness.records()).length);
		assert.deepStrictEqual(firstMarked, [0, 1, 2]);
		harness.dispose();
	}));

	test('landing lets a move that is being followed finish before it makes a folder again', () => runWithFakedTimers({ startTime: START, maxTaskCount: 20_000 }, async () => {
		const harness = await createHarness();
		const clip = await harness.card('scenes/new/clip.mp4', VIDEO);
		const { service, commands, tasks } = harness.first;
		let release: () => void = () => { };
		const held = new Promise<void>(resolve => release = resolve);
		commands.poll = async request => {
			await held;
			return { ok: true, value: { state: 'succeeded', videoUrl: `https://cdn.example.com/${request.remoteId}.mp4` } };
		};
		await service.generate(clip);
		// The folder is renamed outside BaseHalf, and following it has not finished.
		harness.moves.settled = false;
		harness.moves.moving.add('scenes/new');
		await harness.fileService.move(harness.resource('scenes/new'), harness.resource('scenes/old'));
		release();
		await until(() => commands.count(DOWNLOAD) === 1);
		await timeout(2_000);
		// Following the move takes the card information along and writes the card's new path into its record.
		await harness.fileService.move(harness.resource('.bh/mirror/scenes/new'), harness.resource('.bh/mirror/scenes/old'));
		await tasks.retarget(harness.resource('scenes/new'), harness.resource('scenes/old'));
		harness.moves.settle();
		await until(async () => !(await harness.records()).length, 500, 120_000);
		assert.deepStrictEqual({
			landed: (await harness.read('scenes/old/clip.mp4')) === FAKE_MP4.toString(),
			oldFolder: await harness.exists('scenes/new')
		}, { landed: true, oldFolder: false });
		harness.dispose();
	}));

	test('an image that lands beside a card whose path a file took has its own format\'s extension, and leaves no other draft', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', IMAGE);
		const { service, commands } = harness.first;
		commands.submit = async request => {
			// A file is dropped at the draft's path while the provider makes the image.
			await harness.write('shots/image.png', FAKE_PNG);
			return { ok: true, value: { outputs: [await commands.write(request.targets![0], FAKE_JPEG)] } };
		};
		await service.generate(image);
		await until(async () => !(await harness.records()).length);
		assert.deepStrictEqual({
			dropped: (await harness.read('shots/image.png')) === FAKE_PNG.toString(),
			beside: (await harness.read('shots/image.jpg')) === FAKE_JPEG.toString(),
			info: await harness.read('.bh/mirror/shots/image.jpg/generation.yaml'),
			made: !!(await harness.read('.bh/mirror/shots/image.jpg/made.yaml')),
			strays: [await harness.exists('shots/image-2.png'), await harness.exists('.bh/mirror/shots/image-2.png')]
		}, { dropped: true, beside: true, info: undefined, made: true, strays: [false, false] });
		harness.dispose();
	}));

	test('releasing the only card of a generation stops it and removes its record with the card', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await service.generate(video);
		await until(() => service.getProgress(video)?.phase === 'generating');
		await service.releaseCard(video);
		assert.deepStrictEqual({ records: (await harness.records()).length, cancelled: commands.count(CANCEL), generating: service.isGenerating(video) }, { records: 0, cancelled: 1, generating: false });
		harness.dispose();
	}));

	test('a card deleted after its generation ended without its file takes the record with it, once no other card of the record is left to say why', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const ended = new Date(START - 60_000).toISOString();
		// Ended on this computer before: a video that failed, one the user stopped, and two images of one generation that both failed.
		const failed = failBaseHalfGenerationTask(staleTask('running', { id: '20261022T075800-dead0011', cards: ['shots/failed.mp4'] }), 'The provider refused the credentials.', ended);
		const stopped = stopBaseHalfGenerationTask(staleTask('running', { id: '20261022T075800-dead0012', cards: ['shots/stopped.mp4'] }), ended);
		const images = failBaseHalfGenerationTask(staleTask('running', { id: '20261022T075800-dead0013', kind: 'image', cards: ['shots/heron.png', 'shots/heron-2.png'] }), 'The provider refused the request.', ended);
		const harness = await createHarness({
			records: [failed, stopped, images],
			files: {
				'.bh/mirror/shots/failed.mp4/generation.yaml': serializeBaseHalfGenerationInfo(VIDEO),
				'.bh/mirror/shots/stopped.mp4/generation.yaml': serializeBaseHalfGenerationInfo(VIDEO),
				'.bh/mirror/shots/heron.png/generation.yaml': serializeBaseHalfGenerationInfo(IMAGE),
				'.bh/mirror/shots/heron-2.png/generation.yaml': serializeBaseHalfGenerationInfo(IMAGE)
			}
		});
		const { service, tasks } = harness.first;
		await tasks.whenReady();
		const ids = async () => (await harness.records()).map(task => task.id).sort();
		const before = await ids();
		// The canvas releases a draft before the draft operations delete its card information.
		await service.releaseCard(harness.resource('shots/failed.mp4'));
		await service.releaseCard(harness.resource('shots/stopped.mp4'));
		// Undoing the delete brings the draft back without the old error.
		const shown = ['shots/failed.mp4', 'shots/stopped.mp4'].map(path => tasks.forCard(harness.resource(path))?.state ?? 'draft');
		// One image of two goes: the other still says why its generation ended.
		await service.releaseCard(harness.resource('shots/heron.png'));
		const oneImage = await ids();
		await harness.fileService.del(harness.resource('.bh/mirror/shots/heron.png'), { recursive: true });
		await service.releaseCard(harness.resource('shots/heron-2.png'));
		assert.deepStrictEqual({ before, shown, oneImage, after: await ids() }, {
			before: [failed.id, stopped.id, images.id],
			shown: ['draft', 'draft'],
			oneImage: [images.id],
			after: []
		});
		harness.dispose();
	}));

	test('deleting every card of a generation of several images while it runs leaves no record behind', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const image = await harness.card('shots/image.png', { ...IMAGE, model: 'corvid-print', params: { count: 2 } });
		const { service, commands } = harness.first;
		let polls = 0;
		commands.poll = () => {
			polls++;
			return { ok: true, value: { state: 'running' } };
		};
		const [first, second] = await service.generate(image);
		await until(() => polls >= 1);
		// The canvas deletes the two drafts one after the other, each released before its card information goes.
		await service.releaseCard(first);
		await harness.fileService.del(harness.resource('.bh/mirror/shots/image.png'), { recursive: true });
		await service.releaseCard(second);
		const records = await harness.records();
		await harness.fileService.del(harness.resource('.bh/mirror/shots/image-2.png'), { recursive: true });
		assert.deepStrictEqual({ records: records.length, generating: [service.isGenerating(first), service.isGenerating(second)] }, { records: 0, generating: [false, false] });
		harness.dispose();
	}));

	test('a received file never replaces a file that took its name at the last moment: it goes beside it', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness();
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands } = harness.first;
		const place = commands.place;
		const places: string[] = [];
		commands.place = async request => {
			places.push(request.to.slice(root.fsPath.length));
			if (places.length === 1) {
				// Another program takes the name the moment before AI Video links the file to it.
				await harness.write('shots/video.mp4', 'dropped at the last moment');
			}
			return place(request);
		};
		await service.generate(video);
		await until(async () => !(await harness.records()).length);
		assert.deepStrictEqual({
			places,
			dropped: await harness.read('shots/video.mp4'),
			beside: (await harness.read('shots/video-2.mp4')) === FAKE_MP4.toString(),
			parts: (await harness.cache()).filter(name => name.endsWith('.part'))
		}, { places: ['/shots/video.mp4', '/shots/video-2.mp4'], dropped: 'dropped at the last moment', beside: true, parts: [] });
		harness.dispose();
	}));

	test('on a volume that ignores letter case, a card is the same card whatever case names it', () => runWithFakedTimers({ startTime: START, maxTaskCount: 10_000 }, async () => {
		const harness = await createHarness({ caseInsensitive: true });
		const video = await harness.card('shots/video.mp4', VIDEO);
		const { service, commands, tasks } = harness.first;
		commands.poll = () => ({ ok: true, value: { state: 'running' } });
		await service.generate(video);
		const other = harness.resource('shots/Video.mp4');
		assert.deepStrictEqual({ generating: service.isGenerating(other), record: !!tasks.forCard(other) }, { generating: true, record: true });
		await service.stop(video);
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
		const prepare = (inputs: IBaseHalfVideoResolvedInput[]) => harness.first.service.prepareInputMedia(planBaseHalfVideoInputs(frames.inputs, inputs), inputs, ['png', 'jpeg', 'webp']);
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

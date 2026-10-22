/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { baseHalfGenerationTaskFolder, BaseHalfGenerationTaskStore } from '../../browser/basehalfGenerationTaskStore.js';
import {
	createBaseHalfGenerationTask,
	failBaseHalfGenerationTask,
	heartbeatBaseHalfGenerationTask,
	IBaseHalfGenerationRequest,
	IBaseHalfGenerationTask,
	runBaseHalfGenerationTask,
	serializeBaseHalfGenerationTask,
	stopBaseHalfGenerationTask,
	submitBaseHalfGenerationTask
} from '../../common/basehalfGenerationInfo.js';
import { BaseHalfTestFileSystemProvider } from './basehalfVideoTestFixtures.js';

suite('BaseHalfGenerationTaskStore', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.file('/workspace');
	const START = '2026-10-22T08:00:00.000Z';
	const LATER = '2026-10-22T08:05:00.000Z';
	const request: IBaseHalfGenerationRequest = {
		provider: 'acme', region: 'east', model: 'acme-motion-2', providerModel: 'acme-motion-2-e-260101', mode: 'frames', params: { duration: 5 }, prompt: 'Rain.', inputs: []
	};

	interface IHarness {
		readonly fileService: FileService;
		window(): BaseHalfGenerationTaskStore;
		task(id: string, cards: readonly string[], follower?: string, now?: string): IBaseHalfGenerationTask;
		write(path: string, text: string): Promise<void>;
		exists(path: string): Promise<boolean>;
		record(id: string): Promise<IBaseHalfGenerationTask | undefined>;
	}

	async function createHarness(): Promise<IHarness> {
		const owner = disposables.add(new DisposableStore());
		const fileService = owner.add(new FileService(new NullLogService()));
		owner.add(fileService.registerProvider(Schemas.file, owner.add(new BaseHalfTestFileSystemProvider())));
		await fileService.createFolder(root);
		const resource = (path: string) => joinPath(root, ...path.split('/'));
		const uriIdentity = owner.add(new UriIdentityService(fileService));
		return {
			fileService,
			window: () => owner.add(new BaseHalfGenerationTaskStore(fileService, new TestContextService(testWorkspace(root)), uriIdentity, new NullLogService())),
			task: (id, cards, follower = 'w1', now = START) => createBaseHalfGenerationTask({ id, kind: 'video', cards, follower, now }),
			write: async (path, text) => { await fileService.writeFile(resource(path), VSBuffer.fromString(text)); },
			exists: path => fileService.exists(resource(path)),
			record: async id => {
				try {
					return JSON.parse((await fileService.readFile(joinPath(baseHalfGenerationTaskFolder(root), `${id}.json`))).value.toString());
				} catch {
					return undefined;
				}
			}
		};
	}

	/** Until a store has read the change another window made. */
	function changed(store: BaseHalfGenerationTaskStore): Promise<void> {
		return Event.toPromise(store.onDidChange);
	}

	test('writes a new record only where none is, and another window reads it through its watcher of that folder alone', async () => {
		const harness = await createHarness();
		const first = harness.window();
		const second = harness.window();
		await Promise.all([first.whenReady(), second.whenReady()]);
		const seen = changed(second);
		const task = harness.task('20261022T080000-aaaa0001', ['shots/video.mp4']);
		await first.create(root, task);
		await seen;
		await assert.rejects(() => second.create(root, harness.task('20261022T080000-aaaa0001', ['shots/other.mp4'])));
		assert.deepStrictEqual({
			first: first.list().map(record => record.id),
			second: second.list().map(record => record.id),
			folder: second.folderOf(task.id)?.toString(),
			forCard: second.forCard(joinPath(root, 'shots', 'video.mp4'))?.id,
			part: first.partFile(task, 1).path,
			ignored: (await harness.fileService.readFile(joinPath(root, '.bh', '.gitignore'))).value.toString().includes('/cache/')
		}, {
			first: [task.id],
			second: [task.id],
			folder: root.toString(),
			forCard: task.id,
			part: '/workspace/.bh/cache/generation/20261022T080000-aaaa0001-2.part',
			ignored: true
		});
	});

	test('changes a record against the bytes it read, and plans the change again when another window wrote it meanwhile', async () => {
		const harness = await createHarness();
		const first = harness.window();
		const second = harness.window();
		const task = harness.task('20261022T080000-aaaa0002', ['shots/video.mp4']);
		await first.create(root, task);
		await second.refresh();
		// Another window renames the card while this one says it is alive: neither change is lost.
		const write = harness.fileService.writeFileWithExpectedContents.bind(harness.fileService);
		let interleave: (() => Promise<void>) | undefined = () => second.retarget(joinPath(root, 'shots', 'video.mp4'), joinPath(root, 'shots', 'shot.mp4'));
		harness.fileService.writeFileWithExpectedContents = async (...args) => {
			const hook = interleave;
			interleave = undefined;
			await hook?.();
			return write(...args);
		};
		let plans = 0;
		const beat = await first.update(task.id, current => {
			plans++;
			return heartbeatBaseHalfGenerationTask(current, 'w1', LATER);
		});
		const writes = harness.fileService.writeFileWithExpectedContents;
		let written = 0;
		harness.fileService.writeFileWithExpectedContents = (...args) => {
			written++;
			return writes(...args);
		};
		const unchanged = await first.update(task.id, current => current);
		assert.deepStrictEqual({
			plans,
			written: [beat?.aliveAt, beat?.cards.map(card => card.path)],
			onDisk: (await harness.record(task.id))?.cards.map(card => card.path),
			unchanged: [JSON.stringify(unchanged) === JSON.stringify(first.get(task.id)), written],
			gone: await first.update('20261022T080000-none', current => current)
		}, {
			plans: 2,
			written: [LATER, ['shots/shot.mp4']],
			onDisk: ['shots/shot.mp4'],
			unchanged: [true, 0],
			gone: undefined
		});
	});

	test('names the record of a card: one that has not ended, or else the last that ended', async () => {
		const harness = await createHarness();
		const store = harness.window();
		const card = 'shots/video.mp4';
		const old = failBaseHalfGenerationTask(harness.task('20261022T080000-aaaa0003', [card], 'w1', START), 'Refused.', START);
		const later = stopBaseHalfGenerationTask(harness.task('20261022T080100-aaaa0004', [card], 'w1', START), LATER);
		await store.create(root, old);
		await store.create(root, later);
		const ended = store.forCard(joinPath(root, ...card.split('/')))?.id;
		const running = runBaseHalfGenerationTask(submitBaseHalfGenerationTask(harness.task('20261022T080200-aaaa0005', [card]), request, 'Rain.', false), 'cgt-1');
		await store.create(root, running);
		assert.deepStrictEqual([ended, store.forCard(joinPath(root, ...card.split('/')))?.id, store.forCard(joinPath(root, 'shots', 'other.mp4'))], [later.id, running.id, undefined]);
	});

	test('a move writes the new path of a card, and of every card below a moved folder, into the records that name them', async () => {
		const harness = await createHarness();
		const store = harness.window();
		const images = createBaseHalfGenerationTask({ id: '20261022T080000-aaaa0006', kind: 'image', cards: ['shots/image.png', 'shots/image-2.png'], follower: 'w1', now: START });
		const other = harness.task('20261022T080000-aaaa0007', ['notes/video.mp4']);
		await store.create(root, images);
		await store.create(root, other);
		await store.retarget(joinPath(root, 'shots', 'image-2.png'), joinPath(root, 'shots', 'hero.png'));
		await store.retarget(joinPath(root, 'shots'), joinPath(root, 'scenes', 'one'));
		assert.deepStrictEqual([store.get(images.id)?.cards.map(card => card.path), store.get(other.id)?.cards.map(card => card.path), (await harness.record(images.id))?.cards.map(card => card.path)], [
			['scenes/one/image.png', 'scenes/one/hero.png'],
			['notes/video.mp4'],
			['scenes/one/image.png', 'scenes/one/hero.png']
		]);
	});

	test('removes a record with its partial downloads, and leaves the records of other generations', async () => {
		const harness = await createHarness();
		const store = harness.window();
		const task = harness.task('20261022T080000-aaaa0008', ['shots/video.mp4']);
		const other = harness.task('20261022T080000-aaaa0009', ['shots/other.mp4']);
		await store.create(root, task);
		await store.create(root, other);
		await harness.fileService.writeFile(store.partFile(task, 0), VSBuffer.fromString('part'));
		await harness.fileService.writeFile(store.partFile(other, 0), VSBuffer.fromString('part'));
		await store.remove(task.id);
		assert.deepStrictEqual([store.list().map(record => record.id), await harness.exists('.bh/cache/generation/20261022T080000-aaaa0008-1.part'), await harness.exists('.bh/cache/generation/20261022T080000-aaaa0009-1.part')], [[other.id], false, true]);
	});

	test('when the folder opens, removes partial downloads that no unfinished record names and ended records whose cards are gone', async () => {
		const harness = await createHarness();
		const folder = '.bh/cache/generation';
		const running = runBaseHalfGenerationTask(submitBaseHalfGenerationTask(harness.task('20261022T080000-bbbb0001', ['shots/running.mp4']), request, 'Rain.', false), 'cgt-1');
		const gone = failBaseHalfGenerationTask(harness.task('20261022T080000-bbbb0002', ['shots/gone.mp4']), 'Refused.', LATER);
		const draft = failBaseHalfGenerationTask(harness.task('20261022T080000-bbbb0003', ['shots/draft.mp4']), 'Refused.', LATER);
		const file = stopBaseHalfGenerationTask(harness.task('20261022T080000-bbbb0004', ['shots/file.mp4']), LATER);
		for (const task of [running, gone, draft, file]) {
			await harness.write(`${folder}/${task.id}.json`, serializeBaseHalfGenerationTask(task));
		}
		await harness.write(`${folder}/${running.id}-1.part`, 'downloading');
		await harness.write(`${folder}/${gone.id}-1.part`, 'left behind');
		await harness.write(`${folder}/20261022T070000-cccc0001-1.part`, 'no record');
		await harness.write('.bh/mirror/shots/draft.mp4/generation.yaml', 'prompt: "A draft."\n');
		await harness.write('shots/file.mp4', 'video');
		const store = harness.window();
		await store.whenReady();
		const names = (await harness.fileService.resolve(joinPath(root, ...folder.split('/')))).children?.map(child => child.name).sort();
		assert.deepStrictEqual({ records: store.list().map(task => task.id).sort(), names }, {
			records: [running.id, draft.id, file.id].sort(),
			names: [`${running.id}-1.part`, `${running.id}.json`, `${draft.id}.json`, `${file.id}.json`].sort()
		});
	});

	test('writes a record it is given over the one there, and a new one into the only folder', async () => {
		const harness = await createHarness();
		const store = harness.window();
		const task = harness.task('20261022T080000-aaaa0010', ['shots/video.mp4']);
		await store.write(task);
		await store.write(heartbeatBaseHalfGenerationTask(task, 'w2', LATER));
		await timeout(80);
		assert.deepStrictEqual([store.get(task.id)?.follower, (await harness.record(task.id))?.follower], ['w2', 'w2']);
	});
});

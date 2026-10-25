/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { isEqual, joinPath, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileStatWithPartialMetadata } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { parseBaseHalfGenerationMade, serializeBaseHalfGenerationMade } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfKeptVersionsService } from '../../../workspace/browser/basehalfKeptVersions.js';
import { BaseHalfVideoTrimService, baseHalfVideoVersion } from '../../browser/basehalfVideoTrimService.js';
import { readBaseHalfIsoBmffFile } from '../../common/basehalfIsoBmffReader.js';
import { baseHalfTestByteSource, makeBaseHalfTestVideo } from './basehalfVideoTrimFixtures.js';

const WORKSPACE = URI.file('/workspace');
const VIDEO = joinPath(WORKSPACE, 'shots', 'shot.mp4');
const MADE = joinPath(WORKSPACE, '.bh', 'mirror', 'shots', 'shot.mp4', 'made.yaml');
const RESOURCE = { resource: VIDEO, workspaceFolder: WORKSPACE, relativePath: 'shots/shot.mp4' };

const RECORD = serializeBaseHalfGenerationMade({
	id: '20261025T080000-k3f9',
	startedAt: '2026-10-25T08:00:00.000Z',
	finishedAt: '2026-10-25T08:01:00.000Z',
	provider: 'bytedance',
	region: 'cn',
	model: 'seedance-2.5',
	providerModel: 'doubao-seedance-2-5-260628',
	mode: 'frames',
	params: { duration: 2 },
	prompt: 'a bicycle by the sea',
	inputs: []
});

/** A file service whose video changes once, right after its first stat. */
class ChangingFileService extends FileService {
	change: Uint8Array | undefined;

	override async stat(resource: URI): Promise<IFileStatWithPartialMetadata> {
		const stat = await super.stat(resource);
		const change = this.change;
		if (change && isEqual(resource, VIDEO)) {
			this.change = undefined;
			await this.writeFile(VIDEO, VSBuffer.wrap(change));
		}
		return stat;
	}
}

suite('BaseHalfVideoTrimService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function setUp() {
		const fileService = disposables.add(new ChangingFileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		// The replacement of exact undo, as one step: files that are moved into place, and bytes that are written.
		const steps: string[] = [];
		const keptVersions: Partial<IBaseHalfKeptVersionsService> = {
			replaceFiles: async (changes, options) => {
				for (const change of changes) {
					if (URI.isUri(change.contents)) {
						await fileService.move(change.contents, change.resource, true);
					} else {
						await fileService.writeFile(change.resource, change.contents);
					}
				}
				steps.push(`${options.label}: ${changes.map(change => relativePath(WORKSPACE, change.resource)).join(', ')}`);
			}
		};
		const notifications: string[] = [];
		const notificationService: Partial<INotificationService> = {
			info: message => {
				notifications.push(`info: ${message}`);
			},
			error: message => {
				notifications.push(`error: ${message}`);
			}
		};
		const service = disposables.add(new BaseHalfVideoTrimService(fileService, keptVersions as IBaseHalfKeptVersionsService, notificationService as INotificationService, new NullLogService()));
		return { fileService, service, steps, notifications };
	}

	test('trims a video in place in one step with its record, narrows the record on a second trim, and says so where no bar shows the video', async function () {
		this.timeout(30_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 60, fps: 30, sound: true });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps, notifications } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		await fileService.writeFile(MADE, VSBuffer.fromString(RECORD));

		const first = await service.trimVideo(RESOURCE, { start: 0.5, end: 1.5 });
		const afterFirst = (await fileService.readFile(VIDEO)).value.buffer;
		const firstFrames = (await readBaseHalfIsoBmffFile(baseHalfTestByteSource(afterFirst), 'mp4')).video!.samples.length;
		// A trim bar that shows the video takes the end of the next trim: no notification.
		const shown = service.showVideo(VIDEO);
		const second = await service.trimVideo(RESOURCE, { start: 0.2, end: 0.7 });
		shown.dispose();
		const afterSecond = (await fileService.readFile(VIDEO)).value.buffer;
		const record = parseBaseHalfGenerationMade((await fileService.readFile(MADE)).value.toString());
		const cache = await fileService.resolve(joinPath(WORKSPACE, '.bh', 'cache', 'trim'));
		const version = baseHalfVideoVersion(await fileService.stat(VIDEO));
		assert.deepStrictEqual({
			frames: [firstFrames, (await readBaseHalfIsoBmffFile(baseHalfTestByteSource(afterSecond), 'mp4')).video!.samples.length],
			steps,
			record: record && [record.id, record.trimStart, record.trimEnd, record.prompt],
			leftInCache: (cache.children ?? []).map(child => child.name),
			notifications,
			trims: [first.range, second.range, first.soundDropped],
			last: [service.lastTrim(VIDEO, version)?.range, service.lastTrim(VIDEO, first.version)],
			running: service.runningTrim(VIDEO)
		}, {
			frames: [30, 15],
			steps: ['Trim shot.mp4: shots/shot.mp4, .bh/mirror/shots/shot.mp4/made.yaml', 'Trim shot.mp4: shots/shot.mp4, .bh/mirror/shots/shot.mp4/made.yaml'],
			// The second trim's part is within the first's, in seconds of what was generated.
			record: ['20261025T080000-k3f9', 0.7, 1.2, 'a bicycle by the sea'],
			leftInCache: [],
			notifications: ['info: Trimmed shot.mp4 to 1.0s.'],
			trims: [{ start: 0.5, end: 1.5 }, { start: 0.2, end: 0.7 }, false],
			last: [{ start: 0.2, end: 0.7 }, undefined],
			running: undefined
		});
	});

	test('a video without a record that can be read is trimmed alone, and its record is left as it is', async function () {
		this.timeout(30_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 45, fps: 30, sound: false });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		await service.trimVideo(RESOURCE, { start: 0, end: 1 });
		const unreadable = '<<<<<<< HEAD\nid: "a"\n';
		await fileService.writeFile(MADE, VSBuffer.fromString(unreadable));
		await service.trimVideo(RESOURCE, { start: 0, end: 0.5 });
		assert.deepStrictEqual({
			steps,
			record: (await fileService.readFile(MADE)).value.toString()
		}, {
			steps: ['Trim shot.mp4: shots/shot.mp4', 'Trim shot.mp4: shots/shot.mp4'],
			record: unreadable
		});
	});

	test('a video that changes while it is trimmed is not replaced, and the trim says why', async function () {
		this.timeout(30_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 45, fps: 30, sound: false });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps, notifications } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		// The same video with a box of free space after it: another size.
		const changed = new Uint8Array(bytes.length + 8);
		changed.set(bytes);
		changed.set([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65], bytes.length);
		fileService.change = changed;
		const failure = await service.trimVideo(RESOURCE, { start: 0, end: 1 }).then(() => undefined, (error: Error) => error.message);
		assert.deepStrictEqual({
			failure,
			steps,
			size: (await fileService.stat(VIDEO)).size,
			notifications
		}, {
			failure: 'the video changed while it was being trimmed.',
			steps: [],
			size: changed.length,
			notifications: ['error: BaseHalf could not trim shot.mp4: the video changed while it was being trimmed.']
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import {
	baseHalfVideoFrameFileName,
	baseHalfVideoFrameTime,
	captureBaseHalfVideoFrame,
	IBaseHalfVideoFrameReader
} from '../../browser/basehalfVideoFrameCapture.js';

suite('BaseHalfVideoFrameCapture', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('names a frame after the card and the frame, with a number when the name is taken', () => {
		assert.deepStrictEqual([
			baseHalfVideoFrameFileName('Shot 1', 'first', 0),
			baseHalfVideoFrameFileName('Shot 1', 'last', 4.999),
			baseHalfVideoFrameFileName('Shot 1', 'current', 3.24),
			baseHalfVideoFrameFileName('Shot 1', 'current', 12),
			baseHalfVideoFrameFileName('Shot 1', 'first', 0, 2),
			baseHalfVideoFrameFileName('A/B: "cut"?', 'first', 0),
			baseHalfVideoFrameFileName(' . ', 'last', 1)
		], [
			'Shot 1 first frame.png',
			'Shot 1 last frame.png',
			'Shot 1 frame at 3.2s.png',
			'Shot 1 frame at 12s.png',
			'Shot 1 first frame 2.png',
			'A-B- -cut- first frame.png',
			'Video last frame.png'
		]);
	});

	test('takes the first frame at the start, the current one where the player stands, and the last one just before the end', () => {
		assert.deepStrictEqual([
			baseHalfVideoFrameTime('first', 5),
			baseHalfVideoFrameTime('last', 5),
			baseHalfVideoFrameTime('current', 5, 2.5),
			baseHalfVideoFrameTime('current', 5, 9),
			baseHalfVideoFrameTime('current', 5, undefined),
			baseHalfVideoFrameTime('last', Number.NaN)
		], [0, 4.999, 2.5, 4.999, 0, 0]);
	});

	test('writes the PNG into the card\'s folder and numbers a frame whose name a file or a draft takes', async () => {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		const folder = URI.file('/workspace/shots');
		const video = URI.file('/workspace/shots/Shot 1.mp4');
		await fileService.createFolder(folder);
		// A draft of an image has the name of the last frame.
		const isNameTaken = async (resource: URI) => resource.path === '/workspace/shots/Shot 1 last frame.png';
		const asked: number[] = [];
		const reader: IBaseHalfVideoFrameReader = {
			read: async (_video, timeOf) => {
				const time = timeOf(8);
				asked.push(time);
				return { png: VSBuffer.fromString(`frame at ${time}`), time };
			}
		};
		const first = await captureBaseHalfVideoFrame(fileService, { video, folder, title: 'Shot 1', frame: 'first', isNameTaken }, reader);
		const again = await captureBaseHalfVideoFrame(fileService, { video, folder, title: 'Shot 1', frame: 'first', isNameTaken }, reader);
		const current = await captureBaseHalfVideoFrame(fileService, { video, folder, title: 'Shot 1', frame: 'current', currentTime: 3.2, isNameTaken }, reader);
		const last = await captureBaseHalfVideoFrame(fileService, { video, folder, title: 'Shot 1', frame: 'last', isNameTaken }, reader);
		assert.deepStrictEqual({
			written: [first, again, current, last].map(resource => resource.path),
			asked,
			bytes: (await fileService.readFile(current)).value.toString()
		}, {
			written: [
				'/workspace/shots/Shot 1 first frame.png',
				'/workspace/shots/Shot 1 first frame 2.png',
				'/workspace/shots/Shot 1 frame at 3.2s.png',
				'/workspace/shots/Shot 1 last frame 2.png'
			],
			asked: [0, 0, 3.2, 7.999],
			bytes: 'frame at 3.2'
		});
	});
});

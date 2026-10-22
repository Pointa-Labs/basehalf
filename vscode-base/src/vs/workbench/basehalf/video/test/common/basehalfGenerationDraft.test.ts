/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import {
	baseHalfDraftAsidePath,
	baseHalfIsDraft,
	baseHalfIsDraftInformation,
	baseHalfPathHoldsDraft,
	baseHalfReadDraftFacts,
	baseHalfWalkDraftInformation
} from '../../common/basehalfGenerationDraft.js';

suite('BaseHalfGenerationDraft', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const folder = URI.from({ scheme: 'basehalf-draft-test', path: '/work' });

	async function createFiles(files: Record<string, string>): Promise<IFileService> {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(folder.scheme, store.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(folder);
		for (const [path, contents] of Object.entries(files)) {
			await fileService.writeFile(URI.joinPath(folder, ...path.split('/')), VSBuffer.fromString(contents));
		}
		return fileService;
	}

	test('a draft is generation information without a record, under a name with a generation extension, at a path that holds nothing', () => {
		const facts = { path: 'shots/next.mp4', hasGenerationInfo: true, hasMade: false, itemExists: false };
		assert.deepStrictEqual([
			baseHalfIsDraft(facts),
			// Its file arrived: it is that file's card.
			baseHalfIsDraft({ ...facts, itemExists: true }),
			// A generated file that is gone is a missing file, never a draft again.
			baseHalfIsDraft({ ...facts, hasMade: true }),
			baseHalfIsDraft({ ...facts, hasGenerationInfo: false }),
			// Generation information under another name is not read.
			baseHalfIsDraft({ ...facts, path: 'shots/script.txt' }),
			baseHalfIsDraft({ ...facts, path: 'shots/still.PNG' }),
			baseHalfIsDraft({ ...facts, path: '.bh/x.mp4' }),
			baseHalfIsDraft({ ...facts, path: '' }),
			// What an item that arrives at a draft's path finds there.
			baseHalfIsDraftInformation({ ...facts }),
			baseHalfIsDraftInformation({ ...facts, hasMade: true })
		], [true, false, false, false, false, true, false, false, true, false]);
	});

	test('reads whether a path holds a draft, and shows one only while its folder exists', async () => {
		const fileService = await createFiles({
			'shots/notes.md': '# Notes\n',
			'shots/landed.mp4': 'video',
			'.bh/mirror/shots/next.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/landed.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/gone.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/gone.mp4/made.yaml': 'id: "t1"\n',
			'.bh/mirror/ghost/far.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/top.png/generation.yaml': 'prompt: ""\n'
		});
		const holds = await Promise.all(['shots/next.mp4', 'shots/landed.mp4', 'shots/gone.mp4', 'ghost/far.mp4', 'top.png', 'shots/none.mp4'].map(path => baseHalfPathHoldsDraft(fileService, folder, path)));
		assert.deepStrictEqual({
			facts: await baseHalfReadDraftFacts(fileService, folder, 'shots/gone.mp4'),
			holds,
			// Whether a file is at the path is not looked at: the information of every draft.
			walk: await baseHalfWalkDraftInformation(fileService, folder),
			below: await baseHalfWalkDraftInformation(fileService, folder, 'shots')
		}, {
			facts: { path: 'shots/gone.mp4', hasGenerationInfo: true, hasMade: true, itemExists: false },
			holds: [true, false, false, false, true, false],
			walk: ['ghost/far.mp4', 'shots/landed.mp4', 'shots/next.mp4', 'top.png'],
			below: ['shots/landed.mp4', 'shots/next.mp4']
		});
	});

	test('a draft moves aside to the next name of its folder at which neither an item nor any card information is', async () => {
		const fileService = await createFiles({
			'shots/shot.mp4': 'video',
			'shots/shot-2.mp4': 'video',
			'shots/SHOT-4.mp4': 'video',
			'.bh/mirror/shots/shot-3.mp4/badge.yaml': 'path: "shots/shot-3.mp4"\nkind: file\n',
			'.bh/mirror/video-7.mp4/generation.yaml': 'prompt: ""\n'
		});
		assert.deepStrictEqual([
			await baseHalfDraftAsidePath(fileService, folder, 'shots/shot.mp4'),
			await baseHalfDraftAsidePath(fileService, folder, 'shots/shot-2.mp4'),
			await baseHalfDraftAsidePath(fileService, folder, 'video-7.mp4'),
			await baseHalfDraftAsidePath(fileService, folder, 'empty/clip.mov')
		], ['shots/shot-5.mp4', 'shots/shot-5.mp4', 'video-2.mp4', 'empty/clip-2.mov']);
	});
});

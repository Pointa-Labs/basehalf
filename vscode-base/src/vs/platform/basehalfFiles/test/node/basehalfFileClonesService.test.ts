/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { promises } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getRandomTestPath } from '../../../../base/test/node/testUtils.js';
import { BaseHalfFileClonesService } from '../../node/basehalfFileClonesService.js';

suite('BaseHalfFileClonesService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let folder: string;

	setup(async () => {
		folder = getRandomTestPath(tmpdir(), 'vsctests', 'basehalffileclones');
		await promises.mkdir(folder, { recursive: true });
	});

	teardown(() => promises.rm(folder, { recursive: true, force: true }));

	test('copies a file byte for byte, and the copy changes apart from the file', async () => {
		const file = join(folder, 'shot.mp4');
		const copy = join(folder, 'original.mp4');
		await promises.writeFile(file, 'the video as it was');

		await new BaseHalfFileClonesService().clone(URI.file(file), URI.file(copy));
		const cloned = await promises.readFile(copy, 'utf8');
		await promises.writeFile(file, 'the trimmed video');
		assert.deepStrictEqual([cloned, await promises.readFile(copy, 'utf8')], ['the video as it was', 'the video as it was']);
	});

	test('never replaces a file that is there, and refuses what is not on disk', async () => {
		const file = join(folder, 'shot.mp4');
		const taken = join(folder, 'original.mp4');
		await promises.writeFile(file, 'the video');
		await promises.writeFile(taken, 'another file');
		const service = new BaseHalfFileClonesService();

		await assert.rejects(() => service.clone(URI.file(file), URI.file(taken)));
		await assert.rejects(() => service.clone(URI.from({ scheme: 'vscode-userdata', path: '/settings.json' }), URI.file(join(folder, 'copy.json'))));
		assert.strictEqual(await promises.readFile(taken, 'utf8'), 'another file');
	});
});

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
import { BaseHalfFileTimesService } from '../../node/basehalfFileTimesService.js';

suite('BaseHalfFileTimesService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let folder: string;

	setup(async () => {
		folder = getRandomTestPath(tmpdir(), 'vsctests', 'basehalffiletimes');
		await promises.mkdir(folder, { recursive: true });
	});

	teardown(() => promises.rm(folder, { recursive: true, force: true }));

	test('gives a file the time of now and leaves its bytes as they are', async () => {
		const file = join(folder, 'shot.mp4');
		await promises.writeFile(file, 'the video as it was');
		const long = new Date(2020, 0, 1);
		await promises.utimes(file, long, long);
		const before = Date.now();

		await new BaseHalfFileTimesService().touch([URI.file(file)]);
		const stat = await promises.stat(file);
		assert.deepStrictEqual({ bytes: await promises.readFile(file, 'utf8'), now: stat.mtimeMs >= before - 1 && stat.mtimeMs <= Date.now() + 1 }, { bytes: 'the video as it was', now: true });
	});

	test('refuses what is not a file on disk', async () => {
		await assert.rejects(() => new BaseHalfFileTimesService().touch([URI.from({ scheme: 'vscode-userdata', path: '/settings.json' })]));
	});
});

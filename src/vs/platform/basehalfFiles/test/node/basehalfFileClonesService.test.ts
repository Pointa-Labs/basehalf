/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { promises } from 'fs';
import { tmpdir } from 'os';
import { VSBuffer } from '../../../../base/common/buffer.js';
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

	test('writes a file from bytes and ranges of other files, in order, and appends to it', async () => {
		const first = join(folder, 'original.mp4');
		const second = join(folder, 'other.mp4');
		const target = join(folder, 'clip.mp4');
		// A range larger than what is read at once is copied whole.
		const large = Buffer.alloc(9 * 1024 * 1024 + 5);
		for (let index = 0; index < large.length; index++) {
			large[index] = (index * 7) & 0xFF;
		}
		await promises.writeFile(first, large);
		await promises.writeFile(second, 'abcdefghij');
		const service = new BaseHalfFileClonesService();

		await service.assemble(URI.file(target), [
			VSBuffer.fromString('head:'),
			{ source: URI.file(second), offset: 2, length: 3 },
			{ source: URI.file(first), offset: 1, length: large.length - 1 }
		]);
		await service.assemble(URI.file(target), [{ source: URI.file(second), offset: 7, length: 3 }, VSBuffer.fromString(':end')], true);
		const written = await promises.readFile(target);
		assert.deepStrictEqual(
			[written.length, written.subarray(0, 8).toString(), written.subarray(8, 8 + large.length - 1).equals(large.subarray(1)), written.subarray(written.length - 7).toString()],
			[8 + large.length - 1 + 7, 'head:cde', true, 'hij:end']
		);
	});

	test('a new file is never written over one that is there, and a range past its file is refused', async () => {
		const source = join(folder, 'original.mp4');
		const taken = join(folder, 'clip.mp4');
		await promises.writeFile(source, 'abc');
		await promises.writeFile(taken, 'another file');
		const service = new BaseHalfFileClonesService();

		await assert.rejects(() => service.assemble(URI.file(taken), [VSBuffer.fromString('x')]));
		await assert.rejects(() => service.assemble(URI.file(join(folder, 'short.mp4')), [{ source: URI.file(source), offset: 1, length: 5 }]));
		assert.strictEqual(await promises.readFile(taken, 'utf8'), 'another file');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { readBaseHalfFileRange } from '../../common/basehalfFileRange.js';

/** Counts what the file service asks of the disk: whole files, and bytes of parts. */
class CountingProvider extends InMemoryFileSystemProvider {
	wholeFiles = 0;
	bytes = 0;

	override readFile(resource: URI): Promise<Uint8Array> {
		this.wholeFiles++;
		return super.readFile(resource);
	}

	override async read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const read = await super.read(fd, pos, data, offset, length);
		this.bytes += read;
		return read;
	}
}

suite('BaseHalfFileRange', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('reads a part of a large file from the disk without the rest of it', async () => {
		const provider = disposables.add(new CountingProvider());
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, provider));
		const resource = URI.file('/workspace/textbook.epub');
		const content = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
		await fileService.writeFile(resource, VSBuffer.wrap(content));
		provider.wholeFiles = 0;
		provider.bytes = 0;

		const part = await readBaseHalfFileRange(fileService, resource, 2_000_000, 4096);

		assert.deepStrictEqual({
			same: part.equals(VSBuffer.wrap(content.slice(2_000_000, 2_004_096))),
			wholeFiles: provider.wholeFiles,
			bytes: provider.bytes
		}, { same: true, wholeFiles: 0, bytes: 4096 });
	});
});

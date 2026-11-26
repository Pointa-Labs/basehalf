/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { promises } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getRandomTestPath } from '../../../../base/test/node/testUtils.js';
import { FileOperationResult, toFileOperationResult } from '../../../files/common/files.js';
import { BaseHalfFileLinkEntry } from '../../common/basehalfFileLinks.js';
import { BaseHalfFileLinksService } from '../../node/basehalfFileLinksService.js';

suite('BaseHalfFileLinksService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let folder: string;
	let copy: string;
	let entry: string;

	setup(async () => {
		folder = getRandomTestPath(tmpdir(), 'vsctests', 'basehalffilelinks');
		copy = join(folder, '.basehalf', 'agent-skill', 'basehalf');
		entry = join(folder, '.claude', 'skills', 'basehalf');
		await promises.mkdir(copy, { recursive: true });
		await promises.writeFile(join(copy, 'SKILL.md'), 'the skill');
	});

	teardown(() => promises.rm(folder, { recursive: true, force: true }));

	const show = (found: BaseHalfFileLinkEntry) => found.kind === 'link' ? `link to ${found.target.fsPath}` : found.kind;

	test('tells nothing, a link and its target, a folder, and a file apart, and makes a link with its parent folders', async () => {
		const service = new BaseHalfFileLinksService();
		const before = show(await service.inspect(URI.file(entry)));
		await service.link(URI.file(entry), URI.file(copy));

		assert.deepStrictEqual({
			before,
			after: show(await service.inspect(URI.file(entry))),
			readThrough: await promises.readFile(join(entry, 'SKILL.md'), 'utf8'),
			folder: show(await service.inspect(URI.file(copy))),
			file: show(await service.inspect(URI.file(join(copy, 'SKILL.md')))),
			underAFile: show(await service.inspect(URI.file(join(copy, 'SKILL.md', 'inside')))),
			// No temporary name is left beside the link.
			beside: await promises.readdir(dirname(entry))
		}, {
			before: 'missing',
			after: `link to ${copy}`,
			readThrough: 'the skill',
			folder: 'folder',
			file: 'file',
			underAFile: 'missing',
			beside: ['basehalf']
		});
	});

	test('replaces a link in one step, leaves the same link as it is, and refuses a folder or a file', async () => {
		const service = new BaseHalfFileLinksService();
		const elsewhere = join(folder, 'elsewhere');
		await promises.mkdir(elsewhere);
		await promises.mkdir(dirname(entry), { recursive: true });
		await promises.symlink(elsewhere, entry);
		await service.link(URI.file(entry), URI.file(copy));
		const replaced = show(await service.inspect(URI.file(entry)));
		const linked = (await promises.lstat(entry)).ino;
		await service.link(URI.file(entry), URI.file(copy));
		const kept = (await promises.lstat(entry)).ino === linked;

		const folderInTheWay = join(folder, '.agents', 'skills', 'basehalf');
		await promises.mkdir(folderInTheWay, { recursive: true });
		await promises.writeFile(join(folderInTheWay, 'SKILL.md'), 'an earlier copy');
		const fileInTheWay = join(folder, 'file-in-the-way');
		await promises.writeFile(fileInTheWay, 'mine');

		await assert.rejects(() => service.link(URI.file(folderInTheWay), URI.file(copy)));
		await assert.rejects(() => service.link(URI.file(fileInTheWay), URI.file(copy)));
		assert.deepStrictEqual({
			replaced,
			kept,
			elsewhereStays: await promises.readdir(folder).then(names => names.includes('elsewhere')),
			folderUntouched: await promises.readFile(join(folderInTheWay, 'SKILL.md'), 'utf8'),
			fileUntouched: await promises.readFile(fileInTheWay, 'utf8')
		}, {
			replaced: `link to ${copy}`,
			kept: true,
			elsewhereStays: true,
			folderUntouched: 'an earlier copy',
			fileUntouched: 'mine'
		});
	});

	test('removes a link and never what it points at, and refuses a folder', async () => {
		const service = new BaseHalfFileLinksService();
		await service.link(URI.file(entry), URI.file(copy));
		const removed = await service.unlink(URI.file(entry));
		const again = await service.unlink(URI.file(entry));

		await assert.rejects(() => service.unlink(URI.file(copy)));
		assert.deepStrictEqual({
			removed,
			again,
			entry: show(await service.inspect(URI.file(entry))),
			copyStays: await promises.readFile(join(copy, 'SKILL.md'), 'utf8')
		}, { removed: true, again: false, entry: 'missing', copyStays: 'the skill' });
	});

	test('refuses what is not on the disk', async () => {
		const service = new BaseHalfFileLinksService();
		const remote = URI.from({ scheme: 'vscode-remote', path: '/home/user/.claude/skills/basehalf' });
		await assert.rejects(() => service.inspect(remote));
		await assert.rejects(() => service.link(remote, URI.file(copy)));
	});

	test('marks a failure with its kind in the name, which is what reaches the window', async () => {
		const service = new BaseHalfFileLinksService();
		const locked = join(folder, 'locked');
		await promises.mkdir(locked, { mode: 0o500 });
		let failure: Error | undefined;
		try {
			await service.link(URI.file(join(locked, 'basehalf')), URI.file(copy));
		} catch (error) {
			failure = error;
		} finally {
			await promises.chmod(locked, 0o700);
		}
		// An error that crosses to the window keeps only its message and its name.
		const received = new Error(failure?.message);
		received.name = failure?.name ?? '';
		assert.deepStrictEqual(
			{ refused: failure !== undefined, kind: toFileOperationResult(received) },
			{ refused: true, kind: FileOperationResult.FILE_PERMISSION_DENIED }
		);
	});
});

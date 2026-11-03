/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { FileSystemProviderErrorCode, createFileSystemProviderError, IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { baseHalfGitFolder, baseHalfLeaveOutSystemFiles, baseHalfMayLeaveOutSystemFiles } from '../../common/basehalfGitExclude.js';

const ROOT = URI.file('/disk');
const REPO = joinPath(ROOT, 'repo');
const BLOCK = '# Files the system makes by itself. Written by BaseHalf.\n.DS_Store\n._*\nThumbs.db\ndesktop.ini\n';
const at = (path: string) => joinPath(ROOT, ...path.split('/'));

suite('BaseHalfGitExclude', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function disk(files: Record<string, string>, provider = new InMemoryFileSystemProvider()): Promise<IFileService> {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(provider)));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(at(path), VSBuffer.fromString(content));
		}
		return fileService;
	}
	const read = async (fileService: IFileService, path: string) => (await fileService.readFile(at(path))).value.toString();

	test('the lines follow what the file holds, on a line of their own, and a missing file is made', async () => {
		const made = await disk({ 'repo/.git/HEAD': '' });
		assert.strictEqual(await baseHalfLeaveOutSystemFiles(made, REPO), true);
		assert.strictEqual(await read(made, 'repo/.git/info/exclude'), BLOCK);

		const ended = await disk({ 'repo/.git/info/exclude': '# from git\n*.tmp\n' });
		await baseHalfLeaveOutSystemFiles(ended, REPO);
		assert.strictEqual(await read(ended, 'repo/.git/info/exclude'), `# from git\n*.tmp\n${BLOCK}`);

		const open = await disk({ 'repo/.git/info/exclude': '*.tmp' });
		await baseHalfLeaveOutSystemFiles(open, REPO);
		assert.strictEqual(await read(open, 'repo/.git/info/exclude'), `*.tmp\n${BLOCK}`);
	});

	test('a file with the first line gets nothing more, whatever the user changed under it', async () => {
		const once = await disk({ 'repo/.git/HEAD': '' });
		await baseHalfLeaveOutSystemFiles(once, REPO);
		assert.strictEqual(await baseHalfLeaveOutSystemFiles(once, REPO), false);
		assert.strictEqual(await read(once, 'repo/.git/info/exclude'), BLOCK);

		const changed = '# Files the system makes by itself. Written by BaseHalf.\nThumbs.db\n';
		const edited = await disk({ 'repo/.git/info/exclude': changed });
		assert.strictEqual(await baseHalfLeaveOutSystemFiles(edited, REPO), false);
		assert.strictEqual(await read(edited, 'repo/.git/info/exclude'), changed);

		// The words inside another line are not the first line.
		const quoted = await disk({ 'repo/.git/info/exclude': '# not "# Files the system makes by itself. Written by BaseHalf."\n' });
		assert.strictEqual(await baseHalfLeaveOutSystemFiles(quoted, REPO), true);
	});

	test('a linked worktree and a submodule write where git reads', async () => {
		const worktree = await disk({
			'main/.git/HEAD': '',
			'wt/.git': 'gitdir: /disk/main/.git/worktrees/wt\n',
			'main/.git/worktrees/wt/commondir': '../..\n'
		});
		assert.strictEqual((await baseHalfGitFolder(worktree, at('wt'))).path, '/disk/main/.git');
		await baseHalfLeaveOutSystemFiles(worktree, at('wt'));
		assert.strictEqual(await read(worktree, 'main/.git/info/exclude'), BLOCK);

		const submodule = await disk({ 'main/sub/.git': 'gitdir: ../.git/modules/sub\n', 'main/.git/modules/sub/HEAD': '' });
		await baseHalfLeaveOutSystemFiles(submodule, at('main/sub'));
		assert.strictEqual(await read(submodule, 'main/.git/modules/sub/info/exclude'), BLOCK);
	});

	test('a file that cannot be read is not written over', async () => {
		const provider = new class extends InMemoryFileSystemProvider {
			override async readFile(resource: URI): Promise<Uint8Array> {
				if (resource.path.endsWith('/info/exclude')) {
					throw createFileSystemProviderError('denied', FileSystemProviderErrorCode.NoPermissions);
				}
				return super.readFile(resource);
			}
		};
		const fileService = await disk({ 'repo/.git/info/exclude': 'mine\n' }, provider);
		await assert.rejects(baseHalfLeaveOutSystemFiles(fileService, REPO));
		const bytes = await provider.stat(at('repo/.git/info/exclude'));
		assert.strictEqual(bytes.size, 'mine\n'.length);
	});

	test('a marker at the root, or on a workspace folder inside or around it, stops it; one elsewhere does not', async () => {
		const marker = '.basehalf-no-workspace-setup';
		const may = async (files: Record<string, string>, folders: string[], root = 'repo') =>
			baseHalfMayLeaveOutSystemFiles(await disk(files), at(root), folders.map(at));

		assert.strictEqual(await may({ 'repo/a.md': '' }, ['repo']), true);
		assert.strictEqual(await may({ [`repo/${marker}`]: '' }, []), false, 'at the root');
		assert.strictEqual(await may({ [`repo/docs/${marker}`]: '' }, ['repo/docs']), false, 'a workspace folder inside the repository');
		assert.strictEqual(await may({ [`work/${marker}`]: '', 'work/repo/a.md': '' }, ['work'], 'work/repo'), false, 'a workspace folder around the repository');
		assert.strictEqual(await may({ [`other/${marker}`]: '', 'repo/a.md': '' }, ['other', 'repo']), true, 'a workspace folder apart from it');
		assert.strictEqual(await may({ [`repo/docs/${marker}`]: '' }, ['repo']), true, 'a subfolder that is no workspace folder');
	});

	test('a marker that cannot be determined stops it', async () => {
		const provider = new class extends InMemoryFileSystemProvider {
			override async stat(resource: URI) {
				if (resource.path.endsWith('.basehalf-no-workspace-setup')) {
					throw createFileSystemProviderError('denied', FileSystemProviderErrorCode.NoPermissions);
				}
				return super.stat(resource);
			}
		};
		const fileService = await disk({ 'repo/a.md': '' }, provider);
		assert.strictEqual(await baseHalfMayLeaveOutSystemFiles(fileService, REPO, [REPO]), false);
	});
});

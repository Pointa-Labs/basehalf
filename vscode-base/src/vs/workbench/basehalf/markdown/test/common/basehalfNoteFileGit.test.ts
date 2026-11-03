/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { baseHalfNoteStoreGitCheck, baseHalfWithoutEarlyGitIgnoreLines } from '../../common/basehalfNoteFileGit.js';

const ROOT = URI.file('/disk');
const USER = URI.file('/disk/user');

suite('BaseHalfNoteFileGit', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	/** Whether git keeps the store of `home` in a disk of `files`, and the line that leaves it out, as `file:line`. */
	async function check(files: Record<string, string>, home = 'repo') {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(ROOT, ...path.split('/')), VSBuffer.fromString(content));
		}
		const result = await baseHalfNoteStoreGitCheck({ fileService, userHome: USER }, joinPath(ROOT, ...home.split('/')));
		const at = (place?: { readonly file: URI; readonly line: number }) => place && `${relativePath(ROOT, place.file)}:${place.line}`;
		return result.ignored ? { cause: at(result.cause), ...(result.early ? { early: at(result.early) } : {}) } : 'kept';
	}

	test('the store is left out as git reads its ignore files: a folder left out, the last line deciding, a deeper file first, then info/exclude and the global file', async () => {
		const repo = { 'repo/.git/HEAD': '', 'repo/.bh/.gitignore': '/.gitignore\n/cache/\n' };
		assert.deepStrictEqual({
			nothing: await check(repo),
			noRepository: await check({ 'repo/.gitignore': '.bh/\n' }),
			bhFolder: await check({ ...repo, 'repo/.gitignore': 'node_modules/\n.bh/\n' }),
			bhAnywhere: await check({ ...repo, 'repo/.gitignore': '.bh\n' }),
			anchoredElsewhere: await check({ ...repo, 'repo/.gitignore': '/docs/.bh/\n' }),
			anchoredHere: await check({ ...repo, 'repo/.gitignore': '/.bh/attachments/\n' }),
			everything: await check({ ...repo, 'repo/.gitignore': '*\n' }),
			turnedBack: await check({ ...repo, 'repo/.gitignore': '.bh/*\n!.bh/attachments/\n' }),
			turnedBackTooLate: await check({ ...repo, 'repo/.gitignore': '.bh/\n!.bh/attachments/\n' }),
			lastLineDecides: await check({ ...repo, 'repo/.gitignore': '!.bh/\n.bh/\n' }),
			allInside: await check({ ...repo, 'repo/.gitignore': '.bh/attachments/**\n' }),
			anchoredAtTheRoot: await check({ ...repo, 'repo/.gitignore': 'attachments/**\n' }),
			anyDepth: await check({ ...repo, 'repo/.gitignore': '**/attachments\n' }),
			deeperFirst: await check({ ...repo, 'repo/.gitignore': '.bh/attachments/\n', 'repo/.bh/.gitignore': '!/attachments/\n' }),
			exclude: await check({ ...repo, 'repo/.git/info/exclude': '.bh/\n' }),
			global: await check({ ...repo, 'user/.config/git/ignore': '.bh/\n' }),
			globalSetting: await check({ ...repo, 'user/.gitconfig': '[user]\n\tname = A\n[core]\n\texcludesFile = ~/ignores/global\n', 'user/ignores/global': '.bh/\n' }),
			nestedHome: await check({ ...repo, 'repo/.gitignore': 'notes/**/.bh/\n', 'repo/notes/a/.git': 'gitdir: ../../.git/worktrees/a' }, 'repo/notes/a'),
		}, {
			nothing: 'kept',
			noRepository: 'kept',
			bhFolder: { cause: 'repo/.gitignore:2' },
			bhAnywhere: { cause: 'repo/.gitignore:1' },
			anchoredElsewhere: 'kept',
			anchoredHere: { cause: 'repo/.gitignore:1' },
			everything: { cause: 'repo/.gitignore:1' },
			turnedBack: 'kept',
			turnedBackTooLate: { cause: 'repo/.gitignore:1' },
			lastLineDecides: { cause: 'repo/.gitignore:2' },
			allInside: { cause: 'repo/.gitignore:1' },
			anchoredAtTheRoot: 'kept',
			anyDepth: { cause: 'repo/.gitignore:1' },
			deeperFirst: 'kept',
			exclude: { cause: 'repo/.git/info/exclude:1' },
			global: { cause: 'user/.config/git/ignore:1' },
			globalSetting: { cause: 'user/ignores/global:1' },
			nestedHome: 'kept',
		});
	});

	test('the two lines early versions wrote are found as the cause, and only they are removed', async () => {
		const repo = { 'repo/.git/HEAD': '' };
		const early = 'dist/\n\n# BaseHalf derived cache\n.bh/\n\n*.log\n';
		assert.deepStrictEqual({
			early: await check({ ...repo, 'repo/.gitignore': early }),
			ownLine: await check({ ...repo, 'repo/.gitignore': '# my cache\n.bh/\n' }),
			removed: baseHalfWithoutEarlyGitIgnoreLines(early, 3),
			changed: baseHalfWithoutEarlyGitIgnoreLines('dist/\n# BaseHalf derived cache\n.bh/cache/\n', 2),
		}, {
			early: { cause: 'repo/.gitignore:4', early: 'repo/.gitignore:3' },
			ownLine: { cause: 'repo/.gitignore:2' },
			removed: 'dist/\n\n\n*.log\n',
			changed: undefined,
		});
	});
});

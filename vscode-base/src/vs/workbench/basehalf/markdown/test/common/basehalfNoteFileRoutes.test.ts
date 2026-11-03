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
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { baseHalfNoteLinkDestinationRanges, baseHalfNoteLinkDestinations } from '../../common/basehalfNoteFileLinks.js';
import { baseHalfApplyNoteRouteEdits, baseHalfNoteFileRouteEdits } from '../../common/basehalfNoteFileRoutes.js';
import { resolveBaseHalfNoteLink } from '../../common/basehalfNoteLinks.js';

const WORKSPACE = URI.file('/workspace');

suite('BaseHalfNoteFileRoutes', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string>) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(WORKSPACE, ...path.split('/')), VSBuffer.fromString(content));
		}
		const corrected = async (note: string) => {
			const text = (await fileService.readFile(joinPath(WORKSPACE, ...note.split('/')))).value.toString();
			return baseHalfApplyNoteRouteEdits(text, await baseHalfNoteFileRouteEdits(fileService, WORKSPACE, joinPath(WORKSPACE, ...note.split('/')), text));
		};
		return { fileService, corrected };
	}

	test('a link into the store, in the ../ form and after its route is corrected, goes to the stored file wherever the note is', async () => {
		const link = '![a](../.bh/attachments/aaaaaaaaaa/a%20b.png) <video src="../.bh/attachments/aaaaaaaaaa/clip.mp4"></video>\n';
		const workspace = await open({
			'读书/note.md': link,
			'deep/er/moved.md': link,
			'.bh/attachments/aaaaaaaaaa/a b.png': '',
			'.bh/attachments/aaaaaaaaaa/clip.mp4': '',
		});
		const targets = (note: string, text: string) => baseHalfNoteLinkDestinations(text).map(href => {
			const target = resolveBaseHalfNoteLink(joinPath(WORKSPACE, ...note.split('/')), [WORKSPACE], href);
			return target.kind === 'file' ? target.uri.path : target.kind;
		});
		assert.deepStrictEqual([targets('读书/note.md', link), targets('deep/er/moved.md', await workspace.corrected('deep/er/moved.md'))], [
			['/workspace/.bh/attachments/aaaaaaaaaa/a b.png', '/workspace/.bh/attachments/aaaaaaaaaa/clip.mp4'],
			['/workspace/.bh/attachments/aaaaaaaaaa/a b.png', '/workspace/.bh/attachments/aaaaaaaaaa/clip.mp4'],
		]);
	});

	test('a note moved to another depth gets the route of each link into the store that leads nowhere, and nothing else', async () => {
		const note = [
			'![a](.bh/attachments/aaaaaaaaaa/a%20b.png) and [b](<.bh/attachments/aaaaaaaaaa/b c.pdf>)',
			'`![code](.bh/attachments/aaaaaaaaaa/a%20b.png)`',
			'<video src="../../.bh/attachments/aaaaaaaaaa/clip.mp4" controls></video>',
			'[fine](../../.bh/attachments/aaaaaaaaaa/fine.txt) [nowhere](.bh/attachments/zzzzzzzzzz/x.png) [web](https://example.com/.bh/attachments/aaaaaaaaaa/a%20b.png)',
			'',
		].join('\n');
		const workspace = await open({
			'deep/er/note.md': note,
			'.bh/attachments/aaaaaaaaaa/a b.png': '',
			'.bh/attachments/aaaaaaaaaa/b c.pdf': '',
			'.bh/attachments/aaaaaaaaaa/clip.mp4': '',
			'.bh/attachments/aaaaaaaaaa/fine.txt': '',
		});

		assert.strictEqual(await workspace.corrected('deep/er/note.md'), [
			'![a](../../.bh/attachments/aaaaaaaaaa/a%20b.png) and [b](<../../.bh/attachments/aaaaaaaaaa/b c.pdf>)',
			'`![code](.bh/attachments/aaaaaaaaaa/a%20b.png)`',
			'<video src="../../.bh/attachments/aaaaaaaaaa/clip.mp4" controls></video>',
			'[fine](../../.bh/attachments/aaaaaaaaaa/fine.txt) [nowhere](.bh/attachments/zzzzzzzzzz/x.png) [web](https://example.com/.bh/attachments/aaaaaaaaaa/a%20b.png)',
			'',
		].join('\n'));
	});

	test('a note moved up, and a note in a repository inside the workspace folder, link the nearest store that holds the key', async () => {
		const workspace = await open({
			'up.md': '![x](../../.bh/attachments/bbbbbbbbbb/x.png)\n',
			'.bh/attachments/bbbbbbbbbb/x.png': '',
			'repo/.git/HEAD': '',
			'repo/notes/n.md': '![y](.bh/attachments/cccccccccc/y.png)\n',
			'repo/.bh/attachments/cccccccccc/y.png': '',
		});

		assert.deepStrictEqual([await workspace.corrected('up.md'), await workspace.corrected('repo/notes/n.md')], [
			'![x](.bh/attachments/bbbbbbbbbb/x.png)\n',
			'![y](../.bh/attachments/cccccccccc/y.png)\n',
		]);
	});

	test('nothing is corrected while git is in the middle of an operation, or in a marked folder', async () => {
		const files = { 'notes/n.md': '![x](.bh/attachments/dddddddddd/x.png)\n', '.bh/attachments/dddddddddd/x.png': '' };
		const busy = await open({ ...files, '.git/HEAD': '', '.git/MERGE_HEAD': '' });
		const marked = await open({ ...files, '.basehalf-no-workspace-setup': '' });
		const free = await open({ ...files, '.git/HEAD': '' });

		assert.deepStrictEqual([await busy.corrected('notes/n.md'), await marked.corrected('notes/n.md'), await free.corrected('notes/n.md')], [
			'![x](.bh/attachments/dddddddddd/x.png)\n',
			'![x](.bh/attachments/dddddddddd/x.png)\n',
			'![x](../.bh/attachments/dddddddddd/x.png)\n',
		]);
	});

	test('a destination is found where it is in the note, also after code', () => {
		const markdown = 'a `code ![x](no.png)` ![p](a.png)\r\n```\n[q](no.md)\n```\n[r]: <b c.pdf>\n<img src=\'d.png\'> <img src=e.png>';
		assert.deepStrictEqual(baseHalfNoteLinkDestinationRanges(markdown).map(({ at, destination }) => [destination, markdown.slice(at, at + destination.length)]), [
			['a.png', 'a.png'],
			['<b c.pdf>', '<b c.pdf>'],
			['d.png', 'd.png'],
			['e.png', 'e.png'],
		]);
	});
});

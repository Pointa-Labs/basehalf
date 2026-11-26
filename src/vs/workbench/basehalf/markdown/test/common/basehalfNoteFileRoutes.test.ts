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
import { IBaseHalfFileClonesService } from '../../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { baseHalfNoteLinkDestinationRanges, baseHalfNoteLinkDestinations } from '../../common/basehalfNoteFileLinks.js';
import { baseHalfApplyNoteRouteEdits, baseHalfNoteFileRouteEdits, baseHalfNoteStoresBelow } from '../../common/basehalfNoteFileRoutes.js';
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
		// Clones as the disk's own clone does, never over a file that is there.
		const fileClonesService = {
			_serviceBrand: undefined,
			clone: async (source: URI, target: URI) => {
				if (await fileService.exists(target)) {
					throw new Error('EEXIST: file already exists');
				}
				await fileService.copy(source, target, false);
			}
		} as unknown as IBaseHalfFileClonesService;
		const corrected = async (note: string, workspaceFolder = WORKSPACE) => {
			const text = (await fileService.readFile(joinPath(WORKSPACE, ...note.split('/')))).value.toString();
			const services = { fileService, fileClonesService, knownStores: () => baseHalfNoteStoresBelow(fileService, workspaceFolder) };
			return baseHalfApplyNoteRouteEdits(text, await baseHalfNoteFileRouteEdits(services, workspaceFolder, joinPath(WORKSPACE, ...note.split('/')), text));
		};
		const tree = async () => {
			const files: string[] = [];
			const walk = async (folder: URI) => {
				for (const child of (await fileService.resolve(folder)).children ?? []) {
					if (child.isDirectory) {
						await walk(child.resource);
					} else if (child.name !== '.gitignore') {
						files.push(relativePath(WORKSPACE, child.resource)!);
					}
				}
			};
			await walk(WORKSPACE);
			return files.sort();
		};
		return { fileService, corrected, tree };
	}

	/** `text` with each store folder that is not one of a test's own (ten times one letter) named by the order it first shows in. */
	function named(text: string, folders = new Map<string, string>()): string {
		return text.replace(/attachments\/([a-z0-9]{10})\//g, (whole, folder: string) => {
			if (/^(?<letter>[a-z])\k<letter>{9}$/.test(folder)) {
				return whole;
			}
			if (!folders.has(folder)) {
				folders.set(folder, `<new${folders.size + 1}>`);
			}
			return `attachments/${folders.get(folder)}/`;
		});
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

	test('a note moved outside BaseHalf into another home, or whose files are only in a store beside it, gets clones of its files and their edit records in its home\'s store (rules 30 and 31)', async () => {
		const workspace = await open({
			'repo/.git/HEAD': '',
			'repo/deep/moved.md': '![x](../.bh/attachments/aaaaaaaaaa/x%20y.png) ![w](../.bh/attachments/aaaaaaaaaa/w.png)\n',
			'.bh/attachments/aaaaaaaaaa/x y.png': 'x',
			'.bh/attachments/aaaaaaaaaa/w.png': 'w',
			'.bh/mirror/.bh/attachments/aaaaaaaaaa/x y.png/edit.yaml': 'crop',
			'.bh/mirror/.bh/attachments/aaaaaaaaaa/x y.png/original.png': 'original',
			'other/.git/HEAD': '',
			'other/.bh/attachments/bbbbbbbbbb/z.png': 'z',
			'beside/.git/HEAD': '',
			'beside/n.md': '![z](.bh/attachments/bbbbbbbbbb/z.png)\n',
		});
		const folders = new Map<string, string>();

		assert.deepStrictEqual({
			moved: named(await workspace.corrected('repo/deep/moved.md'), folders),
			beside: named(await workspace.corrected('beside/n.md'), folders),
			tree: (await workspace.tree()).map(path => named(path, folders)),
		}, {
			moved: '![x](../.bh/attachments/<new1>/x%20y.png) ![w](../.bh/attachments/<new1>/w.png)\n',
			beside: '![z](.bh/attachments/<new2>/z.png)\n',
			tree: [
				'.bh/attachments/aaaaaaaaaa/w.png',
				'.bh/attachments/aaaaaaaaaa/x y.png',
				'.bh/mirror/.bh/attachments/aaaaaaaaaa/x y.png/edit.yaml',
				'.bh/mirror/.bh/attachments/aaaaaaaaaa/x y.png/original.png',
				'.bh/mirror/repo/.bh/attachments/<new1>/x y.png/edit.yaml',
				'.bh/mirror/repo/.bh/attachments/<new1>/x y.png/original.png',
				'beside/.bh/attachments/<new2>/z.png',
				'beside/.git/HEAD',
				'beside/n.md',
				'other/.bh/attachments/bbbbbbbbbb/z.png',
				'other/.git/HEAD',
				'repo/.bh/attachments/<new1>/w.png',
				'repo/.bh/attachments/<new1>/x y.png',
				'repo/.git/HEAD',
				'repo/deep/moved.md',
			].sort(),
		});
	});

	test('a note moved outside BaseHalf down into a repository, whose link still leads into the store of the home it left, and a note linking a repository\'s store, get clones in their homes; a link into the home\'s own store is left (rule 31)', async () => {
		const workspace = await open({
			'repo/.git/HEAD': '',
			'repo/n.md': '![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			'.bh/attachments/aaaaaaaaaa/x.png': 'x',
			'.bh/mirror/.bh/attachments/aaaaaaaaaa/x.png/edit.yaml': 'crop',
			'root.md': '![y](repo/.bh/attachments/bbbbbbbbbb/y.png) ![z](.bh/attachments/cccccccccc/z.png)\n',
			'repo/.bh/attachments/bbbbbbbbbb/y.png': 'y',
			'.bh/attachments/cccccccccc/z.png': 'z',
		});
		const folders = new Map<string, string>();

		assert.deepStrictEqual({
			moved: named(await workspace.corrected('repo/n.md'), folders),
			root: named(await workspace.corrected('root.md'), folders),
			tree: (await workspace.tree()).map(path => named(path, folders)).sort(),
		}, {
			moved: '![x](.bh/attachments/<new1>/x.png)\n',
			root: '![y](.bh/attachments/<new2>/y.png) ![z](.bh/attachments/cccccccccc/z.png)\n',
			tree: [
				'.bh/attachments/<new2>/y.png',
				'.bh/attachments/aaaaaaaaaa/x.png',
				'.bh/attachments/cccccccccc/z.png',
				'.bh/mirror/.bh/attachments/aaaaaaaaaa/x.png/edit.yaml',
				'.bh/mirror/repo/.bh/attachments/<new1>/x.png/edit.yaml',
				'repo/.bh/attachments/<new1>/x.png',
				'repo/.bh/attachments/bbbbbbbbbb/y.png',
				'repo/.git/HEAD',
				'repo/n.md',
				'root.md',
			].sort(),
		});
	});

	test('a note of a subfolder\'s window gets the route to the store above the window\'s folder, which is never cloned from (rule 48)', async () => {
		const workspace = await open({
			'sub/deep/n.md': '![x](../.bh/attachments/cccccccccc/x.png)\n',
			'.bh/attachments/cccccccccc/x.png': 'x',
		});

		assert.deepStrictEqual([await workspace.corrected('sub/deep/n.md', joinPath(WORKSPACE, 'sub')), await workspace.tree()], [
			'![x](../../.bh/attachments/cccccccccc/x.png)\n',
			['.bh/attachments/cccccccccc/x.png', 'sub/deep/n.md'],
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

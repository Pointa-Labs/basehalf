/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { isEqualOrParent, joinPath, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfFileClonesService } from '../../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { baseHalfCopyNoteFiles } from '../../common/basehalfNoteFileCopies.js';

const WORKSPACE = URI.file('/workspace');

suite('BaseHalfNoteFileCopies', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string>, failing: readonly string[] = []) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(WORKSPACE, ...path.split('/')), VSBuffer.fromString(content));
		}
		// Clones as the disk's own clone does, never over a file that is there; a file named in `failing` fills the disk.
		const fileClonesService = {
			_serviceBrand: undefined,
			clone: async (source: URI, target: URI) => {
				if (failing.some(name => source.path.endsWith(name))) {
					throw new Error('ENOSPC: no space left on device');
				}
				if (await fileService.exists(target)) {
					throw new Error('EEXIST: file already exists');
				}
				await fileService.copy(source, target, false);
			}
		} as unknown as IBaseHalfFileClonesService;
		const services = { fileService, fileClonesService, workspaceFolderOf: (resource: URI) => isEqualOrParent(resource, WORKSPACE) ? WORKSPACE : undefined };
		const copy = async (source: string, target: string) => {
			await fileService.copy(joinPath(WORKSPACE, ...source.split('/')), joinPath(WORKSPACE, ...target.split('/')), false);
			return baseHalfCopyNoteFiles(services, [{ source: joinPath(WORKSPACE, ...source.split('/')), target: joinPath(WORKSPACE, ...target.split('/')) }]);
		};
		const tree = async () => {
			const files: Record<string, string> = {};
			const walk = async (folder: URI) => {
				for (const child of (await fileService.resolve(folder)).children ?? []) {
					if (child.isDirectory) {
						await walk(child.resource);
					} else {
						files[relativePath(WORKSPACE, child.resource)!] = (await fileService.readFile(child.resource)).value.toString();
					}
				}
			};
			await walk(WORKSPACE);
			return files;
		};
		return { copy, tree };
	}

	/** The tree with each new folder of the store named by the order it first shows in. */
	function named(files: Record<string, string>): Record<string, string> {
		const folders = new Map<string, string>();
		const name = (text: string) => text.replace(/attachments\/([a-z0-9]{10})\//g, (whole, folder: string) => {
			if (/^(?<letter>[a-z])\k<letter>{9}$/.test(folder)) {
				return whole;
			}
			if (!folders.has(folder)) {
				folders.set(folder, `<new${folders.size + 1}>`);
			}
			return `attachments/${folders.get(folder)}/`;
		});
		return Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith('.gitignore')).map(([path, content]) => [name(path), name(content)]).sort(([a], [b]) => a.localeCompare(b)));
	}

	test('a copied note gets its own folder of clones and edit records, its links pointed at them from its place; the original is untouched', async () => {
		const note = '![a](.bh/attachments/aaaaaaaaaa/a%20b.png)\n\n<video src=".bh/attachments/aaaaaaaaaa/clip.mp4" controls></video>\n\n[again](<.bh/attachments/aaaaaaaaaa/a b.png>) [gone](.bh/attachments/aaaaaaaaaa/gone.pdf) [other](other.md)\n';
		const workspace = await open({
			'note.md': note,
			'other.md': '',
			'.bh/attachments/aaaaaaaaaa/a b.png': 'picture',
			'.bh/attachments/aaaaaaaaaa/clip.mp4': 'clip',
			'.bh/mirror/.bh/attachments/aaaaaaaaaa/a b.png/edit.yaml': 'original: original.png\n',
			'.bh/mirror/.bh/attachments/aaaaaaaaaa/a b.png/original.png': 'first',
		});
		const failed = await workspace.copy('note.md', 'deep/copy.md');
		assert.deepStrictEqual({ failed, tree: named(await workspace.tree()) }, {
			failed: [],
			tree: {
				'.bh/attachments/<new1>/a b.png': 'picture',
				'.bh/attachments/<new1>/clip.mp4': 'clip',
				'.bh/attachments/aaaaaaaaaa/a b.png': 'picture',
				'.bh/attachments/aaaaaaaaaa/clip.mp4': 'clip',
				'.bh/mirror/.bh/attachments/<new1>/a b.png/edit.yaml': 'original: original.png\n',
				'.bh/mirror/.bh/attachments/<new1>/a b.png/original.png': 'first',
				'.bh/mirror/.bh/attachments/aaaaaaaaaa/a b.png/edit.yaml': 'original: original.png\n',
				'.bh/mirror/.bh/attachments/aaaaaaaaaa/a b.png/original.png': 'first',
				'deep/copy.md': '![a](../.bh/attachments/<new1>/a%20b.png)\n\n<video src="../.bh/attachments/<new1>/clip.mp4" controls></video>\n\n[again](../.bh/attachments/<new1>/a%20b.png) [gone](.bh/attachments/aaaaaaaaaa/gone.pdf) [other](other.md)\n',
				'note.md': note,
				'other.md': '',
			},
		});
	});

	test('the notes of a copied folder each get their own folder; a store the folder carries along is the copy\'s own; a file that cannot be cloned stays the original\'s, linked from the copy', async () => {
		const workspace = await open({
			'notes/a.md': '![](../.bh/attachments/aaaaaaaaaa/a.png)\n',
			'notes/sub/b.md': '![](../../.bh/attachments/bbbbbbbbbb/b.png) ![](../../.bh/attachments/bbbbbbbbbb/full.png)\n',
			'notes/repo/.git/HEAD': 'ref: refs/heads/main\n',
			'notes/repo/c.md': '![](.bh/attachments/cccccccccc/c.png)\n',
			'notes/repo/.bh/attachments/cccccccccc/c.png': 'c',
			'.bh/attachments/aaaaaaaaaa/a.png': 'a',
			'.bh/attachments/bbbbbbbbbb/b.png': 'b',
			'.bh/attachments/bbbbbbbbbb/full.png': 'full',
		}, ['full.png']);
		const failed = await workspace.copy('notes', 'copied');
		const tree = named(await workspace.tree());
		assert.deepStrictEqual({ failed: failed.map(resource => relativePath(WORKSPACE, resource)), copies: Object.fromEntries(Object.entries(tree).filter(([path]) => path.startsWith('copied/') && /\.(?:md|png)$/.test(path) || path.includes('<new'))) }, {
			failed: ['copied/sub/b.md'],
			copies: {
				'.bh/attachments/<new1>/a.png': 'a',
				'.bh/attachments/<new2>/b.png': 'b',
				'copied/a.md': '![](../.bh/attachments/<new1>/a.png)\n',
				'copied/repo/.bh/attachments/cccccccccc/c.png': 'c',
				'copied/repo/c.md': '![](.bh/attachments/cccccccccc/c.png)\n',
				'copied/sub/b.md': '![](../../.bh/attachments/<new2>/b.png) ![](../../.bh/attachments/bbbbbbbbbb/full.png)\n',
			},
		});
	});
});

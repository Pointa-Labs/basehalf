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
import { FileSystemProviderCapabilities, IFileDeleteOptions, IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { BASEHALF_NOTE_FILE_RELEASE_MS, baseHalfReleaseUnmentionedNoteFiles, IBaseHalfNoteFileScanLimits } from '../../common/basehalfNoteFileRetention.js';

const WORKSPACE = URI.file('/workspace');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 3);
const NOTES = '.bh/cache/note-files.json';

/** A disk with a Trash: what goes there is listed, and leaves the disk. */
class TrashingFileSystemProvider extends InMemoryFileSystemProvider {
	readonly trashed: string[] = [];
	/** Text written into a file right after its first read, as an edit while the scan runs. */
	readonly afterFirstRead = new Map<string, string>();

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.Trash;
	}

	override async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		if (opts.useTrash) {
			this.trashed.push(relativePath(WORKSPACE, resource)!);
		}
		return super.delete(resource, { ...opts, useTrash: false });
	}

	override async readFile(resource: URI): Promise<Uint8Array> {
		const value = await super.readFile(resource);
		const later = this.afterFirstRead.get(resource.path);
		if (later !== undefined) {
			this.afterFirstRead.delete(resource.path);
			await this.writeFile(resource, VSBuffer.fromString(later).buffer, { create: false, overwrite: true, unlock: false, atomic: false });
		}
		return value;
	}
}

suite('BaseHalfNoteFileRetention', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string>) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		const provider = store.add(new TrashingFileSystemProvider());
		store.add(fileService.registerProvider(Schemas.file, provider));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(WORKSPACE, ...path.split('/')), VSBuffer.fromString(content));
		}
		const scan = (now: number, options: { readonly openTexts?: readonly string[]; readonly limits?: IBaseHalfNoteFileScanLimits; readonly trash?: boolean } = {}) => baseHalfReleaseUnmentionedNoteFiles({
			fileService,
			logService: new NullLogService(),
			trash: options.trash ?? true,
			now: () => now,
			openTexts: () => options.openTexts ?? [],
			limits: options.limits,
		}, WORKSPACE);
		return { fileService, provider, scan, files: () => tree(fileService), notes: async () => JSON.parse((await fileService.readFile(joinPath(WORKSPACE, ...NOTES.split('/')))).value.toString()) };
	}

	async function tree(fileService: IFileService): Promise<string[]> {
		const out: string[] = [];
		const stack = [WORKSPACE];
		while (stack.length) {
			const stat = await fileService.resolve(stack.pop()!).catch(() => undefined);
			for (const child of stat?.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					out.push(relativePath(WORKSPACE, child.resource)!);
				}
			}
		}
		return out.filter(path => !path.startsWith('.bh/cache/') && path !== '.bh/.gitignore').sort();
	}

	test('a file that a note mentions stays; one nothing mentions for 30 days goes to the Trash, a folder none of whose files is mentioned as one item', async () => {
		const workspace = await open({
			'notes/a.md': '![x](../.bh/attachments/aaaaaaaaaa/x%20y.png)\n',
			'b.md': 'no files\n',
			'.bh/attachments/aaaaaaaaaa/x y.png': 'kept',
			'.bh/attachments/aaaaaaaaaa/gone.png': 'released alone',
			'.bh/attachments/bbbbbbbbbb/one.pdf': 'released with its folder',
			'.bh/attachments/bbbbbbbbbb/two.pdf': 'released with its folder',
		});

		const first = await workspace.scan(NOW);
		const notedAt = (await workspace.notes()).unmentioned;
		const early = await workspace.scan(NOW + BASEHALF_NOTE_FILE_RELEASE_MS - DAY);
		const due = await workspace.scan(NOW + BASEHALF_NOTE_FILE_RELEASE_MS);

		assert.deepStrictEqual({
			first: first.outcome,
			notedAt,
			early: early.outcome,
			due,
			trashed: workspace.provider.trashed.sort(),
			files: await workspace.files(),
			notes: (await workspace.notes()).unmentioned
		}, {
			first: 'noted',
			notedAt: { '.bh/attachments/aaaaaaaaaa/gone.png': NOW, '.bh/attachments/bbbbbbbbbb/one.pdf': NOW, '.bh/attachments/bbbbbbbbbb/two.pdf': NOW },
			early: 'noted',
			due: { outcome: 'released', released: ['.bh/attachments/aaaaaaaaaa/gone.png', '.bh/attachments/bbbbbbbbbb'] },
			trashed: ['.bh/attachments/aaaaaaaaaa/gone.png', '.bh/attachments/bbbbbbbbbb'],
			files: ['.bh/attachments/aaaaaaaaaa/x y.png', 'b.md', 'notes/a.md'],
			notes: {}
		});
	});

	test('a mention counts as written, percent-encoded, in NFD, in HTML, in the kept versions, and in the open text of a note; a file mentioned again loses its note', async () => {
		const workspace = await open({
			'a.md': '<img src="../.bh/attachments/cccccccccc/%E6%8A%A5%E5%91%8A.png">\n[x](.bh%2Fattachments%2Fcccccccccc%2Fplain.pdf)\n',
			'b.txt': `.bh/attachments/cccccccccc/${'é'}tude.m4a`,
			'.bh/cache/kept/window/deleted.md': '![d](.bh/attachments/cccccccccc/deleted.png)\n',
			'.bh/attachments/cccccccccc/报告.png': '',
			'.bh/attachments/cccccccccc/plain.pdf': '',
			'.bh/attachments/cccccccccc/étude.m4a': '',
			'.bh/attachments/cccccccccc/deleted.png': '',
			'.bh/attachments/cccccccccc/open.png': '',
			'.bh/attachments/cccccccccc/back.png': '',
			[NOTES]: JSON.stringify({ unmentioned: { '.bh/attachments/cccccccccc/back.png': NOW - 40 * DAY } }),
		});
		await workspace.fileService.writeFile(joinPath(WORKSPACE, 'c.md'), VSBuffer.fromString('![back](.bh/attachments/cccccccccc/back.png)\n'));

		const result = await workspace.scan(NOW, { openTexts: ['![o](.bh/attachments/cccccccccc/open.png)'] });

		assert.deepStrictEqual({ result, notes: (await workspace.notes()).unmentioned }, { result: { outcome: 'noted', released: [] }, notes: {} });
	});

	test('a scan runs at most once a day and by one window at a time; a stale lock is taken over', async () => {
		const workspace = await open({ 'a.md': '', '.bh/attachments/dddddddddd/x.png': '' });

		const first = await workspace.scan(NOW);
		const again = await workspace.scan(NOW + DAY - 1);
		await workspace.fileService.writeFile(joinPath(WORKSPACE, '.bh', 'cache', 'note-files.lock'), VSBuffer.fromString(String(NOW + DAY)));
		const locked = await workspace.scan(NOW + DAY + 60_000);
		const stale = await workspace.scan(NOW + DAY + 6 * 60_000);

		assert.deepStrictEqual([first.outcome, again.outcome, locked.outcome, stale.outcome, await workspace.fileService.exists(joinPath(WORKSPACE, '.bh', 'cache', 'note-files.lock'))], ['noted', 'recent', 'locked', 'noted', false]);
	});

	test('a run that could not read everything, met a file kept in the cloud, or reached a limit notes and releases nothing; a marked folder and one without .bh are not scanned', async () => {
		const files = { 'a.md': 'x'.repeat(100), '.bh/attachments/eeeeeeeeee/x.png': '' };
		const limited = await open(files);
		await limited.scan(NOW - BASEHALF_NOTE_FILE_RELEASE_MS);
		const limit = await limited.scan(NOW, { limits: { files: 10, fileBytes: 50, totalBytes: 1000 } });
		const cloud = await open({ ...files, '.b.md.icloud': '', [NOTES]: JSON.stringify({ unmentioned: { '.bh/attachments/eeeeeeeeee/x.png': NOW - 40 * DAY } }) });
		const inCloud = await cloud.scan(NOW);
		const marked = await open({ ...files, '.basehalf-no-workspace-setup': '' });
		const bare = await open({ 'a.md': '' });

		assert.deepStrictEqual({
			limit: [limit.outcome, await limited.fileService.exists(joinPath(WORKSPACE, '.bh', 'attachments', 'eeeeeeeeee', 'x.png'))],
			cloud: [inCloud.outcome, await cloud.fileService.exists(joinPath(WORKSPACE, '.bh', 'attachments', 'eeeeeeeeee', 'x.png'))],
			marked: (await marked.scan(NOW)).outcome,
			bare: [(await bare.scan(NOW)).outcome, await bare.files()],
		}, {
			limit: ['limit', true],
			cloud: ['cloud', true],
			marked: 'marked',
			bare: ['none', ['a.md']],
		});
	});

	test('just before a release, a file that changed since the scan is read again; without the Trash a released file is deleted with its edit record', async () => {
		const workspace = await open({
			'late.md': 'nothing yet\n',
			'.bh/attachments/ffffffffff/late.png': '',
			'.bh/attachments/gggggggggg/edited.png': '',
			'.bh/mirror/.bh/attachments/gggggggggg/edited.png/edit.yaml': 'original: original.png\n',
			[NOTES]: JSON.stringify({ unmentioned: { '.bh/attachments/ffffffffff/late.png': NOW - 40 * DAY, '.bh/attachments/gggggggggg/edited.png': NOW - 40 * DAY } }),
		});
		workspace.provider.afterFirstRead.set('/workspace/late.md', 'now it links ![l](.bh/attachments/ffffffffff/late.png) after a longer while\n');

		const result = await workspace.scan(NOW, { trash: false });

		assert.deepStrictEqual({ result, trashed: workspace.provider.trashed, files: await workspace.files() }, {
			result: { outcome: 'released', released: ['.bh/attachments/gggggggggg'] },
			trashed: [],
			files: ['.bh/attachments/ffffffffff/late.png', 'late.md']
		});
	});
});

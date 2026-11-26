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
import { serializeBaseHalfEditRecord } from '../../common/basehalfEditRecord.js';
import { BASEHALF_GONE_ORIGINAL_MS, baseHalfNoteGoneOriginals, baseHalfOriginalFileName } from '../../common/basehalfGoneOriginals.js';

const WORKSPACE = URI.file('/workspace');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26);
const NOTES = '.bh/cache/gone-originals.json';
const RECORD = serializeBaseHalfEditRecord({ original: 'original.mp4', result: { size: 9, hash: 'a'.repeat(64) }, keep: [{ start: 0, end: 1 }] });

/** A disk with a Trash: what goes there is listed, and leaves the disk. */
class TrashingFileSystemProvider extends InMemoryFileSystemProvider {
	readonly trashed: string[] = [];

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.Trash;
	}

	override async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		if (opts.useTrash) {
			this.trashed.push(relativePath(WORKSPACE, resource)!);
		}
		return super.delete(resource, { ...opts, useTrash: false });
	}
}

suite('BaseHalfGoneOriginals', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string>) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		const provider = store.add(new TrashingFileSystemProvider());
		store.add(fileService.registerProvider(Schemas.file, provider));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(WORKSPACE, ...path.split('/')), VSBuffer.fromString(content));
		}
		const deletes: string[] = [];
		const sweep = (now: number, options: { readonly trash?: boolean; readonly waiting?: readonly string[] } = {}) => baseHalfNoteGoneOriginals({
			fileService,
			logService: new NullLogService(),
			trash: options.trash ?? true,
			acceptWorkbenchDelete: (_workspace, path) => deletes.push(path),
			now: () => now
		}, WORKSPACE, options.waiting ?? []);
		return { fileService, provider, deletes, sweep, files: () => tree(fileService) };
	}

	/** Every file of the workspace with its text. */
	async function tree(fileService: IFileService): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		const stack = [WORKSPACE];
		while (stack.length) {
			const stat = await fileService.resolve(stack.pop()!).catch(() => undefined);
			for (const child of stat?.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					out[relativePath(WORKSPACE, child.resource)!] = (await fileService.readFile(child.resource)).value.toString();
				}
			}
		}
		return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)));
	}

	/** The card information of an edited file. */
	const edited = (path: string, record = RECORD) => ({ [`.bh/mirror/${path}/edit.yaml`]: record, [`.bh/mirror/${path}/original.mp4`]: `the original of ${path}` });

	test('names an original after its file, with a number from the second on (D84)', () => {
		assert.deepStrictEqual(
			[baseHalfOriginalFileName('shot.mp4', 'original.mp4'), baseHalfOriginalFileName('shot.mp4', 'original.mov', 2), baseHalfOriginalFileName('a.b.wav', 'original.wav'), baseHalfOriginalFileName('take', 'original.flac')],
			['shot original.mp4', 'shot original 2.mov', 'a.b original.wav', 'take original.flac']
		);
	});

	test('notes an original whose file is gone and keeps it; after 30 days of opens it goes to the Trash beside where the file was, and its record goes (D84)', async () => {
		const harness = await open({ 'shots/here.mp4': 'here', 'shots/other.md': '# Other\n', ...edited('shots/here.mp4'), ...edited('shots/gone.mp4') });
		await harness.sweep(NOW);
		const noted = await harness.files();
		await harness.sweep(NOW + BASEHALF_GONE_ORIGINAL_MS - DAY);
		const stillKept = (await harness.files())['.bh/mirror/shots/gone.mp4/original.mp4'];
		await harness.sweep(NOW + BASEHALF_GONE_ORIGINAL_MS);
		assert.deepStrictEqual({ noted: noted[NOTES], stillKept, trashed: harness.provider.trashed, deletes: harness.deletes, files: await harness.files() }, {
			noted: JSON.stringify({ 'shots/gone.mp4': NOW }, undefined, '\t'),
			stillKept: 'the original of shots/gone.mp4',
			// From the folder that held the file: Put Back returns it there.
			trashed: ['shots/gone original.mp4'],
			deletes: ['shots/gone original.mp4'],
			files: {
				'.bh/.gitignore': noted['.bh/.gitignore'],
				...edited('shots/here.mp4'),
				'shots/here.mp4': 'here',
				'shots/other.md': '# Other\n'
			}
		});
	});

	test('a file that is back loses its note, and the 30 days start again when it is gone again (D84)', async () => {
		const harness = await open({ ...edited('shots/shot.mp4') });
		await harness.sweep(NOW);
		await harness.fileService.writeFile(joinPath(WORKSPACE, 'shots', 'shot.mp4'), VSBuffer.fromString('back'));
		await harness.sweep(NOW + 10 * DAY);
		const back = (await harness.files())[NOTES];
		await harness.fileService.del(joinPath(WORKSPACE, 'shots', 'shot.mp4'));
		await harness.sweep(NOW + 20 * DAY);
		await harness.sweep(NOW + BASEHALF_GONE_ORIGINAL_MS + DAY);
		assert.deepStrictEqual({ back, notes: (await harness.files())[NOTES], trashed: harness.provider.trashed }, {
			back: undefined,
			notes: JSON.stringify({ 'shots/shot.mp4': NOW + 20 * DAY }, undefined, '\t'),
			trashed: []
		});
	});

	test('keeps, without a note, an original whose move waits, whose record cannot be read, or whose file a cloud folder holds a placeholder of; takes the next free name; and goes from the card information when the folder is gone (D84)', async () => {
		const longAgo = NOW - BASEHALF_GONE_ORIGINAL_MS - DAY;
		const harness = await open({
			[NOTES]: JSON.stringify({ 'shots/moving.mp4': longAgo, 'shots/broken.mp4': longAgo, 'shots/evicted.mp4': longAgo, 'shots/taken.mp4': longAgo, 'gone/clip.mp4': longAgo }),
			...edited('shots/moving.mp4'),
			...edited('shots/broken.mp4', 'original: [the record'),
			...edited('shots/evicted.mp4'),
			'shots/.evicted.mp4.icloud': 'a placeholder',
			...edited('shots/taken.mp4'),
			'shots/taken original.mp4': 'a file of the user',
			...edited('gone/clip.mp4')
		});
		await harness.sweep(NOW, { waiting: ['shots/moving.mp4'] });
		const files = await harness.files();
		assert.deepStrictEqual({
			trashed: [...harness.provider.trashed].sort(),
			deletes: harness.deletes,
			notes: files[NOTES],
			kept: Object.keys(files).filter(path => path.endsWith('/original.mp4')),
			records: Object.keys(files).filter(path => path.endsWith('/edit.yaml')),
			usersFile: files['shots/taken original.mp4']
		}, {
			trashed: ['.bh/mirror/gone/clip.mp4/clip original.mp4', 'shots/taken original 2.mp4'],
			deletes: ['shots/taken original 2.mp4'],
			notes: undefined,
			kept: ['.bh/mirror/shots/broken.mp4/original.mp4', '.bh/mirror/shots/evicted.mp4/original.mp4', '.bh/mirror/shots/moving.mp4/original.mp4'],
			records: ['.bh/mirror/shots/broken.mp4/edit.yaml', '.bh/mirror/shots/evicted.mp4/edit.yaml', '.bh/mirror/shots/moving.mp4/edit.yaml'],
			usersFile: 'a file of the user'
		});
	});

	test('deletes the original for good when the Trash is off, and leaves a folder marked to be left alone as it is (D84)', async () => {
		const harness = await open({ [NOTES]: JSON.stringify({ 'shot.mp4': NOW - BASEHALF_GONE_ORIGINAL_MS }), ...edited('shot.mp4') });
		await harness.sweep(NOW, { trash: false });
		const marked = await open({ '.basehalf-no-workspace-setup': '', [NOTES]: JSON.stringify({ 'shot.mp4': NOW - BASEHALF_GONE_ORIGINAL_MS }), ...edited('shot.mp4') });
		await marked.sweep(NOW);
		assert.deepStrictEqual({
			trashed: harness.provider.trashed,
			left: Object.keys(await harness.files()).filter(path => path.startsWith('.bh/mirror/')),
			marked: Object.keys(await marked.files()).filter(path => path.startsWith('.bh/mirror/'))
		}, {
			trashed: [],
			left: [],
			marked: ['.bh/mirror/shot.mp4/edit.yaml', '.bh/mirror/shot.mp4/original.mp4']
		});
	});
});

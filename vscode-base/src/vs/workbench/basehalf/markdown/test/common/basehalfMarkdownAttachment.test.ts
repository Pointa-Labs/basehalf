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
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { BASEHALF_MIRROR_IGNORE_CONTENT } from '../../../workspace/common/basehalfMirrorIgnore.js';
import { BaseHalfMarkdownAttachmentService, baseHalfMarkdownAttachmentHref, BaseHalfNoteFileError, baseHalfNoteFileFailure } from '../../common/basehalfMarkdownAttachment.js';
import { baseHalfNoteLinkDestinations, baseHalfNoteLinkPath, baseHalfNoteStoreLink, baseHalfNoteStoreLinks } from '../../common/basehalfNoteFileLinks.js';
import { baseHalfNoteFileName, baseHalfNoteFreeName, baseHalfNoteNumberedName, baseHalfNoteUntitledPictureName, isBaseHalfNoteUnnamedPicture, newBaseHalfNoteFolderName } from '../../common/basehalfNoteFiles.js';

const WORKSPACE = URI.file('/workspace');
const FOLDER = /^[a-z0-9]{10}$/;

suite('BaseHalfMarkdownAttachment', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string>) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(WORKSPACE, ...path.split('/')), VSBuffer.fromString(content));
		}
		const contextService = { getWorkspaceFolder: (resource: URI) => isEqualOrParent(resource, WORKSPACE) ? { uri: WORKSPACE } : null } as unknown as IWorkspaceContextService;
		const service = new BaseHalfMarkdownAttachmentService(fileService, contextService);
		const put = (note: string, text: string, name: string, mediaType = '', content = name, now?: Date) =>
			service.store(URI.joinPath(WORKSPACE, ...note.split('/')), text, name, mediaType, new TextEncoder().encode(content).buffer as ArrayBuffer, now);
		return { fileService, put, files: () => tree(fileService) };
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
		return out;
	}

	function folderOf(href: string): string {
		const link = baseHalfNoteStoreLink(href);
		assert.ok(link && FOLDER.test(link.folder), href);
		return link.folder;
	}

	function reason(error: unknown): string {
		return error instanceof BaseHalfNoteFileError ? error.message : `not plain: ${error}`;
	}

	test('a file put into a note in a subfolder goes into a folder of its own in the workspace folder\'s store, linked from the note', async () => {
		const workspace = await open({ '读书/Untitled 1.md': '# Week 1\n' });

		const stored = await workspace.put('读书/Untitled 1.md', '# Week 1\n', '报告 v2.pdf', 'application/pdf', 'pdf bytes');

		const folder = folderOf(stored.href);
		assert.deepStrictEqual({ stored: { href: stored.href, name: stored.name, path: relativePath(WORKSPACE, stored.resource) }, files: await workspace.files() }, {
			stored: { href: `../.bh/attachments/${folder}/报告%20v2.pdf`, name: '报告 v2.pdf', path: `.bh/attachments/${folder}/报告 v2.pdf` },
			files: {
				'.bh/.gitignore': BASEHALF_MIRROR_IGNORE_CONTENT,
				[`.bh/attachments/${folder}/报告 v2.pdf`]: 'pdf bytes',
				'读书/Untitled 1.md': '# Week 1\n'
			}
		});
	});

	test('a note\'s next file goes into the folder its links name, a taken name gets a number without regard to case, and nothing is overwritten', async () => {
		const workspace = await open({ 'a.md': '', 'b.md': '' });

		const first = await workspace.put('a.md', '', 'Cat.jpg', 'image/jpeg', 'first');
		const folder = folderOf(first.href);
		const text = `![Cat.jpg](${first.href})\n`;
		const second = await workspace.put('a.md', text, 'cat.JPG', 'image/jpeg', 'second');
		const third = await workspace.put('a.md', `${text}\n[x](https://example.com/a.png)\n\`![old](.bh/attachments/zzzzzzzzzz/old.png)\`\n`, 'Cat.jpg', 'image/jpeg', 'third');
		// Another note gets a folder of its own: nothing is shared between notes.
		const other = await workspace.put('b.md', '', 'Cat.jpg', 'image/jpeg', 'other');

		assert.deepStrictEqual({
			names: [first.name, second.name, third.name],
			folders: [folderOf(second.href), folderOf(third.href)],
			otherFolderDiffers: folderOf(other.href) !== folder,
			first: (await workspace.fileService.readFile(first.resource)).value.toString()
		}, {
			names: ['Cat.jpg', 'cat 2.JPG', 'Cat 3.jpg'],
			folders: [folder, folder],
			otherFolderDiffers: true,
			first: 'first'
		});
	});

	test('files put in at once, and a file put in after an undo took the note\'s last link away, go into the one folder of the note', async () => {
		const workspace = await open({ 'a.md': '' });

		const together = await Promise.all([workspace.put('a.md', '', 'one.png', 'image/png'), workspace.put('a.md', '', 'two.png', 'image/png')]);
		const afterUndo = await workspace.put('a.md', '', 'three.png', 'image/png');

		assert.deepStrictEqual(new Set([...together, afterUndo].map(stored => folderOf(stored.href))).size, 1);
	});

	test('a link whose folder is gone or out of reach gets the note a new folder; a store above the workspace folder is in reach', async () => {
		const workspace = await open({ 'notes/a.md': '', 'b.md': '' });
		await workspace.fileService.createFolder(URI.file('/elsewhere/.bh/attachments/cccccccccc'));
		await workspace.fileService.createFolder(URI.file('/.bh/attachments/dddddddddd'));

		const gone = await workspace.put('notes/a.md', '![gone](../.bh/attachments/aaaaaaaaaa/gone.png)\n[far](../../elsewhere/.bh/attachments/cccccccccc/x.pdf)\n', 'x.pdf', 'application/pdf');
		const above = await workspace.put('b.md', '![up](../.bh/attachments/dddddddddd/y.png)\n', 'z.png', 'image/png');

		assert.deepStrictEqual({
			gone: ['aaaaaaaaaa', 'cccccccccc'].includes(folderOf(gone.href)),
			above: [above.href, above.resource.path]
		}, {
			gone: false,
			above: ['../.bh/attachments/dddddddddd/z.png', '/.bh/attachments/dddddddddd/z.png']
		});
	});

	test('a picture without a name is named by the local time it was put in, and names are cleaned for the store', async () => {
		const workspace = await open({ 'a.md': '' });
		const at = new Date(2026, 10, 3, 15, 30, 12);

		const stored = [
			await workspace.put('a.md', '', 'image.png', 'image/png', 'png', at),
			await workspace.put('a.md', '', 'blob', 'image/jpeg', 'jpeg', at),
			await workspace.put('a.md', '', 'a[1]: b?.txt', 'text/plain'),
			await workspace.put('a.md', '', '.gitignore', ''),
			await workspace.put('a.md', '', 'étude.txt', 'text/plain'),
		];

		assert.deepStrictEqual(stored.map(file => [file.name, file.href.slice(file.href.lastIndexOf('/') + 1)]), [
			['untitled 2026-11-03 15.30.12.png', 'untitled%202026-11-03%2015.30.12.png'],
			['untitled 2026-11-03 15.30.12.jpg', 'untitled%202026-11-03%2015.30.12.jpg'],
			['a(1)- b-.txt', 'a%281%29-%20b-.txt'],
			['_.gitignore', '_.gitignore'],
			['étude.txt', 'étude.txt']
		]);
	});

	test('a repository inside the workspace folder keeps its notes\' files at its own root, with its ignore file, and so does a folder with its own .bh', async () => {
		const workspace = await open({ 'repo/.git/HEAD': 'ref: refs/heads/main\n', 'repo/docs/a.md': '', 'own/.bh/mirror/canvas.yaml': 'cards: []\n', 'own/b.md': '' });

		const inRepository = await workspace.put('repo/docs/a.md', '', 'x.png', 'image/png');
		const inOwn = await workspace.put('own/b.md', '', 'y.png', 'image/png');

		const paths = Object.keys(await workspace.files()).sort();
		assert.deepStrictEqual({
			hrefs: [inRepository.href, inOwn.href],
			ignoreFiles: paths.filter(path => path.endsWith('.gitignore')),
			stored: paths.filter(path => path.includes('/attachments/')).map(path => path.replace(/\/[a-z0-9]{10}\//, '/<folder>/'))
		}, {
			hrefs: [`../.bh/attachments/${folderOf(inRepository.href)}/x.png`, `.bh/attachments/${folderOf(inOwn.href)}/y.png`],
			ignoreFiles: ['own/.bh/.gitignore', 'repo/.bh/.gitignore'],
			stored: ['own/.bh/attachments/<folder>/y.png', 'repo/.bh/attachments/<folder>/x.png']
		});
	});

	test('a marked folder, a note outside the workspace folder, and a file too large take nothing, and say why in plain words', async () => {
		const marked = await open({ '.basehalf-no-workspace-setup': '', 'a.md': '' });
		const reasons = [
			await marked.put('a.md', '', 'x.png', 'image/png').then(() => 'stored', reason),
			await marked.put('../elsewhere/b.md', '', 'x.png', 'image/png').then(() => 'stored', reason),
		];
		const service = new BaseHalfMarkdownAttachmentService(marked.fileService, { getWorkspaceFolder: () => ({ uri: WORKSPACE }) } as unknown as IWorkspaceContextService);
		reasons.push(await service.store(joinPath(WORKSPACE, 'a.md'), '', 'clip.mp4', 'video/mp4', { byteLength: 100 * 1024 * 1024 + 1 } as ArrayBuffer).then(() => 'stored', reason));

		assert.deepStrictEqual({ reasons, files: Object.keys(await marked.files()).sort() }, {
			reasons: [
				'Could not add x.png: files cannot be put into notes in this folder.',
				'Could not add x.png: the note is not in the open folder.',
				'Could not add clip.mp4: a note takes files of at most 100 MB.'
			],
			files: ['.basehalf-no-workspace-setup', 'a.md']
		});
	});

	test('a failure of the disk says what happened without its path', () => {
		const full = Object.assign(new Error('ENOSPC: no space left on device, open \'/workspace/.bh/attachments/7k3f9q2m1x/clip.mp4\''), { code: 'ENOSPC' });
		assert.deepStrictEqual([
			baseHalfNoteFileFailure('clip.mp4', full),
			baseHalfNoteFileFailure('clip.mp4', new FileOperationError('Unable to write file \'/workspace/.bh/attachments/x/clip.mp4\'', FileOperationResult.FILE_PERMISSION_DENIED)),
			baseHalfNoteFileFailure('clip.mp4', new Error('/workspace/.bh/attachments/x: something else')),
			baseHalfNoteFileFailure('clip.mp4', new BaseHalfNoteFileError('Could not add clip.mp4: the note is read-only.')),
		], [
			'Could not add clip.mp4: the disk is full.',
			'Could not add clip.mp4: BaseHalf may not write into this folder.',
			'Could not add clip.mp4: it could not be saved.',
			'Could not add clip.mp4: the note is read-only.'
		]);
	});

	test('the note\'s link is relative to its folder, in the one encoding', () => {
		assert.deepStrictEqual([
			baseHalfMarkdownAttachmentHref(URI.file('/workspace/notes/week-1.md'), URI.file('/workspace/.bh/attachments/7k3f9q2m1x/lecture #1.pdf')),
			baseHalfMarkdownAttachmentHref(URI.file('/workspace/a/b/c.md'), URI.file('/workspace/.bh/attachments/7k3f9q2m1x/R&D (final).png')),
			baseHalfMarkdownAttachmentHref(URI.file('/workspace/c.md'), URI.file('/workspace/.bh/attachments/7k3f9q2m1x/会议 记录.m4a')),
		], [
			'../.bh/attachments/7k3f9q2m1x/lecture%20%231.pdf',
			'../../.bh/attachments/7k3f9q2m1x/R%26D%20%28final%29.png',
			'.bh/attachments/7k3f9q2m1x/会议%20记录.m4a'
		]);
	});
});

suite('BaseHalfNoteFileLinks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads a destination as every place reads it', () => {
		assert.deepStrictEqual([
			'../.bh/attachments/7k3f9q2m1x/a%20b.png',
			'<../.bh/attachments/7k3f9q2m1x/a b.png>',
			'a\\(1\\).png',
			'x.png?v=2#top',
			'e%CC%81.png',
			'bad%zz%20.png',
			'https://example.com/a.png',
			'#heading',
			'/absolute.png',
			'',
		].map(baseHalfNoteLinkPath), [
			'../.bh/attachments/7k3f9q2m1x/a b.png',
			'../.bh/attachments/7k3f9q2m1x/a b.png',
			'a(1).png',
			'x.png',
			'é.png',
			'bad%zz .png',
			undefined,
			undefined,
			undefined,
			undefined
		]);
	});

	test('a link into the store ends in .bh/attachments/<folder>/<file>, with its route before it', () => {
		assert.deepStrictEqual([
			'../../.bh/attachments/7k3f9q2m1x/cat%202.jpg',
			'.bh/attachments/n/x.pdf',
			'sub/.bh/attachments/n/x.pdf',
			'.bh/attachments/x.pdf',
			'.bh/attachments/n/deeper/x.pdf',
			'.bh/attachments/../x.pdf',
			'.bh/mirror/n/x.pdf',
			'attachments/x.pdf',
		].map(destination => {
			const link = baseHalfNoteStoreLink(destination);
			return link ? [link.route, link.folder, link.file] : undefined;
		}), [
			['../../', '7k3f9q2m1x', 'cat 2.jpg'],
			['', 'n', 'x.pdf'],
			['sub/', 'n', 'x.pdf'],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined
		]);
	});

	test('finds a note\'s links in their order: inline, reference definitions, and HTML, never in code', () => {
		const markdown = [
			'![a](../.bh/attachments/one/a.png) and [b](<../.bh/attachments/one/b c.pdf> "title")',
			'',
			'`![code](.bh/attachments/no/span.png)`',
			'',
			'```md',
			'![fence](.bh/attachments/no/fence.png)',
			'```',
			'',
			'~~~',
			'```',
			'![still](.bh/attachments/no/still.png)',
			'~~~',
			'',
			'<img src="../.bh/attachments/two/c.png" width="200"> <video src=\'d.mp4\'></video>',
			'',
			'[ref]: ../.bh/attachments/three/e.m4a',
		].join('\n');

		assert.deepStrictEqual({
			destinations: baseHalfNoteLinkDestinations(markdown),
			keys: baseHalfNoteStoreLinks(markdown).map(link => `${link.folder}/${link.file}`)
		}, {
			destinations: ['../.bh/attachments/one/a.png', '<../.bh/attachments/one/b c.pdf>', '../.bh/attachments/two/c.png', 'd.mp4', '../.bh/attachments/three/e.m4a'],
			keys: ['one/a.png', 'one/b c.pdf', 'two/c.png', 'three/e.m4a']
		});
	});
});

suite('BaseHalfNoteFiles', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a new folder is 10 characters of a-z and 0-9', () => {
		assert.deepStrictEqual([
			newBaseHalfNoteFolderName(() => new Uint8Array([0, 1, 25, 26, 35, 36, 61, 62, 71, 255])),
			FOLDER.test(newBaseHalfNoteFolderName()),
		], ['abz09az09d', true]);
	});

	test('cleans a name as the store keeps it', () => {
		assert.deepStrictEqual([
			'  course:notes?.pdf  ', 'CON.txt', '..', '', 'a\tb  c.md', '[draft] (v2).docx', '.git', '.GITATTRIBUTES', '.gitmodules', '.gitkeep', 'trailing. . ', 'é.png', `${'x'.repeat(200)}.pdf`
		].map(baseHalfNoteFileName), [
			'course-notes-.pdf', '_CON.txt', 'file', 'file', 'a-b c.md', '(draft) (v2).docx', '_.git', '_.GITATTRIBUTES', '_.gitmodules', '.gitkeep', 'trailing', 'é.png', `${'x'.repeat(156)}.pdf`
		]);
	});

	test('a picture copied without a name is named by the time, and a taken name gets a number', () => {
		const at = new Date(2026, 0, 2, 3, 4, 5);
		assert.deepStrictEqual({
			unnamed: [['image.png', 'image/png'], ['', 'image/webp'], ['Image.JPG', 'image/jpeg'], ['blob', 'image/gif'], ['photo.png', 'image/png'], ['image.png', 'application/octet-stream']].map(([name, type]) => isBaseHalfNoteUnnamedPicture(name, type)),
			names: [baseHalfNoteUntitledPictureName(at, 'image.png', 'image/png'), baseHalfNoteUntitledPictureName(at, 'x.heic', 'image/x-unknown'), baseHalfNoteUntitledPictureName(at, '', 'image/x-unknown')],
			numbered: [baseHalfNoteNumberedName('cat.jpg', 2), baseHalfNoteNumberedName('archive.tar.gz', 3), baseHalfNoteNumberedName('README', 2)],
			free: [baseHalfNoteFreeName('Cat.jpg', new Set(['cat.jpg', 'cat 2.jpg'])), baseHalfNoteFreeName('dog.jpg', new Set(['cat.jpg']))]
		}, {
			unnamed: [true, true, true, true, false, false],
			names: ['untitled 2026-01-02 03.04.05.png', 'untitled 2026-01-02 03.04.05.heic', 'untitled 2026-01-02 03.04.05.png'],
			numbered: ['cat 2.jpg', 'archive.tar 3.gz', 'README 2'],
			free: ['Cat 3.jpg', 'dog.jpg']
		});
	});
});

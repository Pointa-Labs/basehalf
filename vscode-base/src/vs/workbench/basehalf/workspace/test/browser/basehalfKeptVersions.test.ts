/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfFileTimesService } from '../../../../../platform/basehalfFiles/common/basehalfFileTimes.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { FileOperation, FileSystemProviderCapabilities, IFileDeleteOptions, IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { UndoRedoService } from '../../../../../platform/undoRedo/common/undoRedoService.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { WorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { TestContextService, TestLifecycleService } from '../../../../test/common/workbenchTestServices.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../../canvas/common/basehalfCanvasEditing.js';
import { BaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { baseHalfNoMovedItems } from '../../../references/test/browser/basehalfReferenceTestFixtures.js';
import { BaseHalfKeptVersionsService } from '../../browser/basehalfKeptVersions.js';
import { IBaseHalfMovedItemsService } from '../../common/basehalfMovedItemsService.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

const folder = URI.file('/work');

/** A disk with a Trash: what goes there is listed, and leaves the disk. */
class TrashingFileSystemProvider extends InMemoryFileSystemProvider {
	readonly trashed: string[] = [];

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.Trash;
	}

	override async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		if (opts.useTrash) {
			this.trashed.push(resource.path.slice(folder.path.length + 1));
		}
		return super.delete(resource, { ...opts, useTrash: false });
	}
}

/** A layout as BaseHalf writes it, with a row of the user's for each card. */
const layout = (path: string, cards: readonly { readonly path: string; readonly kind: 'file' | 'folder'; readonly x: number }[], edges: readonly (readonly [string, string])[] = []) => [
	`path: "${path}"`,
	...(cards.length ? ['cards:', ...cards.flatMap(card => [`  - path: "${card.path}"`, `    kind: ${card.kind}`, `    x: ${card.x}`, '    y: 20', '    width: 300', '    height: 220'])] : ['cards: []']),
	...(edges.length ? ['edges:', ...edges.flatMap(([from, to]) => [`  - from: "${from}"`, '    from_anchor: east', `    to: "${to}"`, '    to_anchor: west'])] : ['edges: []']),
	''
].join('\n');

suite('BaseHalfKeptVersions', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string | VSBuffer>, options: { readonly trash?: boolean } = {}) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		const provider = store.add(new TrashingFileSystemProvider());
		store.add(fileService.registerProvider(Schemas.file, provider));
		await fileService.createFolder(folder);
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(resource(path), typeof content === 'string' ? VSBuffer.fromString(content) : content);
		}
		const notifications: string[] = [];
		const notificationService = new class extends TestNotificationService {
			override info(message: string): ReturnType<TestNotificationService['info']> {
				notifications.push(message);
				return super.info(message);
			}
		};
		const deletes: string[] = [];
		const movedItems: IBaseHalfMovedItemsService = { ...baseHalfNoMovedItems, acceptWorkbenchDelete: (_workspaceFolder, path) => deletes.push(path) };
		const undoRedoService = new UndoRedoService(new TestDialogService(), notificationService);
		const lifecycleService = store.add(new TestLifecycleService());
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const mirror = store.add(new BaseHalfCanvasMirrorService(fileService, coordinator));
		// The files that were given the time of now, by path; the disk here has no times to set.
		const touched: string[] = [];
		const fileTimesService: IBaseHalfFileTimesService = {
			_serviceBrand: undefined,
			touch: async resources => {
				touched.push(...resources.map(resource => resource.path.slice(folder.path.length + 1)));
			}
		};
		const service = store.add(new BaseHalfKeptVersionsService(
			fileService,
			fileTimesService,
			new TestContextService(testWorkspace(folder)),
			store.add(new WorkingCopyService()),
			coordinator,
			mirror,
			movedItems,
			undoRedoService,
			notificationService,
			new TestConfigurationService({ files: { enableTrash: options.trash ?? true } }),
			lifecycleService,
			new NullLogService()
		));
		return {
			fileService,
			provider,
			service,
			notifications,
			deletes,
			touched,
			lifecycleService,
			undo: () => undoRedoService.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE),
			redo: () => undoRedoService.redo(BASEHALF_CANVAS_UNDO_REDO_SOURCE),
			files: () => tree(fileService),
			/** The workspace as the user and BaseHalf see it: the kept versions and BaseHalf's own ignore file left out. */
			shown: async () => Object.fromEntries(Object.entries(await tree(fileService)).filter(([path]) => !path.startsWith('.bh/cache/') && path !== '.bh/.gitignore')),
			/** The rows and anchor rows of the root canvas, in the order of their paths: the order of the file's lines is not shown anywhere. */
			rows: async () => {
				const canvas = await mirror.readCanvas({ resource: folder, workspaceFolder: folder, relativePath: '', source: 'api' });
				return { cards: [...canvas?.cards ?? []].sort((left, right) => left.path.localeCompare(right.path)), edges: canvas?.edges ?? [] };
			}
		};
	}

	const resource = (path: string) => joinPath(folder, ...path.split('/'));

	/** Every file of the workspace folder with its text, or its size when it is large. */
	async function tree(fileService: IFileService): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		const stack = [folder];
		while (stack.length) {
			const stat = await fileService.resolve(stack.pop()!).catch(() => undefined);
			for (const child of stat?.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					const value = (await fileService.readFile(child.resource)).value;
					out[child.resource.path.slice(folder.path.length + 1)] = value.byteLength > 1000 ? `${value.byteLength} bytes` : value.toString();
				}
			}
		}
		return out;
	}

	const workspace = {
		'keep.md': '# Keep\n\nA note with words of its own.\n',
		'big.bin': VSBuffer.alloc(6_000_000),
		'box/a.md': '# A\n',
		'box/b.md': '# B\n',
		'.bh/mirror/keep.md/badge.yaml': 'path: "keep.md"\nkind: file\ndescription: "A description"\n',
		'.bh/mirror/keep.md/appearance.yaml': 'background: cyan\n',
		'.bh/mirror/box/canvas.yaml': layout('box', [{ path: 'box/a.md', kind: 'file', x: 40 }, { path: 'box/b.md', kind: 'file', x: 380 }]),
		'.bh/mirror/canvas.yaml': layout('', [{ path: 'keep.md', kind: 'file', x: 40 }, { path: 'big.bin', kind: 'file', x: 380 }, { path: 'box', kind: 'folder', x: 720 }, { path: 'other.md', kind: 'file', x: 1060 }], [['keep.md', 'other.md']]),
		'other.md': '# Other\n'
	};

	test('deletes a note, a large file, and a folder with what it holds, and one undo brings each back whole, with its card information and its place', async () => {
		const harness = await open(workspace);
		const before = await harness.shown();
		const rowsBefore = await harness.rows();
		const shownApartFromRows = async () => Object.fromEntries(Object.entries(await harness.shown()).filter(([path]) => path !== '.bh/mirror/canvas.yaml'));
		const withoutRows = Object.fromEntries(Object.entries(before).filter(([path]) => path !== '.bh/mirror/canvas.yaml'));

		await harness.service.deleteItems([resource('keep.md'), resource('big.bin'), resource('box'), resource('box/a.md')], { label: 'Delete 3 items' });
		assert.deepStrictEqual(await harness.shown(), {
			'other.md': '# Other\n',
			'.bh/mirror/canvas.yaml': layout('', [{ path: 'other.md', kind: 'file', x: 1060 }])
		});
		// What is inside a deleted folder goes with it, and is no item of its own.
		assert.deepStrictEqual(harness.deletes, ['keep.md', 'big.bin', 'box']);

		await harness.undo();
		assert.deepStrictEqual({ shown: await shownApartFromRows(), rows: await harness.rows() }, { shown: withoutRows, rows: rowsBefore });
		await harness.redo();
		assert.deepStrictEqual(Object.keys(await harness.shown()).sort(), ['.bh/mirror/canvas.yaml', 'other.md']);
		await harness.undo();
		assert.deepStrictEqual({ shown: await shownApartFromRows(), rows: await harness.rows() }, { shown: withoutRows, rows: rowsBefore });
		// Nothing of the step is left in the kept versions but the window's mark.
		assert.deepStrictEqual(Object.keys(await harness.files()).filter(path => path.startsWith('.bh/cache/kept/')).map(path => path.replace(/kept\/[^/]+\//, 'kept/<window>/')), ['.bh/cache/kept/<window>/owner.json']);
	});

	test('undo of what the canvas made keeps it with what was put into it since, and redo brings it back at its place', async () => {
		const harness = await open({ '.bh/mirror/canvas.yaml': layout('', [{ path: 'untitled folder', kind: 'folder', x: 40 }]) });
		await harness.fileService.createFolder(resource('untitled folder'));
		harness.service.recordMade([resource('untitled folder')], { label: 'Create Folder untitled folder' });
		await harness.fileService.writeFile(resource('untitled folder/inside.md'), VSBuffer.fromString('# Inside\n'));
		const made = await harness.shown();

		await harness.undo();
		assert.deepStrictEqual(await harness.shown(), { '.bh/mirror/canvas.yaml': layout('', []) });
		await harness.redo();
		assert.deepStrictEqual(await harness.shown(), made);
	});

	test('does not replace an item that took the path of a deleted one, says why, and is done with', async () => {
		const harness = await open({ 'keep.md': '# Keep\n' });
		await harness.service.deleteItems([resource('keep.md')], { label: 'Delete keep.md' });
		await harness.fileService.writeFile(resource('keep.md'), VSBuffer.fromString('# A new note\n'));

		await harness.undo();
		assert.deepStrictEqual({ shown: await harness.shown(), notifications: harness.notifications }, {
			shown: { 'keep.md': '# A new note\n' },
			notifications: ['\'keep.md\' is there again. Undo did not replace it.']
		});
		await harness.redo();
		assert.deepStrictEqual(await harness.shown(), { 'keep.md': '# A new note\n' });
	});

	test('changes files in place as one step: undo puts the version before back, and redo the new one, each with the time of now', async () => {
		const harness = await open({ 'clip.mp4': 'the video', '.bh/mirror/clip.mp4/made.yaml': 'id: "a"\n' });
		await harness.fileService.writeFile(resource('.bh/cache/trim.mp4'), VSBuffer.fromString('the trimmed video'));

		await harness.service.replaceFiles([
			{ resource: resource('clip.mp4'), contents: resource('.bh/cache/trim.mp4') },
			{ resource: resource('.bh/mirror/clip.mp4/made.yaml'), contents: VSBuffer.fromString('id: "a"\ntrimmed: true\n') }
		], { label: 'Trim clip.mp4' });
		const changed = { 'clip.mp4': 'the trimmed video', '.bh/mirror/clip.mp4/made.yaml': 'id: "a"\ntrimmed: true\n' };
		assert.deepStrictEqual(await harness.shown(), changed);
		await harness.undo();
		assert.deepStrictEqual(await harness.shown(), { 'clip.mp4': 'the video', '.bh/mirror/clip.mp4/made.yaml': 'id: "a"\n' });
		await harness.redo();
		assert.deepStrictEqual(await harness.shown(), changed);
		// Each version that is moved into place is given the time of now, so that
		// the file watcher sees it; new bytes are written beside it and moved into place too.
		assert.deepStrictEqual(harness.touched, ['clip.mp4', '.bh/mirror/clip.mp4/made.yaml', 'clip.mp4', '.bh/mirror/clip.mp4/made.yaml', 'clip.mp4', '.bh/mirror/clip.mp4/made.yaml']);
	});

	test('tells the window a delete, a creation, or a write for each item of a step, and never a move into or out of the kept versions', async () => {
		const harness = await open({
			'keep.md': '# Keep\n',
			'box/a.md': '# A\n',
			'clip.mp4': 'the video',
			'.bh/mirror/keep.md/badge.yaml': 'path: "keep.md"\nkind: file\ndescription: "A description"\n'
		});
		await harness.fileService.writeFile(resource('.bh/cache/trim.mp4'), VSBuffer.fromString('the trimmed video'));
		const names = new Map([[FileOperation.CREATE, 'create'], [FileOperation.DELETE, 'delete'], [FileOperation.MOVE, 'move'], [FileOperation.COPY, 'copy'], [FileOperation.WRITE, 'write']]);
		const pathOf = (uri: URI) => uri.path.slice(folder.path.length + 1);
		const items = new Set(['keep.md', 'box', 'clip.mp4', '.bh/mirror/keep.md']);
		let told: string[] = [];
		const moves: string[] = [];
		disposables.add(harness.fileService.onDidRunOperation(e => {
			const paths = [pathOf(e.resource), ...(e.target ? [pathOf(e.target.resource)] : [])];
			if (e.operation === FileOperation.MOVE || e.operation === FileOperation.COPY) {
				moves.push(paths.join(' -> '));
			}
			if (items.has(paths[0])) {
				told.push(`${names.get(e.operation)} ${paths[0]}`);
			}
		}));
		const during = async (act: () => unknown) => {
			told = [];
			await act();
			return [...told].sort();
		};

		assert.deepStrictEqual({
			deleted: await during(() => harness.service.deleteItems([resource('keep.md'), resource('box')], { label: 'Delete 2 items' })),
			undone: await during(() => harness.undo()),
			redone: await during(() => harness.redo()),
			trimmed: await during(() => harness.service.replaceFiles([{ resource: resource('clip.mp4'), contents: resource('.bh/cache/trim.mp4') }], { label: 'Trim clip.mp4' })),
			trimUndone: await during(() => harness.undo()),
			trimRedone: await during(() => harness.redo()),
			moves
		}, {
			deleted: ['delete .bh/mirror/keep.md', 'delete box', 'delete keep.md'],
			undone: ['create .bh/mirror/keep.md', 'create box', 'create keep.md'],
			redone: ['delete .bh/mirror/keep.md', 'delete box', 'delete keep.md'],
			trimmed: ['write clip.mp4'],
			trimUndone: ['write clip.mp4'],
			trimRedone: ['write clip.mp4'],
			moves: []
		});
	});

	test('sends what it kept to the Trash from where each item was when the window closes, and leaves the card information that a delete to the Trash keeps', async () => {
		const harness = await open({
			'shot.mp4': 'the video',
			'.bh/mirror/shot.mp4/badge.yaml': 'path: "shot.mp4"\nkind: file\ndescription: "Shot"\n',
			'.bh/mirror/shot.mp4/upstream.yaml': 'upstream:\n  - brief.md\n',
			'.bh/mirror/shot.mp4/generation.yaml': 'prompt: "a shot"\n',
			'.bh/mirror/shot.mp4/made.yaml': 'id: "a"\n',
			'note.md': '# Note\n',
			'.bh/mirror/note.md/generation.yaml': 'prompt: "uploaded"\n'
		});
		await harness.service.deleteItems([resource('shot.mp4'), resource('note.md')], { label: 'Delete 2 items' });

		harness.lifecycleService.fireShutdown();
		await Promise.all(harness.lifecycleService.shutdownJoiners);
		// The Trash keeps the place an item had when it went in, which Put Back returns it to.
		assert.deepStrictEqual({ trashed: [...harness.provider.trashed].sort(), files: await harness.shown() }, {
			trashed: ['note.md', 'shot.mp4'],
			// A generation.yaml without a made.yaml would be a draft: it goes.
			files: {
				'.bh/mirror/shot.mp4/upstream.yaml': 'upstream:\n  - brief.md\n',
				'.bh/mirror/shot.mp4/generation.yaml': 'prompt: "a shot"\n',
				'.bh/mirror/shot.mp4/made.yaml': 'id: "a"\n'
			}
		});
	});

	test('sends to the Trash what a window kept whose mark nobody renewed for five minutes, and leaves a window that renews it', async () => {
		const harness = await open({
			'.bh/cache/kept/gone/owner.json': JSON.stringify({ renewed: Date.now() - 6 * 60_000 }),
			'.bh/cache/kept/gone/one/place.json': JSON.stringify({ path: 'old.md' }),
			'.bh/cache/kept/gone/one/item/old.md': '# Old\n',
			'.bh/cache/kept/open/owner.json': JSON.stringify({ renewed: Date.now() - 60_000 }),
			'.bh/cache/kept/open/one/place.json': JSON.stringify({ path: 'open.md' }),
			'.bh/cache/kept/open/one/item/open.md': '# Open\n'
		});

		await harness.service.sweep();
		assert.deepStrictEqual({ trashed: harness.provider.trashed, kept: Object.keys(await harness.files()).filter(path => path.startsWith('.bh/cache/kept/')).sort() }, {
			trashed: ['old.md'],
			kept: ['.bh/cache/kept/open/one/item/open.md', '.bh/cache/kept/open/one/place.json', '.bh/cache/kept/open/owner.json']
		});
	});

	test('sends an item to the Trash from the kept versions when another item took its path or its folder is gone', async () => {
		const harness = await open({ 'keep.md': '# Keep\n', 'box/a.md': '# A\n', 'box/b.md': '# B\n' });
		await harness.service.deleteItems([resource('keep.md'), resource('box/a.md')], { label: 'Delete 2 items' });
		await harness.fileService.writeFile(resource('keep.md'), VSBuffer.fromString('# A new note\n'));
		await harness.fileService.del(resource('box'), { recursive: true });

		harness.lifecycleService.fireShutdown();
		await Promise.all(harness.lifecycleService.shutdownJoiners);
		assert.deepStrictEqual({ trashed: harness.provider.trashed.map(path => path.replace(/kept\/[^/]+\/[^/]+\//, 'kept/<keep>/')).sort(), files: await harness.shown() }, {
			trashed: ['.bh/cache/kept/<keep>/item/a.md', '.bh/cache/kept/<keep>/item/keep.md'],
			files: { 'keep.md': '# A new note\n' }
		});
	});

	test('deletes for good what it kept when the Trash is off', async () => {
		const harness = await open({ 'keep.md': '# Keep\n', '.bh/mirror/keep.md/upstream.yaml': 'upstream:\n  - a.md\n' }, { trash: false });
		await harness.service.deleteItems([resource('keep.md')], { label: 'Delete keep.md' });

		harness.lifecycleService.fireShutdown();
		await Promise.all(harness.lifecycleService.shutdownJoiners);
		assert.deepStrictEqual({ trashed: harness.provider.trashed, files: Object.keys(await harness.files()) }, { trashed: [], files: ['.bh/.gitignore'] });
	});
});

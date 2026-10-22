/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { createFileSystemProviderError, FileSystemProviderCapabilities, FileSystemProviderErrorCode, IFileService, IFileWriteOptions, IStat } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { BaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { BaseHalfBadgeMirrorService } from '../../../references/common/basehalfBadgeMirror.js';
import { baseHalfNoMovedItems } from '../../../references/test/browser/basehalfReferenceTestFixtures.js';
import { createBaseHalfGenerationTask, failBaseHalfGenerationCard, stopBaseHalfGenerationTask } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfDraftSnapshot } from '../../../video/common/basehalfVideoGeneration.js';
import { BaseHalfDraftOperationError, BaseHalfDraftOperations } from '../../browser/basehalfDraftOperations.js';
import { IBaseHalfMovedItemsService } from '../../common/basehalfMovedItemsService.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';
import { BaseHalfRecordingGenerationTaskStore } from './basehalfGenerationTaskStoreFake.js';

const folder = URI.file('/work');

/** Whole-file writes, and a file system that refuses the writes a test names. */
class RefusingFileSystemProvider extends InMemoryFileSystemProvider {
	/** When set, a write of a file it accepts is refused by the file system. */
	refuseWrite: ((resource: URI) => boolean) | undefined;

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities & ~FileSystemProviderCapabilities.FileOpenReadWriteClose;
	}

	override async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		this.refuse(resource);
		return super.writeFile(resource, content, opts);
	}

	override async writeFileExclusiveAtomic(resource: URI, content: Uint8Array): Promise<IStat> {
		this.refuse(resource);
		return super.writeFileExclusiveAtomic(resource, content);
	}

	private refuse(resource: URI): void {
		if (this.refuseWrite?.(resource)) {
			throw createFileSystemProviderError('The file system refused the write.', FileSystemProviderErrorCode.NoPermissions);
		}
	}
}
const badge = (path: string, description: string) => `path: "${path}"\nkind: file\ndescription: "${description}"\n`;
const row = (path: string, x: number, width = 720, height = 405) => [`  - path: "${path}"`, '    kind: file', `    x: ${x}`, '    y: 20', `    width: ${width}`, `    height: ${height}`];
/** A layout file as BaseHalf writes it. */
const canvas = (path: string, cards: string[][], edges: string[] = []) => [`path: "${path}"`, ...(cards.length ? ['cards:', ...cards.flat()] : ['cards: []']), ...(edges.length ? ['edges:', ...edges] : ['edges: []']), ''].join('\n');
const edge = (from: string, to: string) => [`  - from: "${from}"`, '    from_anchor: east', `    to: "${to}"`, '    to_anchor: west'].join('\n');

suite('BaseHalfDraftOperations', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string>) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		const provider = store.add(new RefusingFileSystemProvider());
		store.add(fileService.registerProvider(Schemas.file, provider));
		await fileService.createFolder(folder);
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
		}
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const taskStore = new BaseHalfRecordingGenerationTaskStore(folder);
		const draftMoves: string[] = [];
		const movedItems: IBaseHalfMovedItemsService = { ...baseHalfNoMovedItems, acceptDraftMove: (_workspaceFolder, from, to) => draftMoves.push(`${from} -> ${to}`) };
		const operations = new BaseHalfDraftOperations(
			fileService,
			new TestContextService(testWorkspace(folder)),
			coordinator,
			store.add(new BaseHalfCanvasMirrorService(fileService, coordinator)),
			store.add(new BaseHalfBadgeMirrorService(fileService)),
			taskStore,
			movedItems,
			new NullLogService()
		);
		return {
			fileService,
			provider,
			operations,
			taskStore,
			draftMoves,
			retargets: () => taskStore.retargets.map(({ from, to }) => `${getRelativePath(folder, from)} -> ${getRelativePath(folder, to)}`),
			files: () => tree(fileService)
		};
	}

	/** What changed between two trees of files, BaseHalf's own ignore file left out: the paths that are new, changed, or gone. */
	function changes(before: Record<string, string>, after: Record<string, string>): string[] {
		return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => path !== '.bh/.gitignore' && before[path] !== after[path]).sort();
	}

	const resource = (path: string) => joinPath(folder, ...path.split('/'));

	/** Every file of the workspace folder with its text, `.bh/` included. */
	async function tree(fileService: IFileService): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		const stack = [folder];
		while (stack.length) {
			let stat;
			try {
				stat = await fileService.resolve(stack.pop()!);
			} catch {
				continue;
			}
			for (const child of stat.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					out[getRelativePath(folder, child.resource)!] = (await fileService.readFile(child.resource)).value.toString();
				}
			}
		}
		return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : 1));
	}

	async function refusal(promise: Promise<unknown>): Promise<string> {
		try {
			await promise;
		} catch (error) {
			if (error instanceof BaseHalfDraftOperationError) {
				return error.message;
			}
			throw error;
		}
		assert.fail('Expected a refusal');
	}

	const draft = {
		'shots/notes.md': '# Notes\n',
		'takes/readme.md': '# Takes\n',
		'.bh/mirror/shots/next.mp4/generation.yaml': 'prompt: "A harbor at dawn"\n',
		'.bh/mirror/shots/next.mp4/upstream.yaml': 'upstream:\n  - shots/notes.md\n',
		'.bh/mirror/shots/next.mp4/badge.yaml': badge('shots/next.mp4', 'The opening shot.'),
		'.bh/mirror/shots/canvas.yaml': canvas('shots', [row('shots/notes.md', 1, 260, 140), row('shots/next.mp4', 400)], [edge('shots/notes.md', 'shots/next.mp4')]),
		'.bh/mirror/takes/canvas.yaml': canvas('takes', [row('takes/readme.md', 1, 260, 140)])
	};

	test('a rename and a move take every file of the draft\'s card information, its card row, and its task records along', async () => {
		const window = await open({
			...draft,
			// What a file that is gone left under the new name, with no record of a generation: it gives way.
			'.bh/mirror/shots/old.mp4/upstream.yaml': 'upstream:\n  - takes/readme.md\n',
			'.bh/mirror/shots/old.mp4/appearance.yaml': 'color: "red"\n'
		});
		await window.operations.move(resource('shots/next.mp4'), resource('shots/old.mp4'));
		const renamed = await window.files();
		await window.operations.move(resource('shots/old.mp4'), resource('takes/clip.mp4'));
		const moved = await window.files();

		assert.deepStrictEqual({
			renamed: Object.fromEntries(Object.entries(renamed).filter(([path]) => path.startsWith('.bh/mirror/shots/'))),
			moved: Object.fromEntries(Object.entries(moved).filter(([path]) => path.startsWith('.bh/mirror/'))),
			retargets: window.retargets(),
			draftMoves: window.draftMoves
		}, {
			renamed: {
				'.bh/mirror/shots/canvas.yaml': canvas('shots', [row('shots/notes.md', 1, 260, 140), row('shots/old.mp4', 400)], [edge('shots/notes.md', 'shots/old.mp4')]),
				'.bh/mirror/shots/old.mp4/badge.yaml': badge('shots/old.mp4', 'The opening shot.'),
				'.bh/mirror/shots/old.mp4/generation.yaml': 'prompt: "A harbor at dawn"\n',
				'.bh/mirror/shots/old.mp4/upstream.yaml': 'upstream:\n  - shots/notes.md\n'
			},
			moved: {
				// The row leaves its folder and goes to the end of the other canvas, with its size.
				'.bh/mirror/shots/canvas.yaml': canvas('shots', [row('shots/notes.md', 1, 260, 140)]),
				'.bh/mirror/takes/canvas.yaml': canvas('takes', [row('takes/readme.md', 1, 260, 140), [...row('takes/clip.mp4', 341), '    auto: true']]),
				'.bh/mirror/takes/clip.mp4/badge.yaml': badge('takes/clip.mp4', 'The opening shot.'),
				'.bh/mirror/takes/clip.mp4/generation.yaml': 'prompt: "A harbor at dawn"\n',
				'.bh/mirror/takes/clip.mp4/upstream.yaml': 'upstream:\n  - shots/notes.md\n'
			},
			retargets: ['shots/next.mp4 -> shots/old.mp4', 'shots/old.mp4 -> takes/clip.mp4'],
			draftMoves: ['shots/next.mp4 -> shots/old.mp4', 'shots/old.mp4 -> takes/clip.mp4']
		});
	});

	test('a move is refused, and changes nothing, for what is not a draft and for a name that is taken by a file, a folder, a draft, or a generated file in the trash, of another kind, or in a folder that does not exist', async () => {
		const window = await open({
			...draft,
			'shots/taken.mp4': 'video',
			'shots/folder.mp4/inner.md': '# Inner\n',
			'.bh/mirror/shots/other.mp4/generation.yaml': 'prompt: ""\n',
			// A generated file that is in the trash or missing: its record stays for when it comes back.
			'.bh/mirror/shots/gone.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/gone.mp4/made.yaml': 'id: "t1"\n',
			'.bh/mirror/shots/record.mp4/made.yaml': 'id: "t2"\n'
		});
		const before = await window.files();
		const reasons = [
			await refusal(window.operations.move(resource('shots/notes.md'), resource('shots/free.mp4'))),
			// A generated file that is gone is a missing file, not a draft.
			await refusal(window.operations.move(resource('shots/gone.mp4'), resource('shots/free.mp4'))),
			await refusal(window.operations.move(resource('shots/next.mp4'), resource('shots/taken.mp4'))),
			await refusal(window.operations.move(resource('shots/next.mp4'), resource('shots/folder.mp4'))),
			await refusal(window.operations.move(resource('shots/next.mp4'), resource('shots/other.mp4'))),
			await refusal(window.operations.move(resource('shots/next.mp4'), resource('shots/gone.mp4'))),
			await refusal(window.operations.move(resource('shots/next.mp4'), resource('shots/record.mp4'))),
			await refusal(window.operations.move(resource('shots/next.mp4'), resource('shots/next.png'))),
			await refusal(window.operations.move(resource('shots/next.mp4'), resource('nowhere/next.mp4')))
		];
		assert.deepStrictEqual({ reasons, unchanged: JSON.stringify(await window.files()) === JSON.stringify(before), retargets: window.retargets() }, {
			reasons: [
				'notes.md is not a draft any more.',
				'gone.mp4 is not a draft any more.',
				'taken.mp4 is already taken.',
				'folder.mp4 is already taken.',
				'other.mp4 is already taken.',
				'gone.mp4 is already taken.',
				'record.mp4 is already taken.',
				'A video card needs a name that ends in .mp4, .mov, .m4v, or .webm.',
				'The folder nowhere does not exist.'
			],
			unchanged: true,
			retargets: []
		});
	});

	test('the path the task records name holds the draft\'s generation.yaml at every step: a move whose records cannot take the new path leaves the draft whole where it was', async () => {
		const window = await open(draft);
		const before = await window.files();
		const information = async () => Object.keys(await window.files()).filter(path => path.endsWith('/generation.yaml'));
		// The records cannot take the new path once; moving them back works.
		let atRetarget: string[] | undefined;
		window.taskStore.onRetarget = async () => {
			if (!atRetarget) {
				atRetarget = await information();
				throw new Error('The record of the generation kept changing while BaseHalf wrote it.');
			}
		};
		const failure = await window.operations.move(resource('shots/next.mp4'), resource('shots/later.mp4')).then(() => 'moved', (error: Error) => error.message);
		const afterFailure = changes(before, await window.files());
		const movedBack = window.retargets();

		// The records cannot be moved back either: the draft's card information stays at both paths.
		window.taskStore.onRetarget = undefined;
		window.taskStore.failure = new Error('The disk is full.');
		const second = await window.operations.move(resource('shots/next.mp4'), resource('shots/later.mp4')).then(() => 'moved', (error: Error) => error.message);
		const bothPaths = await information();

		assert.deepStrictEqual({ failure, atRetarget, afterFailure, movedBack, second, bothPaths, draftMoves: window.draftMoves }, {
			failure: 'The record of the generation kept changing while BaseHalf wrote it.',
			// When the records were asked to take the new path, both paths held the draft's generation.yaml.
			atRetarget: ['.bh/mirror/shots/later.mp4/generation.yaml', '.bh/mirror/shots/next.mp4/generation.yaml'],
			// What was written at the new path was taken back, the card row too.
			afterFailure: [],
			movedBack: ['shots/later.mp4 -> shots/next.mp4'],
			second: 'The disk is full.',
			bothPaths: ['.bh/mirror/shots/later.mp4/generation.yaml', '.bh/mirror/shots/next.mp4/generation.yaml'],
			draftMoves: []
		});
	});

	test('a move that cannot write a file at the new path takes back what it wrote, and the draft and its records stay where they were', async () => {
		const window = await open(draft);
		const before = await window.files();
		window.provider.refuseWrite = written => written.path.startsWith('/work/.bh/mirror/shots/later.mp4/upstream.yaml');
		const failure = await window.operations.move(resource('shots/next.mp4'), resource('shots/later.mp4')).then(() => 'moved', () => 'refused');
		assert.deepStrictEqual({ failure, changed: changes(before, await window.files()), retargets: window.retargets(), draftMoves: window.draftMoves }, {
			failure: 'refused',
			changed: [],
			retargets: [],
			draftMoves: []
		});
	});

	test('a draft that generates is not deleted; once its card is released, it is', async () => {
		const window = await open({
			...draft,
			'.bh/mirror/shots/still.png/generation.yaml': 'prompt: "Two stills"\n',
			'.bh/mirror/shots/still-2.png/generation.yaml': 'prompt: "Two stills"\n'
		});
		const video = createBaseHalfGenerationTask({ id: '20261022T080000-1a2b3c4d', kind: 'video', cards: ['shots/next.mp4'], follower: 'window-1', now: '2026-10-22T08:00:00.000Z' });
		const stills = createBaseHalfGenerationTask({ id: '20261022T080100-5e6f7a8b', kind: 'image', cards: ['shots/still.png', 'shots/still-2.png'], follower: 'window-1', now: '2026-10-22T08:01:00.000Z' });
		window.taskStore.records.push(video, stills);
		const before = await window.files();
		const generating = [
			await refusal(window.operations.delete(resource('shots/next.mp4'))),
			await refusal(window.operations.delete(resource('shots/still.png')))
		];
		const unchanged = changes(before, await window.files());

		// Releasing a card stops a generation of one card, and gives up one card of several.
		window.taskStore.records[0] = stopBaseHalfGenerationTask(video, '2026-10-22T08:02:00.000Z');
		window.taskStore.records[1] = failBaseHalfGenerationCard(stills, 0, 'The card was deleted.');
		await window.operations.delete(resource('shots/next.mp4'));
		await window.operations.delete(resource('shots/still.png'));
		const stillGenerating = await refusal(window.operations.delete(resource('shots/still-2.png')));

		assert.deepStrictEqual({ generating, unchanged, stillGenerating, left: Object.keys(await window.files()).filter(path => path.endsWith('/generation.yaml')) }, {
			generating: ['This card is generating. Stop it first.', 'This card is generating. Stop it first.'],
			unchanged: [],
			stillGenerating: 'This card is generating. Stop it first.',
			left: ['.bh/mirror/shots/still-2.png/generation.yaml']
		});
	});

	test('a delete removes the draft\'s card information and card row and answers all of it; a restore writes it back where the path is free', async () => {
		const window = await open(draft);
		const before = await window.files();
		const snapshot = await window.operations.delete(resource('shots/next.mp4'));
		const deleted = await window.files();
		await window.operations.restore(snapshot);
		const restored = await window.files();

		// A file that took the path in between keeps it: the restore writes nothing.
		const again = await window.operations.delete(resource('shots/next.mp4'));
		await window.fileService.writeFile(resource('shots/next.mp4'), VSBuffer.fromString('video'));
		const taken = await refusal(window.operations.restore(again));
		const describe = (value: IBaseHalfDraftSnapshot) => ({ files: [...value.files.keys()].sort(), row: value.row?.x, edges: value.edges?.map(one => `${one.from} -> ${one.to}`) });

		assert.deepStrictEqual({
			snapshot: describe(snapshot),
			deleted: Object.keys(deleted).filter(path => path.startsWith('.bh/mirror/shots/')),
			layoutWithout: deleted['.bh/mirror/shots/canvas.yaml'],
			// Everything is back as it was; the first write of a layout also wrote BaseHalf's own ignore file.
			restored: Object.entries(restored).filter(([path, text]) => path !== '.bh/.gitignore' && before[path] !== text),
			taken,
			leftAlone: Object.keys(await window.files()).filter(path => path.startsWith('.bh/mirror/shots/next.mp4/'))
		}, {
			snapshot: { files: ['badge.yaml', 'generation.yaml', 'upstream.yaml'], row: 400, edges: ['shots/notes.md -> shots/next.mp4'] },
			deleted: ['.bh/mirror/shots/canvas.yaml'],
			layoutWithout: canvas('shots', [row('shots/notes.md', 1, 260, 140)]),
			restored: [],
			taken: 'next.mp4 can\'t come back: something else is there now.',
			leftAlone: []
		});
	});
});

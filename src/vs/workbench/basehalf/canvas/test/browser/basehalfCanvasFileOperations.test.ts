/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { clearExplorerFileClipboardCut, findValidPasteFileTargetForResource, setExplorerFileClipboard } from '../../../../contrib/files/browser/fileActions.js';
import '../../../../contrib/files/browser/fileCommands.js';
import { NEW_FILE_COMMAND_ID, NEW_UNTITLED_FILE_COMMAND_ID } from '../../../../contrib/files/browser/fileConstants.js';
import { IExplorerService } from '../../../../contrib/files/browser/files.js';
import { baseHalfCanvasDraftNameProblem, baseHalfCanvasFreeTransferTarget, baseHalfCanvasGenerationCopyTarget } from '../../browser/view/basehalfCanvasViewShared.js';

suite('BaseHalfCanvasFileOperations', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('copies resources without requiring a materialized Explorer item', async () => {
		const writes: { readonly resources: readonly URI[]; readonly cut: boolean }[] = [];
		const explorerService = {
			roots: [],
			findClosest: () => { throw new Error('clipboard must not resolve the Explorer tree'); },
			setResourcesToCopy: async (resources: readonly URI[], cut: boolean) => { writes.push({ resources, cut }); }
		} as unknown as IExplorerService;
		const resource = URI.file('/workspace/collapsed/note.md');

		assert.strictEqual(await setExplorerFileClipboard(explorerService, [resource], true), true);
		assert.deepStrictEqual(writes, [{ resources: [resource], cut: true }]);
		await clearExplorerFileClipboardCut(explorerService);
		assert.deepStrictEqual(writes[1], { resources: [], cut: false });
	});

	test('resolves import collisions from disk instead of Explorer tree state', async () => {
		const targetFolder = URI.file('/workspace/collapsed');
		const existing = new Set([URI.file('/workspace/collapsed/report.md').toString()]);
		const fileService = {
			exists: async (resource: URI) => existing.has(resource.toString())
		} as unknown as IFileService;

		const target = await findValidPasteFileTargetForResource(
			fileService,
			{} as IDialogService,
			targetFolder,
			{ resource: URI.file('/outside/report.md'), isDirectory: false, allowOverwrite: false },
			'simple'
		);

		assert.strictEqual(target?.fsPath, '/workspace/collapsed/report copy.md');
	});

	test('a pasted, dropped, imported, or duplicated item never takes the name of a draft, nor one another copy took', async () => {
		const targetFolder = URI.file('/workspace/shots');
		const existing = new Set(['/workspace/shots/shot.mp4', '/workspace/shots/shot copy 2.mp4']);
		const drafts = new Set(['/workspace/shots/shot copy.mp4', '/workspace/shots/image.png']);
		const fileService = { exists: async (resource: URI) => existing.has(resource.path) } as unknown as IFileService;
		const isTaken = async (candidate: URI) => drafts.has(candidate.path);
		const free = (source: string, naming: 'simple' | 'smart' | 'disabled' = 'simple') => baseHalfCanvasFreeTransferTarget(fileService, {} as IDialogService, targetFolder, URI.file(source), false, false, naming, isTaken);
		assert.deepStrictEqual([
			// shot.mp4 is a file, shot copy.mp4 a draft, shot copy 2.mp4 a file.
			(await free('/elsewhere/shot.mp4'))?.path,
			(await free('/elsewhere/image.png'))?.path,
			(await free('/elsewhere/other.png'))?.path
		], [
			'/workspace/shots/shot copy 3.mp4',
			'/workspace/shots/image copy.png',
			'/workspace/shots/other.png'
		]);
	});

	test('a copy of a generation card keeps its name where that is free, and takes the next free number after its own otherwise, never one another copy took', async () => {
		const taken = new Set(['shot.mp4', 'shot-2.mp4', 'shot-4.mp4']);
		const nextFreeName = async (base: string, extension: string, startOrdinal: number) => {
			for (let ordinal = startOrdinal; ; ordinal++) {
				const name = ordinal <= 1 ? `${base}.${extension}` : `${base}-${ordinal}.${extension}`;
				if (!taken.has(name)) {
					return name;
				}
			}
		};
		const reserved = new Set(['/workspace/shots/shot-3.mp4']);
		const target = async (name: string) => (await baseHalfCanvasGenerationCopyTarget(URI.file('/workspace/shots'), name, nextFreeName, candidate => reserved.has(candidate.path))).path;
		assert.deepStrictEqual([await target('shot-2.mp4'), await target('shot.mp4'), await target('image.png'), await target('shot-7.mp4')], [
			// 2 is taken, 3 is another copy's, 4 is taken.
			'/workspace/shots/shot-5.mp4',
			'/workspace/shots/shot-5.mp4',
			'/workspace/shots/image.png',
			'/workspace/shots/shot-7.mp4'
		]);
	});

	test('a draft keeps a name of its kind', () => {
		assert.deepStrictEqual([
			baseHalfCanvasDraftNameProblem('shot.mp4', 'video'),
			baseHalfCanvasDraftNameProblem('SHOT.MOV', 'video'),
			baseHalfCanvasDraftNameProblem('shot.png', 'video'),
			baseHalfCanvasDraftNameProblem('frame.webp', 'image'),
			baseHalfCanvasDraftNameProblem('frame', 'image')
		], [
			undefined,
			undefined,
			'A video card needs a name that ends in .mp4, .mov, .m4v, or .webm.',
			undefined,
			'An image card needs a name that ends in .png, .jpg, .jpeg, .webp, .gif, .avif, or .bmp.'
		]);
	});

	test('keeps the native untitled-file command contract and arguments', async () => {
		const calls: { readonly id: string; readonly args: unknown }[] = [];
		const commandService = {
			executeCommand: async (id: string, args: unknown) => { calls.push({ id, args }); }
		};
		const accessor = {
			get: (id: unknown) => {
				if (id === ICommandService) {
					return commandService;
				}
				throw new Error(`Unexpected service: ${String(id)}`);
			}
		} as ServicesAccessor;
		const args = { languageId: 'typescript', viewType: 'workbench.editors.textEditor' };

		await CommandsRegistry.getCommand(NEW_UNTITLED_FILE_COMMAND_ID)?.handler(accessor, args);

		assert.deepStrictEqual(calls, [{ id: NEW_FILE_COMMAND_ID, args }]);
	});
});

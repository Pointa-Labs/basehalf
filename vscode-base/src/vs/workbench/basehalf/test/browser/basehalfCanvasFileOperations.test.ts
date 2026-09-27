/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { clearExplorerFileClipboardCut, findValidPasteFileTargetForResource, setExplorerFileClipboard } from '../../../contrib/files/browser/fileActions.js';
import '../../../contrib/files/browser/fileCommands.js';
import { NEW_FILE_COMMAND_ID, NEW_UNTITLED_FILE_COMMAND_ID } from '../../../contrib/files/browser/fileConstants.js';
import { IExplorerService } from '../../../contrib/files/browser/files.js';

suite('BaseHalfCanvasFileOperations', () => {
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

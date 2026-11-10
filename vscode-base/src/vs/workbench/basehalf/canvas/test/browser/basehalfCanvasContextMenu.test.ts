/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, isISubmenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import {
	BASEHALF_CANVAS_CARD_CONTEXT_MENU,
	BASEHALF_CANVAS_NEW_AUDIO_COMMAND_ID,
	BASEHALF_CANVAS_NEW_IMAGE_COMMAND_ID,
	BASEHALF_CANVAS_NEW_VIDEO_COMMAND_ID,
	BASEHALF_CANVAS_PANE_CONTEXT_MENU
} from '../../browser/basehalfCanvasContextMenu.js';
import { BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID, IBaseHalfCanvasEditingService } from '../../common/basehalfCanvasEditing.js';

suite('BaseHalf canvas context menu', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('registers card commands without Explorer selection commands', () => {
		assert.deepStrictEqual(menuCommands(BASEHALF_CANVAS_CARD_CONTEXT_MENU), [
			['5_cutcopypaste', 'basehalf.canvas.copy'],
			['6_copypath', 'basehalf.canvas.copyPath'],
			['6_copypath', 'basehalf.canvas.copyRelativePath'],
			['5_cutcopypaste', 'basehalf.canvas.cut'],
			['7_modification', 'basehalf.canvas.moveResourceToTrash'],
			['navigation', 'basehalf.canvas.openResource'],
			['7_modification', 'basehalf.canvas.renameResource'],
			['2_files', 'basehalf.canvas.revealInFiles']
		]);
	});

	test('registers pane creation commands: New Note, New Image, New Video, New Audio, New Folder, no New File, and no submenu of empty nodes', () => {
		assert.deepStrictEqual(menuCommands(BASEHALF_CANVAS_PANE_CONTEXT_MENU), [
			['5_transfer', 'basehalf.canvas.importFiles'],
			['1_new', 'basehalf.canvas.newAudio'],
			['1_new', 'basehalf.canvas.newFolder'],
			['1_new', 'basehalf.canvas.newImage'],
			['1_new', 'basehalf.canvas.newNote'],
			['1_new', 'basehalf.canvas.newVideo'],
			['5_transfer', 'basehalf.canvas.paste']
		]);
		assert.deepStrictEqual(MenuRegistry.getMenuItems(BASEHALF_CANVAS_PANE_CONTEXT_MENU).filter(isISubmenuItem), []);
		// The canvas makes no file from a typed name (canvas Create menu).
		assert.strictEqual(CommandsRegistry.getCommand('basehalf.canvas.newFile'), undefined);
		// New Image, New Video, and New Audio follow New Note (D78), and New Folder, which asks for nothing, has no ellipsis.
		assert.deepStrictEqual(MenuRegistry.getMenuItems(BASEHALF_CANVAS_PANE_CONTEXT_MENU)
			.filter(isIMenuItem)
			.filter(item => item.group === '1_new')
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
			.map(item => [item.command.id, typeof item.command.title === 'string' ? item.command.title : item.command.title.value]), [
			['basehalf.canvas.newNote', 'New Note'],
			['basehalf.canvas.newImage', 'New Image'],
			['basehalf.canvas.newVideo', 'New Video'],
			['basehalf.canvas.newAudio', 'New Audio'],
			['basehalf.canvas.newFolder', 'New Folder']
		]);
	});

	test('keeps canvas card creation out of the command palette and dispatches drafts of images, videos, and sounds', async () => {
		const resultCommands = [
			[BASEHALF_CANVAS_NEW_IMAGE_COMMAND_ID, 'image'],
			[BASEHALF_CANVAS_NEW_VIDEO_COMMAND_ID, 'video'],
			[BASEHALF_CANVAS_NEW_AUDIO_COMMAND_ID, 'audio']
		] as const;
		const commandPaletteIds = new Set(MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.map(item => item.command.id));
		for (const commandId of [
			BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID,
			'basehalf.canvas.newFolder',
			...resultCommands.map(([commandId]) => commandId)
		]) {
			assert.strictEqual(commandPaletteIds.has(commandId), false);
		}

		const requests: unknown[][] = [];
		const accessor = {
			get: <T>(service: unknown): T => {
				if (service === IBaseHalfCanvasEditingService) {
					return {
						requestCreate: async (...args: unknown[]) => { requests.push(args); }
					} as T;
				}
				throw new Error('Unexpected service');
			}
		} as ServicesAccessor;
		for (const [commandId] of resultCommands) {
			const command = CommandsRegistry.getCommand(commandId);
			assert.ok(command);
			await command.handler(accessor);
		}
		assert.deepStrictEqual(requests, resultCommands.map(([, kind]) => [undefined, kind]));
	});
});

function menuCommands(menuId: MenuId): [string | undefined, string][] {
	return MenuRegistry.getMenuItems(menuId)
		.filter(isIMenuItem)
		.map(item => [item.group, item.command.id] as [string | undefined, string])
		.sort((left, right) => left[1].localeCompare(right[1]));
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import {
	BASEHALF_CANVAS_CARD_CONTEXT_MENU,
	BASEHALF_CANVAS_PANE_CONTEXT_MENU
} from '../../browser/basehalfCanvasContextMenu.js';

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

	test('registers pane creation commands', () => {
		assert.deepStrictEqual(menuCommands(BASEHALF_CANVAS_PANE_CONTEXT_MENU), [
			['5_transfer', 'basehalf.canvas.importFiles'],
			['1_new', 'basehalf.canvas.newFile'],
			['1_new', 'basehalf.canvas.newFolder'],
			['1_new', 'basehalf.canvas.newNote'],
			['5_transfer', 'basehalf.canvas.paste']
		]);
	});
});

function menuCommands(menuId: MenuId): [string | undefined, string][] {
	return MenuRegistry.getMenuItems(menuId)
		.filter(isIMenuItem)
		.map(item => [item.group, item.command.id] as [string | undefined, string])
		.sort((left, right) => left[1].localeCompare(right[1]));
}

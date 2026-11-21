/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { BASEHALF_HIDDEN_COMMAND_FAMILIES, isBaseHalfHiddenCommand } from '../../common/basehalfHiddenCommands.js';

// The base's own registrations of the families BaseHalf does not have: what these modules put into the
// menu registry when they load is what a base update changes.
import '../../../../contrib/tasks/browser/task.contribution.js';
import '../../../../contrib/debug/browser/debug.contribution.js';
import '../../../../contrib/notebook/browser/notebook.contribution.js';
import '../../../../contrib/testing/browser/testing.contribution.js';
import '../../../../contrib/chat/browser/chat.contribution.js';
import '../../../../contrib/inlineChat/browser/inlineChat.contribution.js';
import '../../../../contrib/mcp/browser/mcp.contribution.js';
import '../../../../contrib/mergeEditor/browser/mergeEditor.contribution.js';
import '../../../../contrib/searchEditor/browser/searchEditor.contribution.js';
import '../../../../contrib/markers/browser/markers.contribution.js';
import '../../../../contrib/remote/browser/remote.contribution.js';

suite('BaseHalfHiddenCommandFamilies', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the patterns name every command the Command Palette lists under a hidden family\'s category', () => {
		const categories = new Map<string, string>();
		for (const family of BASEHALF_HIDDEN_COMMAND_FAMILIES) {
			for (const category of family.paletteCategories) {
				categories.set(category, family.family);
			}
		}

		const listed = new Map<string, number>();
		const missed: string[] = [];
		for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
			if (!isIMenuItem(item) || !item.command.category) {
				continue;
			}
			const category = typeof item.command.category === 'string' ? item.command.category : item.command.category.original;
			const family = categories.get(category);
			if (!family) {
				continue;
			}
			listed.set(family, (listed.get(family) ?? 0) + 1);
			if (!isBaseHalfHiddenCommand(item.command.id)) {
				missed.push(`${category}: ${item.command.id}`);
			}
		}

		// A command named here is new in a hidden family: add its id or a pattern to the family in
		// basehalfHiddenCommands.ts, or, if BaseHalf has it, to BASEHALF_KEPT_COMMANDS with its reason.
		assert.deepStrictEqual(missed, []);
		// The check checks something: the base's modules above did register these families.
		assert.deepStrictEqual(['chat', 'tasks', 'debug', 'notebooks', 'testing', 'merge-editor', 'search-editor'].filter(family => !listed.get(family)), []);
	});
});

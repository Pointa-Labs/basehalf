/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { getAllUnboundCommands } from '../../../../services/keybinding/browser/unboundCommands.js';

suite('BaseHalf: what Keyboard Shortcuts lists without a key', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('a command of BaseHalf\'s own is listed when the Command Palette has an entry for it, and a command of the base as the base lists it', () => {
		const disposables = store.add(new DisposableStore());
		const register = (id: string) => disposables.add(CommandsRegistry.registerCommand(id, () => { }));
		// A command of a menu of BaseHalf's, which takes what the menu was opened on, and one BaseHalf's parts call.
		register('basehalf.test.menuCommand');
		register('pointa.basehalf-test.internal');
		// A command of BaseHalf's with an entry of the palette, also one that never holds.
		register('basehalf.test.named');
		disposables.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'basehalf.test.named', title: 'Named' } }));
		// The base's: one it lists by its id, one of a family BaseHalf does not have, and its plumbing.
		register('basehalfTestCursorDown');
		register('workbench.action.tasks.basehalfTest');
		register('_basehalfTest.plumbing');

		const listed = new Set(getAllUnboundCommands(new Map([['basehalf.test.bound', true]])));
		assert.deepStrictEqual(
			['basehalf.test.menuCommand', 'pointa.basehalf-test.internal', 'basehalf.test.named', 'basehalfTestCursorDown', 'workbench.action.tasks.basehalfTest', '_basehalfTest.plumbing'].filter(id => listed.has(id)),
			['basehalf.test.named', 'basehalfTestCursorDown']
		);
	});
});

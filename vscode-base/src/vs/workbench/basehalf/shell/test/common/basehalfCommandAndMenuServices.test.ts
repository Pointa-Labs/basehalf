/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Separator } from '../../../../../base/common/actions.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MenuId, MenuItemAction, MenuRegistry, SubmenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { NullCommandService } from '../../../../../platform/commands/test/common/nullCommandService.js';
import { InstantiationService } from '../../../../../platform/instantiation/common/instantiationService.js';
import { MockContextKeyService, MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { NullExtensionService } from '../../../../services/extensions/common/extensions.js';
import { BaseHalfCommandService } from '../../common/basehalfCommandService.js';
import { BaseHalfMenuService } from '../../common/basehalfMenuService.js';

suite('BaseHalfCommandService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('refuses a command BaseHalf does not have, and neither runs it nor activates an extension for it', async () => {
		const ran: string[] = [];
		const activated: string[] = [];
		store.add(CommandsRegistry.registerCommand('workbench.action.tasks.runTask', () => { ran.push('task'); }));
		store.add(CommandsRegistry.registerCommand('basehalf.test.kept', () => { ran.push('kept'); return 7; }));
		const service = store.add(new BaseHalfCommandService(new InstantiationService(), new class extends NullExtensionService {
			override activateByEvent(activationEvent: string): Promise<void> {
				activated.push(activationEvent);
				return super.activateByEvent(activationEvent);
			}
		}, new NullLogService()));

		const refused = await service.executeCommand('workbench.action.tasks.runTask').then(() => 'ran', error => (error as Error).message);
		const unregistered = await service.executeCommand('workbench.action.chat.open').then(() => 'ran', error => (error as Error).message);
		const kept = await service.executeCommand<number>('basehalf.test.kept');

		assert.deepStrictEqual({ refused, unregistered, kept, ran, activated }, {
			refused: 'command \'workbench.action.tasks.runTask\' not found',
			unregistered: 'command \'workbench.action.chat.open\' not found',
			kept: 7,
			ran: ['kept'],
			activated: ['onCommand:basehalf.test.kept']
		});
	});
});

suite('BaseHalfMenuService', () => {
	const disposables = new DisposableStore();
	const contextKeyService = new class extends MockContextKeyService {
		override contextMatchesRules() {
			return true;
		}
	};

	teardown(() => disposables.clear());

	ensureNoDisposablesAreLeakedInTestSuite();

	function describe(groups: [string, Array<MenuItemAction | SubmenuItemAction>][]): unknown[] {
		return groups.map(([group, actions]) => [group, actions.map(action => action instanceof SubmenuItemAction
			? { submenu: action.actions.map(inner => inner instanceof Separator ? '---' : inner.id) }
			: action.id)]);
	}

	test('a menu leaves out the commands BaseHalf does not have, with the submenus and groups they leave empty', () => {
		const menuService = disposables.add(new BaseHalfMenuService(NullCommandService, new MockKeybindingService(), disposables.add(new InMemoryStorageService())));
		const menu = new MenuId(`basehalf/${generateUuid()}`);
		const mixed = new MenuId(`basehalf/${generateUuid()}`);
		const emptied = new MenuId(`basehalf/${generateUuid()}`);

		disposables.add(MenuRegistry.appendMenuItems([
			{ id: menu, item: { command: { id: 'basehalf.test.first', title: 'First' }, group: '1_kept' } },
			{ id: menu, item: { command: { id: 'workbench.action.tasks.runTask', title: 'Run Task' }, group: '1_kept' } },
			{ id: menu, item: { command: { id: 'debug.addConfiguration', title: 'Add Configuration' }, group: '2_gone' } },
			{ id: menu, item: { submenu: mixed, title: 'Mixed', group: '3_submenus' } },
			{ id: menu, item: { submenu: emptied, title: 'Emptied', group: '3_submenus' } },
			{ id: mixed, item: { command: { id: 'workbench.profiles.actions.manageProfiles', title: 'Profiles' }, group: '1_first' } },
			{ id: mixed, item: { command: { id: 'basehalf.test.second', title: 'Second' }, group: '2_second' } },
			{ id: mixed, item: { command: { id: 'workbench.action.browser.open', title: 'Browser' }, group: '3_third' } },
			{ id: mixed, item: { command: { id: 'basehalf.test.third', title: 'Third' }, group: '4_fourth' } },
			{ id: emptied, item: { command: { id: 'workbench.action.chat.open', title: 'Chat' }, group: '1_first' } },
			{ id: emptied, item: { command: { id: 'testing.runAll', title: 'Run Tests' }, group: '2_second' } }
		]));

		const expected = [
			['1_kept', ['basehalf.test.first']],
			['3_submenus', [{ submenu: ['basehalf.test.second', '---', 'basehalf.test.third'] }]]
		];
		const created = disposables.add(menuService.createMenu(menu, contextKeyService));
		assert.deepStrictEqual(
			{ once: describe(menuService.getMenuActions(menu, contextKeyService)), created: describe(created.getActions()) },
			{ once: expected, created: expected }
		);
	});
});

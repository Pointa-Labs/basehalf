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
import { isICommandActionToggleInfo } from '../../../../../platform/action/common/action.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { NullCommandService } from '../../../../../platform/commands/test/common/nullCommandService.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { InstantiationService } from '../../../../../platform/instantiation/common/instantiationService.js';
import { MockContextKeyService, MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { NullExtensionService } from '../../../../services/extensions/common/extensions.js';
import { BaseHalfCommandService } from '../../common/basehalfCommandService.js';
import { BASEHALF_PALETTE_ONLY_COMMANDS, isBaseHalfHiddenCommand } from '../../common/basehalfHiddenCommands.js';
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

	test('an item names the parts of the window in BaseHalf\'s words, whatever draws it', () => {
		const menuService = disposables.add(new BaseHalfMenuService(NullCommandService, new MockKeybindingService(), disposables.add(new InMemoryStorageService())));
		const menu = new MenuId(`basehalf/${generateUuid()}`);
		const submenu = new MenuId(`basehalf/${generateUuid()}`);
		const toggle = {
			id: 'basehalf.test.toggleAuxiliaryBar',
			title: { value: 'Toggle Secondary Side Bar Visibility', original: 'Toggle Secondary Side Bar Visibility', mnemonicTitle: '&&Secondary Side Bar' },
			shortTitle: 'Secondary Side Bar',
			tooltip: { value: 'Show the Secondary Side Bar', original: 'Show the Secondary Side Bar' },
			toggled: { condition: ContextKeyExpr.true(), title: 'Hide Secondary Side Bar', mnemonicTitle: '&&Secondary Side Bar' },
			metadata: { description: 'Open/Show and Close/Hide Secondary Side Bar' }
		};
		const plain = { id: 'basehalf.test.plain', title: 'Zoom In' };
		disposables.add(MenuRegistry.appendMenuItems([
			{ id: menu, item: { command: toggle, alt: { id: 'basehalf.test.alt', title: 'Close Primary Side Bar' }, group: '1' } },
			{ id: menu, item: { command: plain, group: '1' } },
			{ id: menu, item: { submenu, title: 'Primary Side Bar Position', group: '2' } },
			{ id: submenu, item: { command: { id: 'basehalf.test.inner', title: { value: 'Focus into Primary Side Bar', original: 'Focus into Primary Side Bar' } }, group: '1' } }
		]));

		const created = disposables.add(menuService.createMenu(menu, contextKeyService));
		const [[, [first, second]], [, [third]]] = created.getActions();
		const again = created.getActions();
		assert.ok(first instanceof MenuItemAction && second instanceof MenuItemAction && third instanceof SubmenuItemAction);
		const inner = third.actions[0];
		assert.ok(inner instanceof MenuItemAction);
		assert.deepStrictEqual({
			// What a toolbar and a context menu draw: the item is on, so its label is the title it has while on.
			label: first.label,
			tooltip: first.tooltip,
			checked: first.checked,
			// What the application menu, the Command Palette, and Keyboard Shortcuts read.
			title: first.item.title,
			shortTitle: first.item.shortTitle,
			toggled: isICommandActionToggleInfo(first.item.toggled) ? [first.item.toggled.title, first.item.toggled.mnemonicTitle] : undefined,
			description: first.item.metadata?.description,
			alt: first.alt?.label,
			submenu: [third.label, inner.label, inner.item.title],
			// The registry keeps the base's words, an item that names no part is the menu's own, and an item is worded once.
			registry: toggle.title.value,
			plainIsSame: second.item === plain,
			wordedOnce: (again[0][1][0] as MenuItemAction).item === first.item,
			short: (menuService.getMenuActions(menu, contextKeyService, { renderShortTitle: true })[0][1][1] as MenuItemAction).label
		}, {
			label: 'Hide Agent Area',
			tooltip: 'Show the Agent Area',
			checked: true,
			title: { value: 'Toggle Agent Area', original: 'Toggle Agent Area', mnemonicTitle: '&&Agent Area' },
			shortTitle: 'Agent Area',
			toggled: ['Hide Agent Area', '&&Agent Area'],
			description: 'Open/Show and Close/Hide Agent Area',
			alt: 'Close Sidebar',
			submenu: ['Sidebar Position', 'Focus into Sidebar', { value: 'Focus into Sidebar', original: 'Focus into Sidebar' }],
			registry: 'Toggle Secondary Side Bar Visibility',
			plainIsSame: true,
			wordedOnce: true,
			short: 'Zoom In'
		});
	});

	test('a command of the Command Palette only is in no other menu', () => {
		const menuService = disposables.add(new BaseHalfMenuService(NullCommandService, new MockKeybindingService(), disposables.add(new InMemoryStorageService())));
		const menu = new MenuId(`basehalf/${generateUuid()}`);
		const submenu = new MenuId(`basehalf/${generateUuid()}`);
		const snippets = { id: 'workbench.action.openSnippets', title: 'Configure Snippets' };
		disposables.add(MenuRegistry.appendMenuItems([
			{ id: menu, item: { command: { id: 'basehalf.test.settings', title: 'Settings' }, group: '1' } },
			{ id: menu, item: { command: snippets, group: '1' } },
			{ id: menu, item: { submenu, title: 'More', group: '2' } },
			{ id: submenu, item: { command: snippets, group: '1' } },
			{ id: MenuId.CommandPalette, item: { command: snippets } }
		]));

		assert.deepStrictEqual({
			menu: describe(menuService.getMenuActions(menu, contextKeyService)),
			palette: menuService.getMenuActions(MenuId.CommandPalette, contextKeyService).flatMap(([, actions]) => actions).filter(action => action.id === snippets.id).length,
			paletteOnly: BASEHALF_PALETTE_ONLY_COMMANDS.map(command => [command.id, isBaseHalfHiddenCommand(command.id), !!command.reason.trim()])
		}, {
			menu: [['1', ['basehalf.test.settings']]],
			palette: 1,
			paletteOnly: [['workbench.action.openSnippets', false, true]]
		});
	});
});

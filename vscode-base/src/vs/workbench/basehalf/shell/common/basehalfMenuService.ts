/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IAction, Separator } from '../../../../base/common/actions.js';
import { Event } from '../../../../base/common/event.js';
import { IMenu, IMenuActionOptions, IMenuChangeEvent, IMenuCreateOptions, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { MenuService } from '../../../../platform/actions/common/menuService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { isBaseHalfHiddenCommand } from './basehalfHiddenCommands.js';

type MenuActionGroups = [string, Array<MenuItemAction | SubmenuItemAction>][];

/**
 * The workbench's menu service, whose menus leave out the commands that BaseHalf does not have (D141).
 * Every menu is built here from the menu registry, the Command Palette, the application menu, the title
 * bar, and the context menus among them, so one place serves them all. A submenu that is left without
 * an item goes with its items, and so does a top-level menu of the application menu.
 */
export class BaseHalfMenuService extends MenuService {

	constructor(
		@ICommandService commandService: ICommandService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService
	) {
		super(commandService, keybindingService, storageService);
	}

	override createMenu(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuCreateOptions): IMenu {
		return new BaseHalfMenu(super.createMenu(id, contextKeyService, options));
	}

	override getMenuActions(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuActionOptions): MenuActionGroups {
		return withoutBaseHalfHiddenCommands(super.getMenuActions(id, contextKeyService, options));
	}
}

class BaseHalfMenu implements IMenu {

	readonly onDidChange: Event<IMenuChangeEvent>;

	constructor(private readonly menu: IMenu) {
		this.onDidChange = menu.onDidChange;
	}

	getActions(options?: IMenuActionOptions): MenuActionGroups {
		return withoutBaseHalfHiddenCommands(this.menu.getActions(options));
	}

	dispose(): void {
		this.menu.dispose();
	}
}

/** The groups of a menu without the commands BaseHalf does not have, and without what they leave empty. */
export function withoutBaseHalfHiddenCommands(groups: MenuActionGroups): MenuActionGroups {
	const result: MenuActionGroups = [];
	for (const [group, actions] of groups) {
		const kept: Array<MenuItemAction | SubmenuItemAction> = [];
		for (const action of actions) {
			const shown = shownAction(action);
			if (shown) {
				kept.push(shown);
			}
		}
		if (kept.length) {
			result.push([group, kept]);
		}
	}
	return result;
}

function shownAction(action: MenuItemAction | SubmenuItemAction): MenuItemAction | SubmenuItemAction | undefined {
	if (action instanceof MenuItemAction) {
		return isBaseHalfHiddenCommand(action.item.id) ? undefined : action;
	}
	const actions = shownSubmenuActions(action.actions);
	if (!actions.length) {
		return undefined;
	}
	return actions.length === action.actions.length ? action : new SubmenuItemAction(action.item, action.hideActions, actions);
}

function shownSubmenuActions(actions: readonly IAction[]): IAction[] {
	const kept: IAction[] = [];
	for (const action of actions) {
		if (action instanceof Separator) {
			// A separator stands between two items: never first, and never after another one.
			if (kept.length && !(kept[kept.length - 1] instanceof Separator)) {
				kept.push(action);
			}
		} else if (action instanceof MenuItemAction || action instanceof SubmenuItemAction) {
			const shown = shownAction(action);
			if (shown) {
				kept.push(shown);
			}
		} else {
			kept.push(action);
		}
	}
	if (kept[kept.length - 1] instanceof Separator) {
		kept.pop();
	}
	return kept;
}

// In place of the base's MenuService, which is registered before this module loads.
registerSingleton(IMenuService, BaseHalfMenuService, InstantiationType.Delayed);

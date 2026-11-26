/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IAction, Separator } from '../../../../base/common/actions.js';
import { Event } from '../../../../base/common/event.js';
import { ICommandAction, ICommandActionTitle, ICommandActionToggleInfo, ILocalizedString, isICommandActionToggleInfo } from '../../../../platform/action/common/action.js';
import { IMenu, IMenuActionOptions, IMenuChangeEvent, IMenuCreateOptions, IMenuService, ISubmenuItem, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { MenuService } from '../../../../platform/actions/common/menuService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { isBaseHalfHiddenCommand, isBaseHalfPaletteOnlyCommand } from './basehalfHiddenCommands.js';
import { toBaseHalfWords } from './basehalfWords.js';

type MenuActionGroups = [string, Array<MenuItemAction | SubmenuItemAction>][];

/** What a menu's items are made with, so that an item can be made again in BaseHalf's words. */
interface IBaseHalfMenuContext {
	/** The menu is the Command Palette's, which also lists the commands that no other menu holds. */
	readonly palette: boolean;
	readonly options: IMenuActionOptions | undefined;
	readonly contextKeyService: IContextKeyService;
	readonly commandService: ICommandService;
}

/**
 * The workbench's menu service, whose menus leave out the commands that BaseHalf does not have (D141) and
 * name the parts of the window in BaseHalf's words (D150). Every menu is built here from the menu registry,
 * the Command Palette, the application menu, the title bar, and the context menus among them, so one place
 * serves them all. A submenu that is left without an item goes with its items, and so does a top-level menu
 * of the application menu.
 */
export class BaseHalfMenuService extends MenuService {

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService
	) {
		super(commandService, keybindingService, storageService);
	}

	override createMenu(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuCreateOptions): IMenu {
		return new BaseHalfMenu(super.createMenu(id, contextKeyService, options), id, contextKeyService, this.commandService);
	}

	override getMenuActions(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuActionOptions): MenuActionGroups {
		return baseHalfMenuActions(super.getMenuActions(id, contextKeyService, options), { palette: id === MenuId.CommandPalette, options, contextKeyService, commandService: this.commandService });
	}
}

class BaseHalfMenu implements IMenu {

	readonly onDidChange: Event<IMenuChangeEvent>;

	constructor(
		private readonly menu: IMenu,
		private readonly id: MenuId,
		private readonly contextKeyService: IContextKeyService,
		private readonly commandService: ICommandService
	) {
		this.onDidChange = menu.onDidChange;
	}

	getActions(options?: IMenuActionOptions): MenuActionGroups {
		return baseHalfMenuActions(this.menu.getActions(options), { palette: this.id === MenuId.CommandPalette, options, contextKeyService: this.contextKeyService, commandService: this.commandService });
	}

	dispose(): void {
		this.menu.dispose();
	}
}

/**
 * The groups of a menu as BaseHalf shows them: without the commands BaseHalf does not have and what they
 * leave empty, without the commands that only the Command Palette lists, and with BaseHalf's words.
 */
export function baseHalfMenuActions(groups: MenuActionGroups, context: IBaseHalfMenuContext): MenuActionGroups {
	const result: MenuActionGroups = [];
	for (const [group, actions] of groups) {
		const kept: Array<MenuItemAction | SubmenuItemAction> = [];
		for (const action of actions) {
			const shown = shownAction(action, context);
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

function shownAction(action: MenuItemAction | SubmenuItemAction, context: IBaseHalfMenuContext): MenuItemAction | SubmenuItemAction | undefined {
	if (action instanceof MenuItemAction) {
		if (isBaseHalfHiddenCommand(action.item.id) || (!context.palette && isBaseHalfPaletteOnlyCommand(action.item.id))) {
			return undefined;
		}
		const item = toBaseHalfCommandAction(action.item);
		const alt = action.alt ? toBaseHalfCommandAction(action.alt.item) : undefined;
		return item === action.item && alt === action.alt?.item
			? action
			: new MenuItemAction(item, alt, context.options, action.hideActions, action.menuKeybinding, context.contextKeyService, context.commandService);
	}
	const actions = shownSubmenuActions(action.actions, context);
	if (!actions.length) {
		return undefined;
	}
	const item = toBaseHalfSubmenuItem(action.item);
	return item === action.item && actions.length === action.actions.length && actions.every((inner, index) => inner === action.actions[index])
		? action
		: new SubmenuItemAction(item, action.hideActions, actions);
}

function shownSubmenuActions(actions: readonly IAction[], context: IBaseHalfMenuContext): IAction[] {
	const kept: IAction[] = [];
	for (const action of actions) {
		if (action instanceof Separator) {
			// A separator stands between two items: never first, and never after another one.
			if (kept.length && !(kept[kept.length - 1] instanceof Separator)) {
				kept.push(action);
			}
		} else if (action instanceof MenuItemAction || action instanceof SubmenuItemAction) {
			const shown = shownAction(action, context);
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

// A menu asks for its items each time it is drawn: an item is worded once.
const wordedCommandActions = new WeakMap<ICommandAction, ICommandAction>();
const wordedSubmenuItems = new WeakMap<ISubmenuItem, ISubmenuItem>();

/**
 * The item of a command in BaseHalf's words (D150): its title, its short title, its tooltip, the title and
 * the tooltip it has while it is on, and its description. An item that names no part of the window is
 * returned as it is.
 */
export function toBaseHalfCommandAction(item: ICommandAction): ICommandAction {
	let worded = wordedCommandActions.get(item);
	if (!worded) {
		worded = wordedCommandAction(item);
		wordedCommandActions.set(item, worded);
	}
	return worded;
}

function toBaseHalfSubmenuItem(item: ISubmenuItem): ISubmenuItem {
	let worded = wordedSubmenuItems.get(item);
	if (!worded) {
		const title = wordedTitle(item.title);
		worded = title === item.title ? item : { ...item, title };
		wordedSubmenuItems.set(item, worded);
	}
	return worded;
}

function wordedCommandAction(item: ICommandAction): ICommandAction {
	const worded: ICommandAction = { ...item, title: wordedTitle(item.title) };
	let changed = worded.title !== item.title;
	if (item.shortTitle !== undefined) {
		worded.shortTitle = wordedTitle(item.shortTitle);
		changed ||= worded.shortTitle !== item.shortTitle;
	}
	if (item.tooltip !== undefined) {
		worded.tooltip = wordedTitle(item.tooltip);
		changed ||= worded.tooltip !== item.tooltip;
	}
	if (isICommandActionToggleInfo(item.toggled)) {
		worded.toggled = wordedToggle(item.toggled);
		changed ||= worded.toggled !== item.toggled;
	}
	const description = item.metadata?.description;
	if (item.metadata && description !== undefined) {
		const wordedDescription = wordedTitle(description);
		if (wordedDescription !== description) {
			worded.metadata = { ...item.metadata, description: wordedDescription };
			changed = true;
		}
	}
	return changed ? worded : item;
}

function wordedTitle<T extends string | ILocalizedString | ICommandActionTitle>(title: T): T;
function wordedTitle(title: string | ICommandActionTitle): string | ICommandActionTitle {
	if (typeof title === 'string') {
		return toBaseHalfWords(title);
	}
	const value = toBaseHalfWords(title.value);
	const original = toBaseHalfWords(title.original);
	const mnemonicTitle = title.mnemonicTitle === undefined ? undefined : toBaseHalfWords(title.mnemonicTitle);
	if (value === title.value && original === title.original && mnemonicTitle === title.mnemonicTitle) {
		return title;
	}
	return mnemonicTitle === undefined ? { ...title, value, original } : { ...title, value, original, mnemonicTitle };
}

function wordedToggle(toggled: ICommandActionToggleInfo): ICommandActionToggleInfo {
	const worded: ICommandActionToggleInfo = { ...toggled };
	let changed = false;
	for (const key of ['title', 'tooltip', 'mnemonicTitle'] as const) {
		const text = toggled[key];
		if (text !== undefined) {
			worded[key] = toBaseHalfWords(text);
			changed ||= worded[key] !== text;
		}
	}
	return changed ? worded : toggled;
}

// In place of the base's MenuService, which is registered before this module loads.
registerSingleton(IMenuService, BaseHalfMenuService, InstantiationType.Delayed);

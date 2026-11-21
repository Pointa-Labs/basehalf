/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IAction, Separator, SubmenuAction } from '../../../../base/common/actions.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { isBaseHalfHiddenCommand } from './basehalfHiddenCommands.js';
import { toBaseHalfWords } from './basehalfWords.js';

/**
 * The entries of a context menu as BaseHalf shows them (D150). The base draws some context menus itself,
 * without the menu service: the menu of the sidebar's icons, of a part's title, of a part. What holds for
 * a menu of the menu service holds for them: an entry whose id is a command BaseHalf does not have is left
 * out, a submenu that is left without an entry goes, and the names are in BaseHalf's words. An item of the
 * menu service is BaseHalf's already and stays as it is.
 */
export function baseHalfContextMenuActions(actions: readonly IAction[]): IAction[] {
	const kept: IAction[] = [];
	for (const action of actions) {
		if (action instanceof Separator) {
			// A separator stands between two entries: never first, and never after another one.
			if (kept.length && !(kept[kept.length - 1] instanceof Separator)) {
				kept.push(action);
			}
			continue;
		}
		const shown = shownEntry(action);
		if (shown) {
			kept.push(shown);
		}
	}
	if (kept[kept.length - 1] instanceof Separator) {
		kept.pop();
	}
	return kept;
}

function shownEntry(action: IAction): IAction | undefined {
	if (action instanceof MenuItemAction || action instanceof SubmenuItemAction) {
		return action;
	}
	if (action instanceof SubmenuAction) {
		const actions = baseHalfContextMenuActions(action.actions);
		if (!actions.length) {
			return undefined;
		}
		const label = toBaseHalfWords(action.label);
		return label === action.label && actions.length === action.actions.length && actions.every((inner, index) => inner === action.actions[index])
			? action
			: new SubmenuAction(action.id, label, actions, action.class);
	}
	if (isBaseHalfHiddenCommand(action.id)) {
		return undefined;
	}
	const label = toBaseHalfWords(action.label);
	const tooltip = toBaseHalfWords(action.tooltip);
	if (label === action.label && tooltip === action.tooltip) {
		return action;
	}
	// The entry itself, under another name: everything but its name is asked of the entry.
	return Object.create(action, { label: { value: label, enumerable: true }, tooltip: { value: tooltip, enumerable: true } }) as IAction;
}

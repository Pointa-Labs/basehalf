/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The More menu of the title bar (docs/specs/commands-and-menus.md, The menus; D155). It is the base's menu of
 * the gear, `MenuId.GlobalActivity`, with BaseHalf's entries and BaseHalf's order. The groups are the base's own
 * names, so that an entry the base adds to one of them stands with the others of its group.
 */

/** The group of Settings, Keyboard Shortcuts, Themes, and Layout Density. It stands first. */
export const BASEHALF_MORE_MENU_SETTINGS_GROUP = '2_configuration';

/** The group of Command Palette, which Customize Layout joins. */
export const BASEHALF_MORE_MENU_COMMAND_GROUP = '1_command';

/** The group of Accounts, between the commands and the entries of an update (`7_update`). */
export const BASEHALF_MORE_MENU_ACCOUNTS_GROUP = '3_accounts';

/**
 * The groups of the More menu in BaseHalf's order: the group of Settings first, and every other group after it
 * in the order the menu has them.
 */
export function baseHalfMoreMenuGroups<T>(groups: readonly [string, T][]): [string, T][] {
	return [
		...groups.filter(([group]) => group === BASEHALF_MORE_MENU_SETTINGS_GROUP),
		...groups.filter(([group]) => group !== BASEHALF_MORE_MENU_SETTINGS_GROUP)
	];
}

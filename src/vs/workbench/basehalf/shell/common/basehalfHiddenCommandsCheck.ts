/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_HIDDEN_COMMAND_FAMILIES, isBaseHalfHiddenCommand } from './basehalfHiddenCommands.js';

/** What the window writes to its log, followed by the commands, when a hidden family lists a command no pattern names. */
export const BASEHALF_UNNAMED_HIDDEN_COMMANDS_LOG = '[BaseHalf] commands of a hidden family that no pattern names:';

/** A command as the Command Palette's menu holds it. */
export interface IBaseHalfPaletteCommand {
	readonly id: string;
	/** The category the palette shows before the command's name, in the language of the source. */
	readonly category: string | undefined;
}

/**
 * The commands that the Command Palette would list under the category of a family BaseHalf does not have, and
 * that no pattern of the family names (commands and menus, criterion 9): what a base update adds to such a
 * family. Each is written as `category: id`.
 */
export function baseHalfUnnamedHiddenCommands(commands: Iterable<IBaseHalfPaletteCommand>): string[] {
	const categories = new Set<string>();
	for (const family of BASEHALF_HIDDEN_COMMAND_FAMILIES) {
		for (const category of family.paletteCategories) {
			categories.add(category);
		}
	}
	const unnamed = new Set<string>();
	for (const command of commands) {
		if (command.category !== undefined && categories.has(command.category) && !isBaseHalfHiddenCommand(command.id)) {
			unnamed.add(`${command.category}: ${command.id}`);
		}
	}
	return [...unnamed].sort();
}

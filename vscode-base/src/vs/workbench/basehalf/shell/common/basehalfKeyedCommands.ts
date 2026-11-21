/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';

// The names of BaseHalf's commands that are registered as a key with what it runs, and so have no name
// of their own (D150, docs/specs/commands-and-menus.md). Keyboard Shortcuts lists a command of BaseHalf's
// by its name, and it takes the name from the command's entry of the Command Palette.

export interface IBaseHalfKeyedCommand {
	readonly id: string;
	readonly title: ILocalizedString;
	/** The context key that holds while the Command Palette lists the command. Without it, the palette never lists it. */
	readonly paletteWhen?: string;
}

export const BASEHALF_KEYED_COMMANDS: readonly IBaseHalfKeyedCommand[] = [
	// It needs no card under it: the note appears where the canvas has room.
	{ id: 'basehalf.canvas.newNote', title: localize2('basehalf.keyed.newNote', "New Note"), paletteWhen: 'basehalf.surfaceActive' },
	{ id: 'basehalf.cardDetail.close', title: localize2('basehalf.keyed.closeCardDetail', "Close Card Detail") },
	{ id: 'basehalf.changes.nextChange', title: localize2('basehalf.keyed.nextChange', "Go to Next Change in Changes") },
	{ id: 'basehalf.changes.previousChange', title: localize2('basehalf.keyed.previousChange', "Go to Previous Change in Changes") },
	{ id: 'basehalf.changes.closeDiff', title: localize2('basehalf.keyed.closeDiff', "Close Changes") },
	{ id: 'basehalf.codeCards.endEditing', title: localize2('basehalf.keyed.endEditing', "Stop Editing Code on Card") }
];

/** What the window writes to its log, followed by the commands, when a command of BaseHalf's has a key and no name. */
export const BASEHALF_KEYED_COMMANDS_WITHOUT_NAME_LOG = '[BaseHalf] commands of BaseHalf with a key and no name:';

/**
 * The commands of BaseHalf's own that have a key and no name: Keyboard Shortcuts would list each by its id
 * (commands and menus, required behavior 11). `named` holds the commands the Command Palette has an entry for.
 */
export function baseHalfKeyedCommandsWithoutName(keyed: Iterable<string>, named: ReadonlySet<string>): string[] {
	const without = new Set<string>();
	for (const id of keyed) {
		if ((id.startsWith('basehalf.') || id.startsWith('pointa.')) && !named.has(id)) {
			without.add(id);
		}
	}
	return [...without].sort();
}

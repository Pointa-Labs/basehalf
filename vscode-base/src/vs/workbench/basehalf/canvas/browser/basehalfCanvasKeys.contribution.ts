/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { BASEHALF_CANVAS_KEY_COMMANDS, IBaseHalfCanvasKeyCommandService } from '../common/basehalfCanvasKeys.js';

// The keys of the canvas are commands (docs/specs/canvas-keys.md): each has its name under BaseHalf, its
// default keys, and the condition under which the key acts, so Keyboard Shortcuts lists it and a user
// gives it another key. The canvas view runs it.
for (const command of BASEHALF_CANVAS_KEY_COMMANDS) {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: command.id,
				title: command.title,
				category: localize2('basehalf.category', "BaseHalf"),
				f1: false,
				// Keyboard Shortcuts names a command by its entry of the Command Palette: a command that
				// the palette never lists has an entry that never holds.
				menu: [{ id: MenuId.CommandPalette, when: command.palette ?? ContextKeyExpr.false() }],
				keybinding: command.keys ? {
					// Above the base's own use of the key, as the keys of the window's zoom.
					weight: KeybindingWeight.WorkbenchContrib + 50,
					when: command.when,
					primary: command.keys.primary,
					secondary: command.keys.secondary ? [...command.keys.secondary] : undefined,
					mac: command.keys.mac ? { primary: command.keys.mac.primary, secondary: command.keys.mac.secondary ? [...command.keys.mac.secondary] : undefined } : undefined
				} : undefined
			});
		}

		override run(accessor: ServicesAccessor): Promise<void> {
			return accessor.get(IBaseHalfCanvasKeyCommandService).run(command.id);
		}
	});
}

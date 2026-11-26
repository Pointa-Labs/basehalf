/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { BASEHALF_KEYED_COMMANDS, BASEHALF_KEYED_COMMANDS_WITHOUT_NAME_LOG, baseHalfKeyedCommandsWithoutName } from '../common/basehalfKeyedCommands.js';

// Keyboard Shortcuts names a command by its entry of the Command Palette: a command that the palette never
// lists has an entry that never holds (the keys of the canvas, D146).
for (const command of BASEHALF_KEYED_COMMANDS) {
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
		command: { id: command.id, title: command.title, category: localize2('basehalf.category', "BaseHalf") },
		when: command.paletteWhen ? ContextKeyExpr.has(command.paletteWhen) : ContextKeyExpr.false()
	});
}

/**
 * Names, in the window's log, every command of BaseHalf's own that has a key and no name (commands and menus,
 * required behavior 11): Keyboard Shortcuts would list it by its id. The window holds every registration; the
 * smoke fails on the line.
 */
class BaseHalfKeyedCommandsCheckContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfKeyedCommandsCheck';

	constructor(
		@IExtensionService extensionService: IExtensionService,
		@ILogService logService: ILogService
	) {
		// The keys of the extensions are registered once the extensions are.
		void extensionService.whenInstalledExtensionsRegistered().then(() => {
			const named = new Set<string>();
			for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
				if (isIMenuItem(item)) {
					named.add(item.command.id);
				}
			}
			const keyed = KeybindingsRegistry.getDefaultKeybindings().map(item => item.command).filter((command): command is string => !!command);
			const without = baseHalfKeyedCommandsWithoutName(keyed, named);
			if (without.length) {
				logService.warn(`${BASEHALF_KEYED_COMMANDS_WITHOUT_NAME_LOG} ${without.join(', ')}`);
			}
		});
	}
}

registerWorkbenchContribution2(BaseHalfKeyedCommandsCheckContribution.ID, BaseHalfKeyedCommandsCheckContribution, WorkbenchPhase.Eventually);

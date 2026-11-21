/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { BASEHALF_UNNAMED_HIDDEN_COMMANDS_LOG, baseHalfUnnamedHiddenCommands, IBaseHalfPaletteCommand } from '../common/basehalfHiddenCommandsCheck.js';

/**
 * Names, in the window's log, every command that the base registers for the Command Palette under the category
 * of a family BaseHalf does not have and that no pattern of the family names (commands and menus, criterion 9).
 * The window holds every registration of the base, which no unit test can load without changing the others; the
 * smoke fails on the line, so a base update names its new commands before it ships.
 */
class BaseHalfHiddenCommandsCheckContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfHiddenCommandsCheck';

	constructor(
		@IExtensionService extensionService: IExtensionService,
		@ILogService logService: ILogService
	) {
		// The commands of the extensions are registered once the extensions are.
		void extensionService.whenInstalledExtensionsRegistered().then(() => {
			const commands: IBaseHalfPaletteCommand[] = [];
			for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
				if (isIMenuItem(item)) {
					const category = item.command.category;
					commands.push({ id: item.command.id, category: typeof category === 'string' || category === undefined ? category : category.original });
				}
			}
			const unnamed = baseHalfUnnamedHiddenCommands(commands);
			if (unnamed.length) {
				logService.warn(`${BASEHALF_UNNAMED_HIDDEN_COMMANDS_LOG} ${unnamed.join(', ')}`);
			}
		});
	}
}

registerWorkbenchContribution2(BaseHalfHiddenCommandsCheckContribution.ID, BaseHalfHiddenCommandsCheckContribution, WorkbenchPhase.Eventually);

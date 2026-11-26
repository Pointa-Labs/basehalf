/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CommandService } from '../../../services/commands/common/commandService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { baseHalfHiddenCommandError, getBaseHalfHiddenCommandFamily } from './basehalfHiddenCommands.js';

/**
 * The workbench's command service, which refuses a command that BaseHalf does not have (D141): the
 * caller, an extension among them, gets the error of a command that does not exist, and nothing of the
 * command runs, neither its handler nor the activation of an extension for it.
 */
export class BaseHalfCommandService extends CommandService {

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IExtensionService extensionService: IExtensionService,
		@ILogService private readonly logService: ILogService
	) {
		super(instantiationService, extensionService, logService);
	}

	override executeCommand<T>(id: string, ...args: unknown[]): Promise<T> {
		const family = getBaseHalfHiddenCommandFamily(id);
		if (family) {
			this.logService.info(`[basehalf] refused the command ${id}: BaseHalf does not have it (${family})`);
			return Promise.reject(baseHalfHiddenCommandError(id));
		}
		return super.executeCommand<T>(id, ...args);
	}
}

// In place of the base's CommandService, which is registered before this module loads.
registerSingleton(ICommandService, BaseHalfCommandService, InstantiationType.Delayed);

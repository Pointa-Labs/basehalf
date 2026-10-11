/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { getErrorMessage } from '../../../base/common/errors.js';
import { ExtensionType } from '../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { EnablementState, IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService } from '../../services/extensionManagement/common/extensionManagement.js';
import { findBaseHalfBuiltInCapability } from '../common/basehalfBuiltInCapabilities.js';

/**
 * A built-in capability has no enable or disable of its own. The Plugins
 * library of an earlier build could leave AI Video disabled, and nothing in the
 * product can turn it back on, so that state is cleared at start.
 */
export class BaseHalfBuiltInCapabilityEnablement implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.builtInCapabilityEnablement';

	/** Settles when the check has run. It never rejects. */
	readonly whenChecked: Promise<void>;

	constructor(
		@IWorkbenchExtensionManagementService private readonly extensionManagementService: IWorkbenchExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@ILogService private readonly logService: ILogService
	) {
		this.whenChecked = this.enableBuiltInCapabilities();
	}

	private async enableBuiltInCapabilities(): Promise<void> {
		try {
			const builtInExtensions = await this.extensionManagementService.getInstalled(ExtensionType.System);
			const disabled = builtInExtensions.filter(extension => {
				if (!findBaseHalfBuiltInCapability(extension.identifier.id)) {
					return false;
				}
				const state = this.extensionEnablementService.getEnablementState(extension);
				return state === EnablementState.DisabledGlobally || state === EnablementState.DisabledWorkspace;
			});
			if (disabled.length === 0) {
				return;
			}
			await this.extensionEnablementService.setEnablement(disabled, EnablementState.EnabledGlobally);
			this.logService.info(`[BaseHalf] enabled built-in capabilities that an earlier build left disabled: ${disabled.map(extension => extension.identifier.id).join(', ')}`);
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not check the built-in capabilities: ${getErrorMessage(error)}`);
		}
	}
}

registerWorkbenchContribution2(BaseHalfBuiltInCapabilityEnablement.ID, BaseHalfBuiltInCapabilityEnablement, WorkbenchPhase.BlockRestore);

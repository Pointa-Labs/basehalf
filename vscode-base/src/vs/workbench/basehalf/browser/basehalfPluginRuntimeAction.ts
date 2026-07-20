/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import Severity from '../../../base/common/severity.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { ExtensionRuntimeStateAction } from '../../contrib/extensions/browser/extensionsActions.js';
import { IExtension, IExtensionsWorkbenchService } from '../../contrib/extensions/common/extensions.js';
import { IBaseHalfManagedPlugin, IBaseHalfPluginOperationResult } from '../common/basehalfPluginManagement.js';
import { selectBaseHalfPluginRuntimeExtension } from './basehalfPluginRuntimeModel.js';

export async function showBaseHalfPluginRuntimeAction(
	extensionsWorkbenchService: IExtensionsWorkbenchService,
	instantiationService: IInstantiationService,
	notificationService: INotificationService,
	plugin: IBaseHalfManagedPlugin,
	operation: string,
	result: IBaseHalfPluginOperationResult,
	capturedExtension?: IExtension
): Promise<void> {
	if (!result.restartRequired) {
		return;
	}
	const extension = selectBaseHalfPluginRuntimeExtension(
		plugin.extensionId,
		capturedExtension,
		await extensionsWorkbenchService.queryLocal()
	);
	if (!extension) {
		return;
	}
	const action = instantiationService.createInstance(ExtensionRuntimeStateAction);
	action.extension = extension;
	action.update();
	if (!action.enabled) {
		action.dispose();
		return;
	}
	const message = operation === 'update'
		? localize('basehalf.plugins.updateRestartRequired', "{0} was updated. A runtime restart is required to use the new version.", plugin.label)
		: operation === 'restore'
			? localize('basehalf.plugins.restoreRestartRequired', "{0} was restored. A runtime restart is required to use the restored version.", plugin.label)
			: operation === 'uninstall'
				? localize('basehalf.plugins.uninstallRestartRequired', "{0} was uninstalled. A runtime restart is required to finish removing it.", plugin.label)
				: localize('basehalf.plugins.changeRestartRequired', "A runtime restart is required to finish changing {0}.", plugin.label);
	const notification = notificationService.prompt(
		Severity.Info,
		message,
		[{ label: action.label, run: () => { void action.run(); } }],
		{ onCancel: () => action.dispose() }
	);
	Event.once(notification.onDidClose)(() => action.dispose());
}

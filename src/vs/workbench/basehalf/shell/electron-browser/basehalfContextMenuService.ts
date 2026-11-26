/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuMenuDelegate, IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { ContextMenuService } from '../../../services/contextmenu/electron-browser/contextmenuService.js';
import { baseHalfContextMenuActions } from '../common/basehalfContextMenuActions.js';

/**
 * The window's context menu service, which shows every context menu as BaseHalf has it (D150): the menus
 * the base draws itself, without the menu service, leave out the commands BaseHalf does not have and name
 * the parts of the window in BaseHalf's words, as the menus of the menu service do.
 */
export class BaseHalfContextMenuService extends ContextMenuService {

	constructor(
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextViewService contextViewService: IContextViewService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(notificationService, telemetryService, keybindingService, configurationService, contextViewService, menuService, contextKeyService);
	}

	override showContextMenu(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): void {
		super.showContextMenu(withBaseHalfContextMenuActions(delegate));
	}
}

/** The delegate with its own entries as BaseHalf has them. A copy, as the base's services make of a delegate. */
export function withBaseHalfContextMenuActions<T extends IContextMenuDelegate | IContextMenuMenuDelegate>(delegate: T): T {
	if (!delegate.getActions) {
		return delegate;
	}
	return { ...delegate, getActions: () => baseHalfContextMenuActions(delegate.getActions!()) };
}

// In place of the base's ContextMenuService, which is registered before this module loads.
registerSingleton(IContextMenuService, BaseHalfContextMenuService, InstantiationType.Delayed);

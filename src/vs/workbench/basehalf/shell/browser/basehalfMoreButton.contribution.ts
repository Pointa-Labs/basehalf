/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { IAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { getActionBarActions, getFlatContextMenuActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IMenu, IMenuService, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID } from '../../../common/activity.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { CompositeBarAction, IActivityHoverOptions, ICompositeBarActionItem } from '../../../browser/parts/compositeBarActions.js';
import { SimpleGlobalActivityActionViewItem } from '../../../browser/parts/globalCompositeBar.js';
import { IActivityService } from '../../../services/activity/common/activity.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { BASEHALF_MORE_MENU_ACCOUNTS_GROUP, BASEHALF_MORE_MENU_COMMAND_GROUP, baseHalfMoreMenuGroups } from '../common/basehalfMoreMenu.js';

const MORE_ICON_CLASSES = ThemeIcon.asClassNameArray(Codicon.toolBarMore);

/**
 * More, the button of three dots at the right end of the title bar (docs/specs/layout-controls.md, The right
 * group; D155). It is the base's button of the gear under BaseHalf's name and icon: its menu is the base's, in
 * BaseHalf's order, and it shows what waits for the user in Accounts too, since Accounts is in its menu and has
 * no button of its own.
 */
export class BaseHalfMoreButtonViewItem extends SimpleGlobalActivityActionViewItem {

	constructor(
		hoverOptions: IActivityHoverOptions,
		options: IBaseActionViewItemOptions,
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService private readonly titleBarMenuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService private readonly titleBarContextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IActivityService private readonly shownActivityService: IActivityService,
		@IStorageService storageService: IStorageService
	) {
		super(hoverOptions, options, userDataProfileService, themeService, hoverService, titleBarMenuService, contextMenuService, titleBarContextKeyService, configurationService, environmentService, keybindingService, instantiationService, shownActivityService, storageService);

		// The base's button shows the activities of the gear, and sets them again on each change of them, in a
		// listener it registered before this one. This one adds those of Accounts after it.
		this.showActivities();
		this._register(shownActivityService.onDidChangeActivity(changed => {
			if (changed === GLOBAL_ACTIVITY_ID || changed === ACCOUNTS_ACTIVITY_ID) {
				this.showActivities();
			}
		}));
	}

	private showActivities(): void {
		(this.action as CompositeBarAction).activities = [
			...this.shownActivityService.getActivity(GLOBAL_ACTIVITY_ID),
			...this.shownActivityService.getActivity(ACCOUNTS_ACTIVITY_ID)
		];
	}

	/** The base's item under BaseHalf's name and icon: every place that draws or names the button reads it here. */
	protected override get compositeBarActionItem(): ICompositeBarActionItem {
		return { ...super.compositeBarActionItem, name: localize('basehalf.titleBar.more', "More"), classNames: MORE_ICON_CLASSES };
	}

	/**
	 * The name, and what waits. The base names its button after the profile of the window where that is not the
	 * default one; BaseHalf has no profiles to name, and the button is More in every window.
	 */
	protected override computeTitle(): string {
		const waiting = (this.action as CompositeBarAction).activities.map(activity => activity.badge.getDescription()).filter(description => !!description);
		return [this.compositeBarActionItem.name, ...waiting].join(' - ');
	}

	protected override async resolveMainMenuActions(menu: IMenu, _disposables: DisposableStore): Promise<IAction[]> {
		return getActionBarActions(baseHalfMoreMenuGroups(menu.getActions({ renderShortTitle: true }))).secondary;
	}

	/** A secondary click shows the context menu of the title bar, as anywhere else on it. */
	protected override async resolveContextMenuActions(_disposables: DisposableStore): Promise<IAction[]> {
		return getFlatContextMenuActions(this.titleBarMenuService.getMenuActions(MenuId.TitleBarContext, this.titleBarContextKeyService));
	}
}

// Customize Layout: the base's command, which had a button of its own in the title bar.
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: BASEHALF_MORE_MENU_COMMAND_GROUP,
	order: 2,
	command: {
		id: 'workbench.action.customizeLayout',
		title: localize('basehalf.titleBar.more.customizeLayout', "Customize Layout...")
	}
});

// Accounts: the base's Accounts menu as a submenu. It holds what the base and extensions add to that menu, the
// requests to sign in among them.
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: BASEHALF_MORE_MENU_ACCOUNTS_GROUP,
	order: 1,
	title: localize('basehalf.titleBar.more.accounts', "Accounts"),
	submenu: MenuId.AccountsContext
});

// The accounts that are signed in: the base's Accounts button listed them in its menu itself. Manage Accounts is
// the base's command that lists them, with the same for each. It stands before Manage Extension Account
// Preferences, which has the order 100.
MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
	order: 99,
	command: {
		id: 'workbench.action.manageAccounts',
		title: localize('basehalf.titleBar.more.manageAccounts', "Manage Accounts...")
	}
});

/**
 * Gives the title bar BaseHalf's button in place of the base's gear. Registered before the title bar is drawn.
 */
class BaseHalfMoreButtonContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.moreButton';

	constructor(@IActionViewItemService actionViewItemService: IActionViewItemService) {
		super();
		this._register(actionViewItemService.register(MenuId.TitleBar, GLOBAL_ACTIVITY_ID, (_action, options, instantiationService) =>
			instantiationService.createInstance(BaseHalfMoreButtonViewItem, { position: () => HoverPosition.BELOW }, options)));
	}
}

registerWorkbenchContribution2(BaseHalfMoreButtonContribution.ID, BaseHalfMoreButtonContribution, WorkbenchPhase.BlockStartup);

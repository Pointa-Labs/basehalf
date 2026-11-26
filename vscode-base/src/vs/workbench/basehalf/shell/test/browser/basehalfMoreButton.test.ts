/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { toUserDataProfile } from '../../../../../platform/userDataProfile/common/userDataProfile.js';
import { ActivityService } from '../../../../services/activity/browser/activityService.js';
import { IActivityService, NumberBadge } from '../../../../services/activity/common/activity.js';
import { IUserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfile.js';
import { UserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfileService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { BaseHalfMoreButtonViewItem } from '../../browser/basehalfMoreButton.contribution.js';
import { baseHalfMoreMenuGroups } from '../../common/basehalfMoreMenu.js';

const CUSTOMIZE_LAYOUT = 'workbench.action.customizeLayout';
const MANAGE_ACCOUNTS = 'workbench.action.manageAccounts';

/** What BaseHalf adds to a menu, each entry with its group and order (docs/specs/commands-and-menus.md, The menus). */
function added(menu: MenuId): string[] {
	return MenuRegistry.getMenuItems(menu)
		.map(item => isIMenuItem(item) ? { name: item.command.id, item } : { name: `submenu ${item.submenu.id}`, item })
		.filter(({ name }) => [CUSTOMIZE_LAYOUT, MANAGE_ACCOUNTS, `submenu ${MenuId.AccountsContext.id}`].includes(name))
		.map(({ name, item }) => `${item.group ?? '(no group)'} ${item.order}: ${name}`);
}

suite('BaseHalf More button', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('the group of Settings stands first in the More menu, and the others keep their order', () => {
		assert.deepStrictEqual({
			asTheBaseHasThem: baseHalfMoreMenuGroups([['1_command', 'palette'], ['2_configuration', 'settings'], ['3_accounts', 'accounts'], ['5_new', 'of a base update'], ['7_update', 'update']]).map(([group]) => group),
			withoutSettings: baseHalfMoreMenuGroups([['1_command', 'palette'], ['7_update', 'update']]).map(([group]) => group),
			empty: baseHalfMoreMenuGroups([])
		}, {
			asTheBaseHasThem: ['2_configuration', '1_command', '3_accounts', '5_new', '7_update'],
			withoutSettings: ['1_command', '7_update'],
			empty: []
		});
	});

	test('the More menu holds Customize Layout and Accounts, and Accounts holds Manage Accounts', () => {
		assert.deepStrictEqual({
			more: added(MenuId.GlobalActivity),
			accounts: added(MenuId.AccountsContext),
			// The title bar's own tool bars hold neither: Customize Layout is no button.
			titleBar: [...added(MenuId.TitleBar), ...added(MenuId.TitleBarLeft)]
		}, {
			more: [`1_command 2: ${CUSTOMIZE_LAYOUT}`, `3_accounts 1: submenu ${MenuId.AccountsContext.id}`],
			accounts: [`(no group) 99: ${MANAGE_ACCOUNTS}`],
			titleBar: []
		});
	});

	test('More is named More, is drawn as three dots, and shows what waits for the application and in Accounts', () => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const activityService = disposables.add(instantiationService.createInstance(ActivityService));
		instantiationService.stub(IActivityService, activityService);
		const more = disposables.add(instantiationService.createInstance(BaseHalfMoreButtonViewItem, { position: () => HoverPosition.BELOW }, {}));
		const container = $('div');
		more.render(container);

		const label = container.querySelector('.action-label')!;
		const shown = () => `${label.getAttribute('aria-label')} [${container.querySelector('.badge-content')?.textContent ?? ''}]`;
		const states = [shown()];
		const update = activityService.showGlobalActivity({ badge: new NumberBadge(1, () => 'an update') });
		states.push(shown());
		const request = activityService.showAccountsActivity({ badge: new NumberBadge(2, () => 'two requests') });
		states.push(shown());
		update.dispose();
		states.push(shown());
		const again = activityService.showGlobalActivity({ badge: new NumberBadge(1, () => 'an update') });
		states.push(shown());
		request.dispose();
		states.push(shown());
		again.dispose();
		states.push(shown());

		// A window of a profile: the base names its button after the profile.
		instantiationService.stub(IUserDataProfileService, disposables.add(new UserDataProfileService(toUserDataProfile('work', 'work', URI.file('/profiles/work'), URI.file('/cache/work')))));
		const ofAProfile = disposables.add(instantiationService.createInstance(BaseHalfMoreButtonViewItem, { position: () => HoverPosition.BELOW }, {}));
		const profileContainer = $('div');
		ofAProfile.render(profileContainer);

		assert.deepStrictEqual({
			icon: [...label.classList].filter(name => name.startsWith('codicon-')),
			inAWindowOfAProfile: profileContainer.querySelector('.action-label')!.getAttribute('aria-label'),
			states
		}, {
			icon: ['codicon-toolbar-more'],
			inAWindowOfAProfile: 'More',
			states: [
				'More []',
				'More - an update [1]',
				'More - an update - two requests [3]',
				'More - two requests [2]',
				'More - an update - two requests [3]',
				'More - an update [1]',
				'More []'
			]
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { decodeKeybinding } from '../../../../../base/common/keybindings.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import '../../../../browser/actions/layoutActions.js';
import '../../../../browser/parts/auxiliarybar/auxiliaryBarActions.js';
import '../../../../browser/parts/panel/panelActions.js';

const SIDEBAR = 'workbench.action.toggleSidebarVisibility';
const AGENT_AREA = 'workbench.action.toggleAuxiliaryBar';
const PANEL = 'workbench.action.togglePanel';

/**
 * The layout controls that a title bar menu shows under the given settings,
 * in the order of the menu (docs/specs/layout-controls.md).
 */
function layoutControls(menu: MenuId, settings: Record<string, unknown>): string[] {
	const context = {
		getValue: <T>(key: string) => ({
			'config.workbench.sideBar.location': 'left',
			'config.workbench.layoutControl.type': 'both',
			'config.workbench.layoutControl.enabled': true,
			...settings
		} as Record<string, unknown>)[key] as T | undefined
	};
	return MenuRegistry.getMenuItems(menu)
		.filter(isIMenuItem)
		.filter(item => item.group === 'navigation' && [SIDEBAR, AGENT_AREA, PANEL].includes(item.command.id))
		.filter(item => !item.when || item.when.evaluate(context))
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
		.map(item => item.command.id);
}

suite('BaseHalf layout controls', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the control of the left side part is at the left end of the title bar', () => {
		assert.deepStrictEqual({
			left: layoutControls(MenuId.TitleBarLeft, {}),
			right: layoutControls(MenuId.LayoutControlMenu, {})
		}, {
			left: [SIDEBAR],
			right: [AGENT_AREA]
		});
	});

	test('with the sidebar on the right, the left end holds the control of the Agent Area', () => {
		const settings = { 'config.workbench.sideBar.location': 'right' };
		assert.deepStrictEqual({
			left: layoutControls(MenuId.TitleBarLeft, settings),
			right: layoutControls(MenuId.LayoutControlMenu, settings)
		}, {
			left: [AGENT_AREA],
			right: [SIDEBAR]
		});
	});

	test('the panel has no control in the title bar or the View menu, and keeps Cmd+J', () => {
		const menusOf = (command: string) => [MenuId.TitleBarLeft, MenuId.LayoutControlMenu, MenuId.LayoutControlMenuSubmenu, MenuId.MenubarAppearanceMenu, MenuId.CommandPalette]
			.filter(menu => MenuRegistry.getMenuItems(menu).some(item => isIMenuItem(item) && item.command.id === command))
			.map(menu => menu.id);
		const cmdJ = decodeKeybinding(KeyMod.CtrlCmd | KeyCode.KeyJ, OperatingSystem.Macintosh)?.getHashCode();
		assert.deepStrictEqual({
			panel: menusOf(PANEL),
			agentArea: menusOf(AGENT_AREA),
			cmdJ: KeybindingsRegistry.getDefaultKeybindingsForOS(OperatingSystem.Macintosh)
				.filter(item => item.keybinding?.getHashCode() === cmdJ && !item.when)
				.map(item => item.command)
		}, {
			panel: ['CommandPalette'],
			agentArea: ['TitleBarLeft', 'LayoutControlMenu', 'LayoutControlMenuSubmenu', 'MenubarAppearanceMenu', 'CommandPalette'],
			cmdJ: [PANEL]
		});
	});

	test('the control at the left end follows the settings of the layout controls', () => {
		assert.deepStrictEqual({
			switchedOff: layoutControls(MenuId.TitleBarLeft, { 'config.workbench.layoutControl.enabled': false }),
			asMenu: layoutControls(MenuId.TitleBarLeft, { 'config.workbench.layoutControl.type': 'menu' }),
			asToggles: layoutControls(MenuId.TitleBarLeft, { 'config.workbench.layoutControl.type': 'toggles' }),
			auxiliaryWindow: layoutControls(MenuId.TitleBarLeft, { 'isAuxiliaryWindow': true })
		}, {
			switchedOff: [],
			asMenu: [],
			asToggles: [SIDEBAR],
			auxiliaryWindow: []
		});
	});
});

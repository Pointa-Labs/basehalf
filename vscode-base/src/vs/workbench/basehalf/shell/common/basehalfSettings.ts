/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** The pages of BaseHalf's Settings (BaseHalf's pages in Settings), in the order of its list. */
export const BASEHALF_SETTINGS_PAGES = ['general', 'canvas', 'notes', 'agentArea', 'providers', 'about'] as const;
export type BaseHalfSettingsPageId = typeof BASEHALF_SETTINGS_PAGES[number];
/** The pages that are a list of settings. */
export type BaseHalfSettingsListPageId = Exclude<BaseHalfSettingsPageId, 'providers' | 'about'>;

export function isBaseHalfSettingsPageId(value: unknown): value is BaseHalfSettingsPageId {
	return typeof value === 'string' && (BASEHALF_SETTINGS_PAGES as readonly string[]).includes(value);
}

/** Settings of the More menu, of the application menu, and of its key: BaseHalf's Settings. */
export const BASEHALF_OPEN_SETTINGS_COMMAND_ID = 'basehalf.settings.open';
/** The Settings editor of the base, which lists every setting that does something in BaseHalf. */
export const BASEHALF_OPEN_ADVANCED_SETTINGS_COMMAND_ID = 'basehalf.settings.openAdvanced';
/** Keyboard Shortcuts of the base, which lists the commands of BaseHalf with their keys. */
export const BASEHALF_OPEN_KEYBOARD_SHORTCUTS_COMMAND_ID = 'workbench.action.openGlobalKeybindings';

export const IBaseHalfSettingsService = createDecorator<IBaseHalfSettingsService>('baseHalfSettingsService');

export interface IBaseHalfSettingsService {
	readonly _serviceBrand: undefined;

	/**
	 * Opens BaseHalf's Settings at a page: the page it showed last while it is open, and General
	 * otherwise, when none is given. `input` is what the page should show, in the page's own form.
	 */
	open(page?: BaseHalfSettingsPageId, input?: string): Promise<void>;
}

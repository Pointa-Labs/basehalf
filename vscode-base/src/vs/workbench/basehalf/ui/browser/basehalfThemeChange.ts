/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfThemeChange.css';
import { getWindow, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';

/** The class the workbench's root has while a change of the theme is drawn. */
export const BASEHALF_THEME_CHANGING_CLASS = 'basehalf-theme-changing';

/**
 * Keeps a change of the theme from gliding (light and dark, rule 25). The theme service gives the window the new
 * colors and tells of the change in one task, before a frame is drawn: the class set here is in the first style
 * the new colors are computed with, so no transition starts from the old palette. Two frames later the class
 * goes: the new palette is drawn by then, and a transition that would start finds no change.
 */
export function keepBaseHalfThemeChangesInstant(container: HTMLElement, themeService: IThemeService): IDisposable {
	const store = new DisposableStore();
	const frames = store.add(new MutableDisposable<DisposableStore>());
	store.add(themeService.onDidColorThemeChange(() => {
		container.classList.add(BASEHALF_THEME_CHANGING_CLASS);
		const pending = new DisposableStore();
		frames.value = pending;
		const targetWindow = getWindow(container);
		pending.add(scheduleAtNextAnimationFrame(targetWindow, () => {
			pending.add(scheduleAtNextAnimationFrame(targetWindow, () => container.classList.remove(BASEHALF_THEME_CHANGING_CLASS)));
		}));
	}));
	store.add({ dispose: () => container.classList.remove(BASEHALF_THEME_CHANGING_CLASS) });
	return store;
}

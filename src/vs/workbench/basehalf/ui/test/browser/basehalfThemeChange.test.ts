/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { BASEHALF_THEME_CHANGING_CLASS, keepBaseHalfThemeChangesInstant } from '../../browser/basehalfThemeChange.js';

suite('BaseHalf: a change of the theme shows at once', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const frame = () => new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));

	test('nothing glides in the frames a change of the theme is drawn in', async () => {
		const container = mainWindow.document.createElement('div');
		container.className = 'monaco-workbench';
		const card = container.appendChild(mainWindow.document.createElement('div'));
		card.style.transition = 'background 150ms';
		mainWindow.document.body.appendChild(container);
		try {
			const themeService = new TestThemeService();
			store.add(keepBaseHalfThemeChangesInstant(container, themeService));
			const duration = () => mainWindow.getComputedStyle(card).transitionDuration;
			const before = { changing: container.classList.contains(BASEHALF_THEME_CHANGING_CLASS), duration: duration() };
			themeService.fireThemeChange();
			// In the task of the change, before a frame is drawn.
			const atChange = { changing: container.classList.contains(BASEHALF_THEME_CHANGING_CLASS), duration: duration() };
			await frame();
			await frame();
			await frame();
			const after = { changing: container.classList.contains(BASEHALF_THEME_CHANGING_CLASS), duration: duration() };
			assert.deepStrictEqual({ before, atChange, after }, {
				before: { changing: false, duration: '0.15s' },
				atChange: { changing: true, duration: '0s' },
				after: { changing: false, duration: '0.15s' }
			});
		} finally {
			container.remove();
		}
	});
});

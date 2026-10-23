/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { setBaseHalfHover, setupBaseHalfHovers } from '../../browser/basehalfHover.js';

suite('BaseHalfHover', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let root: HTMLElement;
	setup(() => {
		root = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(root);
	});
	teardown(() => root.remove());

	test('the workbench\'s hover shows the text an element asks for, also over its icon and when the element came later, and no system tooltip is set', () => {
		const shown: string[] = [];
		const hoverService: IHoverService = {
			...NullHoverService,
			showDelayedHover: (options, lifecycle) => {
				shown.push(`${(options.target as HTMLElement).className}: ${options.content} (${lifecycle.groupId})`);
				return undefined;
			}
		};
		store.add(setupBaseHalfHovers(root, hoverService));
		const button = mainWindow.document.createElement('button');
		button.className = 'tidy';
		const icon = mainWindow.document.createElement('span');
		button.appendChild(icon);
		root.appendChild(button);
		setBaseHalfHover(button, 'Tidy Canvas');
		const name = mainWindow.document.createElement('span');
		name.className = 'name';
		root.appendChild(name);
		// A child that keeps its pointer events to itself still has the hover of its button.
		icon.addEventListener('mouseover', event => event.stopPropagation());

		icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		name.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		setBaseHalfHover(button, undefined);
		button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		assert.deepStrictEqual({ shown, title: button.hasAttribute('title'), attribute: button.hasAttribute('data-basehalf-hover') }, {
			shown: ['tidy: Tidy Canvas (basehalf-hover)'],
			title: false,
			attribute: false
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { hideBaseHalfHoverOfRenamedButton, setBaseHalfHover, setupBaseHalfHovers } from '../../browser/basehalfHover.js';

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

	test('a hover that an element shows or waits to show goes when the element gets another text, and the pointer that comes again shows the new one; the same text keeps it (generation cards, "The player")', () => {
		const hovers: { readonly content: string; disposed: boolean }[] = [];
		const hoverService: IHoverService = {
			...NullHoverService,
			showDelayedHover: options => {
				const hover = { content: String(options.content), disposed: false, isDisposed: false, dispose() { hover.disposed = true; } };
				hovers.push(hover);
				return hover;
			}
		};
		store.add(setupBaseHalfHovers(root, hoverService));
		const play = mainWindow.document.createElement('button');
		root.appendChild(play);
		setBaseHalfHover(play, 'Play');

		play.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		setBaseHalfHover(play, 'Play');
		const same = hovers.map(hover => hover.disposed);
		// The sound starts: the button says Pause, and the hover that says Play goes.
		setBaseHalfHover(play, 'Pause');
		play.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		assert.deepStrictEqual({ same, hovers: hovers.map(hover => `${hover.content}${hover.disposed ? ' (gone)' : ''}`) }, {
			same: [false],
			hovers: ['Play (gone)', 'Pause']
		});
	});

	test('a button whose hover the hover service draws takes away the hover of its former name only while the pointer is on it', () => {
		const hidden: (boolean | undefined)[] = [];
		const hoverService: IHoverService = { ...NullHoverService, hideHover: force => { hidden.push(force); } };
		const play = mainWindow.document.createElement('button');
		root.appendChild(play);
		let pointerOnIt = true;
		// A test cannot put the pointer on an element: the button says whether it is.
		Object.defineProperty(play, 'matches', { value: (selector: string) => selector === ':hover' ? pointerOnIt : Element.prototype.matches.call(play, selector) });

		hideBaseHalfHoverOfRenamedButton(play, hoverService);
		pointerOnIt = false;
		hideBaseHalfHoverOfRenamedButton(play, hoverService);
		assert.deepStrictEqual(hidden, [true]);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfGenerationReferenceMenu, IBaseHalfReferenceMenuDelegate } from '../../browser/basehalfGenerationReferenceMenu.js';
import { IBaseHalfReferenceMenuModel } from '../../common/basehalfGenerationReferenceMenu.js';

const MODEL: IBaseHalfReferenceMenuModel = {
	connected: [
		{ path: 'shots/caocao.png', kind: 'image', title: '曹操.png', label: '图片1' },
		{ path: 'shots/dufu.png', kind: 'image', title: '杜甫.png', label: '图片2' }
	],
	canvas: [
		{
			kind: 'image', items: [
				{ path: 'shots/caocao.png', kind: 'image', title: '曹操.png', label: '图片1' },
				{ path: 'shots/dufu.png', kind: 'image', title: '杜甫.png', label: '图片2' },
				{ path: 'shots/liubang.png', kind: 'image', title: '刘邦.png' }
			]
		},
		{ kind: 'video', items: [{ path: 'shots/caocao.mp4', kind: 'video', title: '曹操.mp4' }], disabled: 'Acme Image 1 takes no videos.' },
		{ kind: 'audio', items: [] }
	]
};

suite('BaseHalfGenerationReferenceMenu (D68)', () => {
	const disposables = new DisposableStore();
	let calls: string[];
	let layer: HTMLElement;

	const delegate: IBaseHalfReferenceMenuDelegate = {
		choose: item => calls.push(`choose ${item.path}`),
		dismiss: () => calls.push('dismiss'),
		canvasBounds: () => ({ left: 0, top: 0, width: 1200, height: 900 })
	};

	function open(): BaseHalfGenerationReferenceMenu {
		const menu = disposables.add(new BaseHalfGenerationReferenceMenu(MODEL, delegate, layer, () => new DOMRect(200, 200, 1, 20)));
		menu.focus();
		return menu;
	}

	function search(): HTMLInputElement {
		return layer.querySelector('.bh-reference-menu-search input') as HTMLInputElement;
	}

	function key(name: string, init: KeyboardEventInit = {}): void {
		search().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
	}

	/** The options of the menu and of the list beside it, the current one marked. */
	function options(): { readonly menu: string[]; readonly flyout: string[] } {
		const read = (container: Element | null) => container
			? [...container.getElementsByClassName('bh-reference-menu-option')].map(option => `${option.classList.contains('active') ? '> ' : ''}${option.getElementsByClassName('bh-reference-menu-title')[0]?.textContent}${option.classList.contains('disabled') ? ' (dimmed)' : ''}`)
			: [];
		return { menu: read(layer.querySelector('.bh-reference-menu:not(.flyout)')), flyout: read(layer.querySelector('.bh-reference-menu.flyout')) };
	}

	setup(() => {
		calls = [];
		layer = mainWindow.document.createElement('div');
		Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '1200px', height: '900px' });
		mainWindow.document.body.append(layer);
	});
	teardown(() => {
		disposables.clear();
		layer.remove();
	});
	ensureNoDisposablesAreLeakedInTestSuite();

	test('opens with the keyboard in its search field and the first item current; Down, Up, and Enter choose', () => {
		open();
		const opened = { focused: mainWindow.document.activeElement === search(), options: options() };
		key('ArrowDown');
		key('ArrowDown');
		key('ArrowUp');
		key('Enter');
		assert.deepStrictEqual({ opened, calls }, {
			opened: { focused: true, options: { menu: ['> 曹操.png', '杜甫.png', 'Images', 'Videos (dimmed)', 'Audio'], flyout: [] } },
			calls: ['choose shots/dufu.png']
		});
	});

	test('Right opens the list of a kind beside the menu, Enter chooses a card there, and Left goes back', () => {
		open();
		key('ArrowDown');
		key('ArrowDown');
		key('ArrowRight');
		const flyout = options();
		key('ArrowDown');
		key('ArrowDown');
		key('Enter');
		key('ArrowLeft');
		assert.deepStrictEqual({ flyout, back: options(), calls }, {
			flyout: { menu: ['曹操.png', '杜甫.png', '> Images', 'Videos (dimmed)', 'Audio'], flyout: ['> 曹操.png', '杜甫.png', '刘邦.png'] },
			back: { menu: ['曹操.png', '杜甫.png', '> Images', 'Videos (dimmed)', 'Audio'], flyout: [] },
			calls: ['choose shots/liubang.png']
		});
	});

	test('a dimmed kind does not open, and a dimmed card cannot be chosen', () => {
		open();
		key('ArrowDown');
		key('ArrowDown');
		key('ArrowDown');
		key('ArrowRight');
		key('Enter');
		search().value = 'mp4';
		search().dispatchEvent(new InputEvent('input', { bubbles: true }));
		const found = options();
		key('Enter');
		(layer.getElementsByClassName('bh-reference-menu-option')[0] as HTMLElement).click();
		assert.deepStrictEqual({ found, calls }, {
			found: { menu: ['> 曹操.mp4 (dimmed)'], flyout: [] },
			calls: []
		});
	});

	test('a search typed with an input method filters once the composition ends', () => {
		open();
		search().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		search().value = 'li';
		search().dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
		const composing = options().menu;
		search().value = '刘';
		search().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		assert.deepStrictEqual({ composing, ended: options().menu }, {
			composing: ['> 曹操.png', '杜甫.png', 'Images', 'Videos (dimmed)', 'Audio'],
			ended: ['> 刘邦.png']
		});
	});

	test('Escape closes the list of a kind first and then the menu; Tab and a click outside close it too', () => {
		open();
		key('ArrowDown');
		key('ArrowDown');
		key('ArrowRight');
		key('Escape');
		const afterFirst = options().flyout.length;
		key('Escape');
		key('Tab');
		mainWindow.document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		assert.deepStrictEqual({ afterFirst, calls }, { afterFirst: 0, calls: ['dismiss', 'dismiss', 'dismiss'] });
	});
});

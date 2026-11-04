/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfCanvasCardMark } from '../../browser/basehalfCanvasExtensions.js';
import { BaseHalfCanvasCardMarks } from '../../browser/view/basehalfCanvasCardMarks.js';

suite('BaseHalf canvas card marks', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create() {
		const renderedCardElementsByPath = new Map<string, HTMLElement>();
		const marks = new BaseHalfCanvasCardMarks({ renderedCardElementsByPath });
		const card = document.createElement('div');
		const identity = document.createElement('div');
		const content = document.createElement('div');
		renderedCardElementsByPath.set('a.ts', card);
		const listeners = store.add(new DisposableStore());
		marks.attachCard(card, 'a.ts', identity, content, listeners);
		return { marks, card, identity, content, listeners };
	}

	const mark = (overrides: Partial<IBaseHalfCanvasCardMark> = {}): IBaseHalfCanvasCardMark => ({
		labelClassName: 'monaco-decoration-itemColor-m',
		badgeClassName: 'monaco-decoration-itemBadge-m',
		title: 'Show Changes',
		...overrides
	});

	function press(letter: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
		letter.dispatchEvent(new PointerEvent('pointerdown', { clientX: from.x, clientY: from.y, bubbles: true }));
		letter.dispatchEvent(new MouseEvent('click', { clientX: to.x, clientY: to.y, bubbles: true }));
	}

	test('a mark goes on the name and the face, and comes off', () => {
		const { marks, identity, content } = create();
		marks.set(new Map([['a.ts', mark()]]));
		assert.deepStrictEqual([...identity.classList], ['basehalf-canvas-card-changed', 'monaco-decoration-itemColor-m']);
		assert.deepStrictEqual([...identity.children].map(child => [...child.classList]), [['basehalf-canvas-card-change', 'monaco-decoration-itemBadge-m', 'passive']]);
		assert.strictEqual(content.children.length, 1);
		marks.set(new Map());
		assert.deepStrictEqual([...identity.classList], []);
		assert.strictEqual(identity.children.length, 0);
		assert.strictEqual(content.children.length, 0);
	});

	test('a card drawn anew gets its mark, and a face drawn anew gets its bar back', () => {
		const { marks, card, identity, content, listeners } = create();
		marks.set(new Map([['a.ts', mark()]]));
		content.textContent = '';
		assert.strictEqual(content.children.length, 0);
		marks.faceDrawn(card);
		assert.strictEqual(content.children.length, 1);

		const again = document.createElement('div');
		const againIdentity = document.createElement('div');
		marks.attachCard(again, 'a.ts', againIdentity, document.createElement('div'), listeners);
		assert.strictEqual(againIdentity.classList.contains('basehalf-canvas-card-changed'), true);
		assert.strictEqual(identity.classList.contains('basehalf-canvas-card-changed'), true);
	});

	test('a click on the letter opens, selects no card, and a drag from it opens nothing', () => {
		const { marks, identity } = create();
		let opened = 0;
		let reachedCard = 0;
		identity.addEventListener('click', () => reachedCard++);
		marks.set(new Map([['a.ts', mark({ open: () => opened++ })]]));
		const letter = identity.lastElementChild as HTMLElement;
		assert.strictEqual(letter.classList.contains('passive'), false);
		press(letter, { x: 10, y: 10 }, { x: 11, y: 12 });
		assert.strictEqual(opened, 1);
		assert.strictEqual(reachedCard, 0);
		press(letter, { x: 10, y: 10 }, { x: 60, y: 40 });
		assert.strictEqual(opened, 1);
	});

	test('a mark that comes anew and looks the same keeps its letter, so that a press on it keeps its click, and it runs the new mark', () => {
		const { marks, identity } = create();
		const opened: string[] = [];
		marks.set(new Map([['a.ts', mark({ open: () => opened.push('first') })]]));
		const letter = identity.lastElementChild as HTMLElement;
		letter.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
		marks.set(new Map([['a.ts', mark({ open: () => opened.push('second') })]]));
		assert.strictEqual(identity.lastElementChild, letter);
		letter.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10, bubbles: true }));
		assert.deepStrictEqual(opened, ['second']);

		marks.set(new Map([['a.ts', mark({ badgeClassName: 'monaco-decoration-itemBadge-u', open: () => opened.push('third') })]]));
		assert.notStrictEqual(identity.lastElementChild, letter);
		marks.set(new Map());
	});

	test('the rows of a folder say what a feature says of them, and only while the folder has a mark', () => {
		const { marks, card } = create();
		const row = document.createElement('div');
		const other = document.createElement('div');
		marks.set(new Map([['a.ts', mark({
			rowMark: name => name === 'changed.ts' ? { labelClassName: 'monaco-decoration-itemColor-r', badgeClassName: 'monaco-decoration-itemBadge-r' } : undefined
		})]]));
		marks.attachFolderRows(card, new Map([['changed.ts', { row, isFolder: false }], ['same.ts', { row: other, isFolder: false }]]));
		assert.strictEqual(row.classList.contains('monaco-decoration-itemColor-r'), true);
		assert.strictEqual(row.children.length, 1);
		assert.strictEqual(other.children.length, 0);
		marks.set(new Map());
		assert.strictEqual(row.classList.contains('monaco-decoration-itemColor-r'), false);
		assert.strictEqual(row.children.length, 0);
	});
});

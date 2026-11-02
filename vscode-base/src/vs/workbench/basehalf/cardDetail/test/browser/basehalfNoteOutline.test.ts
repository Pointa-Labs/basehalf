/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfNoteOutlineHeadings } from '../../browser/basehalfNoteOutline.js';

suite('BaseHalfNoteOutline', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the headings of a page are its heading elements with text, in order', () => {
		const root = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(root);
		try {
			root.innerHTML = '<h1>Top</h1><p># not a heading</p><pre><code># a comment</code></pre><h3> Deep  part </h3><h2></h2><div><h2>In HTML</h2></div>';
			assert.deepStrictEqual(baseHalfNoteOutlineHeadings(root).map(heading => [heading.level, heading.name]), [[1, 'Top'], [3, 'Deep part'], [2, 'In HTML']]);
			assert.deepStrictEqual(baseHalfNoteOutlineHeadings(undefined), []);
		} finally {
			root.remove();
		}
	});

	test('a heading in a closed toggle, or hidden, is not in the outline (rule 9)', () => {
		const root = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(root);
		try {
			root.innerHTML = '<h1>Shown</h1><details><summary>Closed</summary><h2>In a closed toggle</h2></details><details open><summary>Open</summary><h2>In an open toggle</h2></details><div style="display: none"><h2>Hidden</h2></div>';
			assert.deepStrictEqual(baseHalfNoteOutlineHeadings(root).map(heading => heading.name), ['Shown', 'In an open toggle']);
		} finally {
			root.remove();
		}
	});
});

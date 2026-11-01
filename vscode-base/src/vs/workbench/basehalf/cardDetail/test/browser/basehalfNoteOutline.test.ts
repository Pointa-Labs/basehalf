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
		root.innerHTML = '<h1>Top</h1><p># not a heading</p><pre><code># a comment</code></pre><h3> Deep  part </h3><h2></h2><div><h2>In HTML</h2></div>';
		assert.deepStrictEqual(baseHalfNoteOutlineHeadings(root).map(heading => [heading.level, heading.name]), [[1, 'Top'], [3, 'Deep part'], [2, 'In HTML']]);
		assert.deepStrictEqual(baseHalfNoteOutlineHeadings(undefined), []);
	});
});

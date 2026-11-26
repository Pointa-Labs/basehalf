/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfTerminalClickAction } from '../../common/basehalfTerminalClicks.js';

suite('BaseHalfTerminalClicks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a secondary click follows rightClickBehavior, and Shift shows the menu', () => {
		const secondary = (rightClickBehavior: unknown) => [
			baseHalfTerminalClickAction({ button: 'secondary', shiftKey: false, hasSelection: false }, { rightClickBehavior, middleClickBehavior: 'default' }),
			baseHalfTerminalClickAction({ button: 'secondary', shiftKey: false, hasSelection: true }, { rightClickBehavior, middleClickBehavior: 'default' }),
			baseHalfTerminalClickAction({ button: 'secondary', shiftKey: true, hasSelection: true }, { rightClickBehavior, middleClickBehavior: 'default' })
		];
		assert.deepStrictEqual(
			Object.fromEntries(['default', 'selectWord', 'copyPaste', 'paste', 'nothing', undefined].map(value => [String(value), secondary(value)])),
			{
				default: ['menu', 'menu', 'menu'],
				selectWord: ['menu', 'menu', 'menu'],
				copyPaste: ['paste', 'copy', 'menu'],
				paste: ['paste', 'paste', 'menu'],
				nothing: ['none', 'none', 'menu'],
				undefined: ['menu', 'menu', 'menu']
			}
		);
	});

	test('a middle click pastes with middleClickBehavior as paste, and gives the terminal the keyboard otherwise', () => {
		assert.deepStrictEqual(
			['default', 'paste', undefined].map(middleClickBehavior => baseHalfTerminalClickAction({ button: 'middle', shiftKey: false, hasSelection: true }, { rightClickBehavior: 'nothing', middleClickBehavior })),
			['focus', 'paste', 'focus']
		);
	});
});

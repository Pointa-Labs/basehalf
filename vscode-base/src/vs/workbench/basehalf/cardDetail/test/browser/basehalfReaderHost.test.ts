/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { KeyCodeChord } from '../../../../../base/common/keybindings.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import '../../browser/basehalfCardDetailProjections.contribution.js';

/** The keys of the reader that zoom the document and never the window (PDFs and books, rules 22 and 24). */
suite('BaseHalfReaderHost', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('while a reader has the keyboard, Cmd+= and Cmd+- are its own, and Cmd+0 a PDF\'s, over the window\'s zoom', () => {
		const rules = KeybindingsRegistry.getDefaultKeybindings().filter(rule => rule.command === 'basehalf.reader.zoomKeys' || rule.command === 'basehalf.reader.zoomReset');
		const keys = (command: string) => rules.filter(rule => rule.command === command).map(rule => { const chord = rule.keybinding?.chords[0]; return chord instanceof KeyCodeChord ? chord.keyCode : undefined; });
		assert.deepStrictEqual({
			zoom: keys('basehalf.reader.zoomKeys').length,
			reset: keys('basehalf.reader.zoomReset').length,
			above: rules.every(rule => rule.weight1 > KeybindingWeight.WorkbenchContrib),
			when: [...new Set(rules.map(rule => rule.when?.serialize()))].sort()
		}, {
			zoom: 6,
			reset: 2,
			above: true,
			when: ['basehalfReaderFocus == \'book\' || basehalfReaderFocus == \'pdf\'', 'basehalfReaderFocus == \'pdf\''].sort()
		});
		assert.ok(keys('basehalf.reader.zoomKeys').includes(KeyCode.Equal) && keys('basehalf.reader.zoomKeys').includes(KeyCode.Minus) && keys('basehalf.reader.zoomReset').includes(KeyCode.Digit0));
	});
});

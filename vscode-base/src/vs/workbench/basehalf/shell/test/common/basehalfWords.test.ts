/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_WORDS, hasBaseWords, toBaseHalfWords } from '../../common/basehalfWords.js';

suite('BaseHalfWords', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('every name of the base\'s for a part of the window reads in BaseHalf\'s words', () => {
		assert.deepStrictEqual(
			[
				// The buttons of the title bar, and the commands of the Command Palette and Keyboard Shortcuts.
				'Toggle Primary Side Bar',
				'Toggle Secondary Side Bar',
				'Toggle Primary Side Bar Visibility',
				'Toggle Secondary Side Bar Visibility',
				'View: Toggle Secondary Side Bar Visibility',
				'Focus into Primary Side Bar',
				'Focus into Secondary Side Bar',
				'Close Primary Side Bar',
				'Hide Secondary Side Bar',
				'Maximize Secondary Side Bar',
				'Toggle Maximized Secondary Side Bar',
				'Next Primary Side Bar View',
				// The application menu, with the letter it underlines.
				'&&Primary Side Bar',
				'&&Secondary Side Bar',
				// Customize Layout and Open View.
				'Primary Side Bar',
				'Secondary Side Bar',
				'Side Bar',
				'Side Bar / Explorer',
				'Secondary Side Bar / Agent',
				// What a screen reader hears.
				'Primary Side Bar hidden',
				'Secondary Side Bar shown',
				// The descriptions of settings.
				'Controls whether view headers, side bar titles, and panel tabs use uppercase text.',
				'Controls the default visibility of the secondary side bar in workspaces or empty windows.',
				'Open/Show and Close/Hide Secondary Side Bar',
				'Hide the Activity Bar in the Primary and Secondary Side Bars.'
			].map(toBaseHalfWords),
			[
				'Toggle Sidebar',
				'Toggle Agent Area',
				'Toggle Sidebar',
				'Toggle Agent Area',
				'View: Toggle Agent Area',
				'Focus into Sidebar',
				'Focus into Agent Area',
				'Close Sidebar',
				'Hide Agent Area',
				'Maximize Agent Area',
				'Toggle Maximized Agent Area',
				'Next Sidebar View',
				'&&Sidebar',
				'&&Agent Area',
				'Sidebar',
				'Agent Area',
				'Sidebar',
				'Sidebar / Explorer',
				'Agent Area / Agent',
				'Sidebar hidden',
				'Agent Area shown',
				'Controls whether view headers, sidebar titles, and panel tabs use uppercase text.',
				'Controls the default visibility of the Agent Area in workspaces or empty windows.',
				'Open/Show and Close/Hide Agent Area',
				'Hide the Activity Bar in the Sidebar and Agent Area.'
			]
		);
	});

	test('a text that names no part stays as it is, and so does a word BaseHalf\'s users know by the base\'s name', () => {
		const same = [
			'',
			'Toggle Agent Area',
			'Toggle Sidebar',
			'Toggle Modal Editor Sidebar',
			'Show Command Palette',
			'Open Keyboard Shortcuts',
			'Focus Status Bar',
			'Source Control',
			'Explorer',
			'Close Editor',
			'workbench.action.toggleSidebarVisibility',
			'sideBarVisible && !auxiliaryBarVisible',
			'Hide Title Bar',
			'Inside Baseball'
		];
		assert.deepStrictEqual(same.map(toBaseHalfWords), same);
		assert.deepStrictEqual(same.filter(hasBaseWords), []);
	});

	test('no word of BaseHalf\'s holds a word of the base\'s, and no entry is there twice', () => {
		assert.deepStrictEqual(BASEHALF_WORDS.filter(word => hasBaseWords(word.basehalf)), []);
		assert.strictEqual(new Set(BASEHALF_WORDS.map(word => word.base)).size, BASEHALF_WORDS.length);
		// A text in BaseHalf's words is in BaseHalf's words: the function changes nothing a second time.
		assert.deepStrictEqual(BASEHALF_WORDS.map(word => toBaseHalfWords(toBaseHalfWords(word.base))), BASEHALF_WORDS.map(word => word.basehalf));
	});
});

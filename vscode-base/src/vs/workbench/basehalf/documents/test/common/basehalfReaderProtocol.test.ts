/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfReaderCommandMessage, baseHalfReaderPageMessage, DEFAULT_BASEHALF_READER_PANEL_STATE, normalizeBaseHalfReaderPanelState } from '../../common/basehalfReaderProtocol.js';

suite('BaseHalfReaderProtocol', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps whether each panel is open and the tab of the panel at the left, and nothing of another shape (PDFs and books, rule 18)', () => {
		assert.deepStrictEqual([
			normalizeBaseHalfReaderPanelState({ open: true, tab: 'pages', comments: true }),
			normalizeBaseHalfReaderPanelState({ open: true, tab: 'contents' }),
			// Comments is a panel of its own, no tab.
			normalizeBaseHalfReaderPanelState({ open: true, tab: 'comments', comments: 'yes' }),
			normalizeBaseHalfReaderPanelState(undefined),
			normalizeBaseHalfReaderPanelState('open')
		], [
			{ open: true, tab: 'pages', comments: true },
			{ open: true, tab: 'contents', comments: false },
			{ open: true, tab: 'contents', comments: false },
			DEFAULT_BASEHALF_READER_PANEL_STATE,
			DEFAULT_BASEHALF_READER_PANEL_STATE
		]);
		assert.deepStrictEqual(baseHalfReaderPageMessage({ type: 'basehalf.reader.panel', state: { open: false, tab: 'pages', comments: true } }), { type: 'basehalf.reader.panel', state: { open: false, tab: 'pages', comments: true } });
	});

	test('reads Sidebar, Find, and Comments of the header, and no other command (PDFs and books, rule 15)', () => {
		assert.deepStrictEqual(['toggleSidebar', 'find', 'toggleComments', 'search', 'close'].map(command => baseHalfReaderCommandMessage({ type: 'basehalf.reader.command', command })?.command), [
			'toggleSidebar', 'find', 'toggleComments', undefined, undefined
		]);
	});
});

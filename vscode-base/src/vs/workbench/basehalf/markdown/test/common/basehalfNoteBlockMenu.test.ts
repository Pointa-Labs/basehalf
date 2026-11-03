/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_NOTE_MENU_ENTRIES, baseHalfNoteMenuSide, rankBaseHalfNoteMenuRows } from '../../common/basehalfNoteBlockMenu.js';

const rows = [
	{ title: 'Paragraph', aliases: ['p', 'text'] },
	{ title: 'Heading 1', aliases: ['h', 'h1', 'heading1'] },
	{ title: 'Heading 2', aliases: ['h2', 'subheading'] },
	{ title: 'Bullet List', aliases: ['ul', 'li', 'list'] },
	{ title: 'Check List', aliases: ['ul', 'li', 'list', 'checkbox'] },
	{ title: 'Image', aliases: ['img', 'picture', '图片'] },
	{ title: 'File', aliases: ['upload'] },
	{ title: 'Link to File', aliases: ['link', 'file'] },
	{ title: 'Toggle Heading 1', aliases: ['h', 'h1'] },
];

function titles(query: string): string[] {
	return rankBaseHalfNoteMenuRows(rows, query).map(row => row.title);
}

suite('BaseHalf note block menu', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the rows are the blocks a note can hold, each once, with the basic ones first', () => {
		const keys = BASEHALF_NOTE_MENU_ENTRIES.map(entry => entry.key);
		assert.strictEqual(new Set(keys).size, keys.length);
		assert.deepStrictEqual(keys.slice(0, 2), ['paragraph', 'heading']);
		assert.strictEqual(BASEHALF_NOTE_MENU_ENTRIES.filter(entry => entry.group === 'basic').length, 12);
		const groups = BASEHALF_NOTE_MENU_ENTRIES.map(entry => entry.group);
		assert.deepStrictEqual(groups.filter((group, index) => groups[index - 1] !== group), ['basic', 'files', 'more']);
	});

	test('letters rank the rows and keep the order of rows of one rank', () => {
		assert.deepStrictEqual({
			none: titles(''),
			space: titles(' '),
			titleStart: titles('he'),
			wordOfTitle: titles('list'),
			exactWordBeforeWordOfTitle: titles('h1'),
			titleBeforeWord: titles('file'),
			wordOfOtherLanguage: titles('图片'),
			holds: titles('ragr'),
			upperCase: titles('IMAGE'),
			nothing: titles('zzz'),
		}, {
			none: rows.map(row => row.title),
			space: rows.map(row => row.title),
			titleStart: ['Heading 1', 'Heading 2', 'Toggle Heading 1', 'Check List'],
			wordOfTitle: ['Bullet List', 'Check List'],
			exactWordBeforeWordOfTitle: ['Heading 1', 'Toggle Heading 1'],
			titleBeforeWord: ['File', 'Link to File'],
			wordOfOtherLanguage: ['Image'],
			holds: ['Paragraph'],
			upperCase: ['Image'],
			nothing: [],
		});
	});

	test('the menu opens under its line when there is room, and over it only when there is more room there', () => {
		assert.deepStrictEqual({
			atTheTop: baseHalfNoteMenuSide({ top: 100, bottom: 120 }, 795),
			inTheLowerHalf: baseHalfNoteMenuSide({ top: 500, bottom: 520 }, 795),
			justEnoughBelow: baseHalfNoteMenuSide({ top: 523, bottom: 543 }, 795),
			justTooLittleBelow: baseHalfNoteMenuSide({ top: 524, bottom: 544 }, 795),
			nearTheBottom: baseHalfNoteMenuSide({ top: 680, bottom: 700 }, 795),
			moreRoomBelowInAShortView: baseHalfNoteMenuSide({ top: 40, bottom: 60 }, 200),
		}, {
			atTheTop: 'bottom',
			inTheLowerHalf: 'bottom',
			justEnoughBelow: 'bottom',
			justTooLittleBelow: 'top',
			nearTheBottom: 'top',
			moreRoomBelowInAShortView: 'bottom',
		});
	});
});

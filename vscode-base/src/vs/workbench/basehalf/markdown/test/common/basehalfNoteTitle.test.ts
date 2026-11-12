/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfNoteTitle, baseHalfNoteTitleName, baseHalfNoteTitleNameNumbered } from '../../common/basehalfNoteTitle.js';

suite('BaseHalfNoteTitle', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the title is the first block of the body when it is a heading', () => {
		assert.deepStrictEqual({
			h1: baseHalfNoteTitle('# Black holes\n\nWhere gravity wins.\n'),
			h2: baseHalfNoteTitle('## Anatomy'),
			h6: baseHalfNoteTitle('###### Deep\ntext right below'),
			afterFrontmatter: baseHalfNoteTitle('---\nupstream:\n  - black-holes.md\n---\n## How they form\n\nText.\n'),
			afterEmptyLines: baseHalfNoteTitle('\n\n# Later\n'),
			afterBom: baseHalfNoteTitle('﻿# Marked\n'),
			carriageReturns: baseHalfNoteTitle('# One\r\n\r\ntext\r\n'),
			setext: baseHalfNoteTitle('Under\n=====\n\ntext'),
			closedAtx: baseHalfNoteTitle('## Closed ##'),
			formats: baseHalfNoteTitle('# **Bold** and *slanted* `code` ~~gone~~'),
			link: baseHalfNoteTitle('# See [the notes](./notes.md) here'),
			underline: baseHalfNoteTitle('# <u>Under</u>lined'),
			escaped: baseHalfNoteTitle('# 2 \\* 3 &amp; more'),
			spaces: baseHalfNoteTitle('#   Wide    apart   '),
		}, {
			h1: 'Black holes',
			h2: 'Anatomy',
			h6: 'Deep',
			afterFrontmatter: 'How they form',
			afterEmptyLines: 'Later',
			afterBom: 'Marked',
			carriageReturns: 'One',
			setext: 'Under',
			closedAtx: 'Closed',
			formats: 'Bold and slanted code gone',
			link: 'See the notes here',
			underline: 'Underlined',
			escaped: '2 * 3 & more',
			spaces: 'Wide apart',
		});
	});

	test('a note that begins with anything else has no title', () => {
		assert.deepStrictEqual([
			baseHalfNoteTitle(''),
			baseHalfNoteTitle('Just a paragraph.\n\n# A heading further down\n'),
			baseHalfNoteTitle('- a list\n\n# Later'),
			baseHalfNoteTitle('---\nupstream:\n  - a.md\n---\n'),
			baseHalfNoteTitle('# \n\ntext'),
			baseHalfNoteTitle('#'),
			baseHalfNoteTitle('#hashtag is no heading'),
			baseHalfNoteTitle('> # quoted'),
		], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
	});

	test('the name of a title is a name a file can have', () => {
		assert.deepStrictEqual({
			plain: baseHalfNoteTitleName('Black holes'),
			separators: baseHalfNoteTitleName('a/b: c?'),
			reserved: baseHalfNoteTitleName('<in> "quotes" | pipe * star \\ back'),
			control: baseHalfNoteTitleName('tab\there\u0000null'),
			leadingDots: baseHalfNoteTitleName('...hidden'),
			trailingDots: baseHalfNoteTitleName('The end... '),
			onlyDots: baseHalfNoteTitleName('...'),
			onlySpaces: baseHalfNoteTitleName('   '),
			onlySeparators: baseHalfNoteTitleName('/:?'),
			chinese: baseHalfNoteTitleName('特征是什么'),
			extension: baseHalfNoteTitleName('notes.md'),
			long: baseHalfNoteTitleName('x'.repeat(300))?.length,
			// 3 bytes each: 66 characters are 198 bytes, the 67th would pass 200.
			longWide: baseHalfNoteTitleName('黑'.repeat(100))?.length,
			cutAtSpace: baseHalfNoteTitleName(`${'x'.repeat(199)} tail`),
		}, {
			plain: 'Black holes',
			separators: 'a b c',
			reserved: 'in quotes pipe star back',
			control: 'tab here null',
			leadingDots: 'hidden',
			trailingDots: 'The end',
			onlyDots: undefined,
			onlySpaces: undefined,
			onlySeparators: undefined,
			chinese: '特征是什么',
			extension: 'notes.md',
			long: 200,
			longWide: 66,
			cutAtSpace: 'x'.repeat(199),
		});
	});

	test('a taken name gets a number after it', () => {
		assert.deepStrictEqual([baseHalfNoteTitleNameNumbered('Anatomy', 2), baseHalfNoteTitleNameNumbered('特征', 11)], ['Anatomy 2', '特征 11']);
	});
});

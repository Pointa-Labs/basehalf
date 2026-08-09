/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	isBaseHalfMarkdownFormatBlockType,
	isBaseHalfMarkdownFormatCommand,
	isBaseHalfMarkdownFormatState,
	isBaseHalfMarkdownFormatToggleState,
} from '../../common/basehalfMarkdownFormatting.js';

suite('BaseHalfMarkdownFormatting', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('defines one canonical command and state vocabulary for every projection', () => {
		for (const command of [
			'setHeading1',
			'setHeading2',
			'setHeading3',
			'setParagraph',
			'toggleBold',
			'toggleItalic',
			'toggleBulletList',
			'toggleOrderedList',
			'insertDivider',
		]) {
			assert.strictEqual(isBaseHalfMarkdownFormatCommand(command), true, command);
		}
		for (const blockType of ['paragraph', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'mixed', 'other']) {
			assert.strictEqual(isBaseHalfMarkdownFormatBlockType(blockType), true, blockType);
		}
		assert.strictEqual(isBaseHalfMarkdownFormatToggleState(false), true);
		assert.strictEqual(isBaseHalfMarkdownFormatToggleState(true), true);
		assert.strictEqual(isBaseHalfMarkdownFormatToggleState('mixed'), true);
	});

	test('rejects legacy names and malformed state', () => {
		for (const value of ['setBulletList', 'setNumberedList', 'numberedList', 'partial', undefined]) {
			assert.strictEqual(isBaseHalfMarkdownFormatCommand(value), false);
			assert.strictEqual(isBaseHalfMarkdownFormatBlockType(value), false);
			assert.strictEqual(isBaseHalfMarkdownFormatToggleState(value), false);
		}

		assert.strictEqual(isBaseHalfMarkdownFormatState({
			ready: true,
			editable: true,
			blockType: 'mixed',
			bold: 'mixed',
			italic: false,
		}), true);
		assert.strictEqual(isBaseHalfMarkdownFormatState({
			ready: true,
			editable: true,
			blockType: 'paragraph',
			bold: 'partial',
			italic: false,
		}), false);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfProjectPathKey, baseHalfProjectPathProblem } from '../../common/basehalfProjectPath.js';

suite('BaseHalfProjectPath', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts a relative path that names the same item on every file system', () => {
		assert.deepStrictEqual(['shots/clip.mp4', 'notes/Scene 1.md', 'café/frame.png', 'renders/run.md', 'a.b/c'].map(baseHalfProjectPathProblem), [undefined, undefined, undefined, undefined, undefined]);
	});

	test('refuses a path that is not portable, with the reason', () => {
		assert.deepStrictEqual(Object.fromEntries([
			'/absolute.mp4', 'C:/escape.mp4', 'folder\\file.mp4', 'what?.md', 'tab\t.md',
			'../escape.mp4', 'a//b.md', './a.md',
			'.bh/private.mp4', 'shots/.BH/clip.mp4',
			'trailing./clip.mp4', 'space /clip.mp4',
			'CON.mp4', 'shots/lpt1', 'aux.txt',
			'cafe\u0301.md'
		].map(path => [path, baseHalfProjectPathProblem(path)])), {
			'/absolute.mp4': 'must be a portable project-relative path.',
			'C:/escape.mp4': 'must be a portable project-relative path.',
			'folder\\file.mp4': 'must be a portable project-relative path.',
			'what?.md': 'must be a portable project-relative path.',
			'tab\t.md': 'must be a portable project-relative path.',
			'../escape.mp4': 'cannot contain empty, current, or parent path segments.',
			'a//b.md': 'cannot contain empty, current, or parent path segments.',
			'./a.md': 'cannot contain empty, current, or parent path segments.',
			'.bh/private.mp4': 'cannot target BaseHalf derived workspace metadata.',
			'shots/.BH/clip.mp4': 'cannot target BaseHalf derived workspace metadata.',
			'trailing./clip.mp4': 'cannot contain a segment ending in a dot or space.',
			'space /clip.mp4': 'cannot contain a segment ending in a dot or space.',
			'CON.mp4': 'cannot contain a reserved device-name segment.',
			'shots/lpt1': 'cannot contain a reserved device-name segment.',
			'aux.txt': 'cannot contain a reserved device-name segment.',
			'cafe\u0301.md': 'must use Unicode NFC normalization.'
		});
	});

	test('one key names the same item whatever case or Unicode form spells it', () => {
		assert.strictEqual(baseHalfProjectPathKey('Shots/Café.mp4'), baseHalfProjectPathKey('shots/cafe\u0301.MP4'));
		assert.notStrictEqual(baseHalfProjectPathKey('shots/a.mp4'), baseHalfProjectPathKey('shots/b.mp4'));
	});
});

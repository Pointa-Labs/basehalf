/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfFilesExclude, baseHalfIsUnderBhFolder } from '../../common/basehalfBhFolder.js';

suite('BaseHalfBhFolder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Files leaves out only the rule of `.bh`, and only when the setting is on', () => {
		const exclude = { '**/.git': true, '**/.bh': true, 'AGENTS.md': true };
		assert.strictEqual(baseHalfFilesExclude(exclude, false), exclude);
		assert.deepStrictEqual(baseHalfFilesExclude(exclude, true), { '**/.git': true, 'AGENTS.md': true });
		assert.deepStrictEqual(exclude, { '**/.git': true, '**/.bh': true, 'AGENTS.md': true }, 'the setting\'s own value is not changed');

		// A rule of the user's own stays theirs.
		assert.deepStrictEqual(baseHalfFilesExclude({ '.bh/cache': true }, true), { '.bh/cache': true });
	});

	test('a path is under `.bh` at any depth, and a name that only looks like it is not', () => {
		assert.strictEqual(baseHalfIsUnderBhFolder('.bh'), true);
		assert.strictEqual(baseHalfIsUnderBhFolder('.bh/attachments/a1/b.png'), true);
		assert.strictEqual(baseHalfIsUnderBhFolder('repo/.bh/mirror'), true);
		assert.strictEqual(baseHalfIsUnderBhFolder(''), false);
		assert.strictEqual(baseHalfIsUnderBhFolder('docs/guide.md'), false);
		assert.strictEqual(baseHalfIsUnderBhFolder('.bhx/a.md'), false);
		assert.strictEqual(baseHalfIsUnderBhFolder('notes.bh'), false);
	});
});

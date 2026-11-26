/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfSplitFolder } from '../../common/basehalfAgentSplitFolder.js';

suite('BaseHalfAgentSplitFolder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a split starts where splitCwd says, and in the workspace folder beside a session without a terminal', () => {
		assert.deepStrictEqual(
			Object.fromEntries(['inherited', 'initial', 'workspaceRoot', undefined, 'other'].map(value => [String(value), [baseHalfSplitFolder(value, true), baseHalfSplitFolder(value, false)]])),
			{
				inherited: ['current', 'workspace'],
				initial: ['initial', 'workspace'],
				workspaceRoot: ['workspace', 'workspace'],
				undefined: ['current', 'workspace'],
				other: ['current', 'workspace']
			}
		);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfUnnamedHiddenCommands } from '../../common/basehalfHiddenCommandsCheck.js';

suite('BaseHalfHiddenCommandsCheck', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('names a command of a hidden family\'s category that no pattern names, once', () => {
		assert.deepStrictEqual(
			baseHalfUnnamedHiddenCommands([
				{ id: 'workbench.action.chat.open', category: 'Chat' },
				{ id: 'workbench.action.tasks.runTask', category: 'Tasks' },
				{ id: 'some.new.chatCommand', category: 'Chat' },
				{ id: 'some.new.chatCommand', category: 'Chat' },
				{ id: 'some.new.debugCommand', category: 'Debug' },
				{ id: 'workbench.action.files.save', category: 'File' },
				{ id: 'some.command.without.category', category: undefined }
			]),
			['Chat: some.new.chatCommand', 'Debug: some.new.debugCommand']
		);
	});
});

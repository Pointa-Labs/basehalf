/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BASEHALF_RELEASE_NOTES_COMMAND_ID, getBaseHalfReleaseNotesMarkdown, shouldShowBaseHalfReleaseNotes } from '../../common/basehalfReleaseNotes.js';

suite('BaseHalfReleaseNotes', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses the VS Code release notes command id with local BaseHalf content', () => {
		assert.strictEqual(BASEHALF_RELEASE_NOTES_COMMAND_ID, 'update.showCurrentReleaseNotes');

		const markdown = getBaseHalfReleaseNotesMarkdown('1.2.3');
		assert.ok(markdown.startsWith('# BaseHalf 1.2.3\n'));
		assert.ok(markdown.includes('Settings live in VS Code'));
		assert.ok(markdown.includes('Release Notes open as a system page'));
		assert.ok(markdown.includes('API keys stay in encrypted application credential storage'));
		assert.ok(markdown.includes('one optional Recipe, Run, Current, and History model'));
		assert.ok(markdown.includes('Connections never auto-run a workflow'));
		assert.ok(markdown.includes('Restart to Update'));
		assert.strictEqual(markdown.includes('basehalf.update.'), false);
	});

	test('shows notes after an installed BaseHalf version changes, but not on first run', () => {
		assert.strictEqual(shouldShowBaseHalfReleaseNotes(undefined, '0.4.1'), false);
		assert.strictEqual(shouldShowBaseHalfReleaseNotes('0.4.1', '0.4.1'), false);
		assert.strictEqual(shouldShowBaseHalfReleaseNotes('0.4.1', '0.5.0'), true);
	});
});

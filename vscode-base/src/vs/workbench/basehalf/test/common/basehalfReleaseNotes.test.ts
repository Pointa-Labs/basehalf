/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BASEHALF_RELEASE_NOTES_COMMAND_ID, getBaseHalfReleaseNotesMarkdown } from '../../common/basehalfReleaseNotes.js';

suite('BaseHalfReleaseNotes', () => {
	test('uses the VS Code release notes command id with local BaseHalf content', () => {
		assert.strictEqual(BASEHALF_RELEASE_NOTES_COMMAND_ID, 'update.showCurrentReleaseNotes');

		const markdown = getBaseHalfReleaseNotesMarkdown('1.2.3');
		assert.ok(markdown.startsWith('# BaseHalf 1.2.3\n'));
		assert.ok(markdown.includes('Settings live in VS Code'));
		assert.ok(markdown.includes('Release Notes open as a system page'));
		assert.strictEqual(markdown.includes('basehalf.update.'), false);
	});
});

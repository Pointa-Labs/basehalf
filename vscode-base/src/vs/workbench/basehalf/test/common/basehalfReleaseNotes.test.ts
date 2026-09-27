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
		assert.ok(markdown.includes('editable Draft through immutable Attempts to one sealed local-file Result'));
		assert.ok(markdown.includes('accepts exactly one result file'));
		assert.ok(markdown.includes('Connections never auto-run a workflow'));
		assert.ok(markdown.includes('Restart to Update'));
		assert.strictEqual(markdown.includes('basehalf.update.'), false);
	});

	test('states the workspace-state, cleanup, connection, and rename changes this build ships', () => {
		const markdown = getBaseHalfReleaseNotesMarkdown('1.2.3');
		const statements = [
			'Connecting two cards saves the connection in the card it points to: an `upstream` list in a Markdown note\'s frontmatter, a `.bhnode`\'s `upstream` field, or `.bh/mirror/<path>/upstream.yaml` for PDFs, folders, and other files.',
			'The list is visible in git, in the Source view, and in other Markdown tools, and agents read it when they open the note. Deleting it removes the connection.',
			'The badge edits a card\'s Upstream list. Downstream shows what draws on it.',
			'Moving or renaming a file in BaseHalf offers to update the upstream lists that name it.',
			'Connections from earlier versions move into your files after you confirm.',
			'BaseHalf removes its old focus and harness files from `.bh/`, which may delete tracked files in git.',
			'It offers to remove the sections it added to `CLAUDE.md` and `AGENTS.md`, and keeps canvas viewports per machine.',
			'BaseHalf no longer edits `.gitignore`. We recommend ignoring `.bh/cache/`.',
			'Folders that ignore all of `.bh/` do not share the upstream lists of non-Markdown nodes through git.'
		];
		assert.deepStrictEqual(statements.filter(statement => !markdown.includes(statement)), []);
	});

	test('shows notes after an installed BaseHalf version changes, but not on first run', () => {
		assert.strictEqual(shouldShowBaseHalfReleaseNotes(undefined, '0.4.1'), false);
		assert.strictEqual(shouldShowBaseHalfReleaseNotes('0.4.1', '0.4.1'), false);
		assert.strictEqual(shouldShowBaseHalfReleaseNotes('0.4.1', '0.5.0'), true);
	});
});

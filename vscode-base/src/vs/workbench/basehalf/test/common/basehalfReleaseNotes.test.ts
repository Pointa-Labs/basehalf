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
			'Connecting two cards saves the connection with the card it points to. For a note, it is saved inside the note itself, so agents and other tools that read the note see it too. For PDFs, folders, other files, and a note BaseHalf can\'t write into, BaseHalf keeps the list for you.',
			'The badge edits a card\'s Upstream list. Downstream shows what draws on it.',
			'Moving or renaming a file in BaseHalf offers to update the upstream lists that name it.',
			'Connections from earlier versions move into your files after you confirm.',
			'If BaseHalf can\'t read a card\'s upstream list, the badge offers Rebuild List, which keeps the connections it can read.',
			'Files and folders whose names look like numbers, such as 09, keep their place on the canvas.',
			'When BaseHalf can\'t read something it saved for a canvas or a card, it keeps working with what it can read and keeps a copy of the rest. It never asks you to open or fix a file.',
			'If BaseHalf can\'t finish updating its cards and badges after you move or delete something, you can Retry or Skip instead of being blocked.',
			'BaseHalf removes files that earlier versions kept for itself and no longer uses. It offers to remove the sections it added to CLAUDE.md and AGENTS.md, and remembers where you left each canvas on this computer.',
			'If you keep your notes in git: the removed files show up as deletions, BaseHalf no longer edits .gitignore, and we recommend ignoring .bh/cache/. A folder that ignores all of .bh/ does not share the upstream lists of PDFs, folders, and other non-note files.'
		];
		assert.deepStrictEqual(statements.filter(statement => !markdown.includes(statement)), []);
		// Written for someone who does not read code: no file formats, and
		// nothing in code formatting.
		assert.deepStrictEqual(markdown.match(/`|frontmatter|YAML|\.bhnode|upstream\.yaml/gi), null);
	});

	test('shows notes after an installed BaseHalf version changes, but not on first run', () => {
		assert.strictEqual(shouldShowBaseHalfReleaseNotes(undefined, '0.4.1'), false);
		assert.strictEqual(shouldShowBaseHalfReleaseNotes('0.4.1', '0.4.1'), false);
		assert.strictEqual(shouldShowBaseHalfReleaseNotes('0.4.1', '0.5.0'), true);
	});
});

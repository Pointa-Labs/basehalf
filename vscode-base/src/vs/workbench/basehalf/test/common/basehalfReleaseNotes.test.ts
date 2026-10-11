/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BASEHALF_RELEASE_NOTES_COMMAND_ID, getBaseHalfReleaseNotesMarkdown, shouldShowBaseHalfReleaseNotes, showBaseHalfReleaseNotesAfterUpdate } from '../../common/basehalfReleaseNotes.js';

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
		assert.ok(markdown.includes('AI Video is built in. It works from the first start and no longer needs to be installed, and the Plugins library is gone from the sidebar.'));
		assert.ok(markdown.includes('BaseHalf keeps the left sidebar focused on Files, Git, and Search.'));
		assert.strictEqual(markdown.includes('Restart to Update'), false);
		assert.strictEqual(markdown.includes('basehalf.update.'), false);
	});

	test('states the workspace-state, cleanup, connection, and rename changes this build ships', () => {
		const markdown = getBaseHalfReleaseNotesMarkdown('1.2.3');
		const statements = [
			'Connecting two cards saves the connection with the card it points to. For a note, it is saved inside the note itself, so agents and other tools that read the note see it too. For PDFs, folders, other files, and a note BaseHalf can\'t write into, BaseHalf keeps the list for you.',
			'The badge edits a card\'s Upstream list. Downstream shows what draws on it.',
			'When a file or folder is moved or renamed, BaseHalf updates the upstream lists that name it by itself. It no longer asks.',
			'A card keeps its description, its place, and its connections when its file or folder is moved or renamed outside BaseHalf, by you or by an agent, also while BaseHalf is closed. A file that was also rewritten for the most part starts as a new card.',
			'Connections from earlier versions move into your files after you confirm.',
			'If BaseHalf can\'t read a card\'s upstream list, the badge offers Rebuild List, which keeps the connections it can read.',
			'BaseHalf can install a skill for your agents, so that Claude Code, Codex, and others know where a card\'s description and connections are. It asks first, and adds it to the agents\' own settings, not to your folder.',
			'Every card keeps its place. When a file is added, its card goes after the last card and no other card moves. BaseHalf never puts a card on top of another one.',
			'Files and folders whose names look like numbers, such as 09, keep their place on the canvas.',
			'When BaseHalf can\'t read something it saved for a canvas or a card, it keeps working with what it can read and keeps a copy of the rest. It never asks you to open or fix a file.',
			'If BaseHalf can\'t finish updating its cards and badges after you move or delete something, you can Retry or Skip instead of being blocked.',
			'From this version on, an update is downloaded once. If BaseHalf is closed while it downloads, the download goes on where it stopped the next time.',
			'Once an update is ready, the next start of BaseHalf is the new version, also when BaseHalf was not closed in the usual way.',
			'About and the update entry in the title bar show BaseHalf\'s own version.',
			'BaseHalf removes files that earlier versions kept for itself and no longer uses. It offers to remove the sections it added to CLAUDE.md and AGENTS.md, and remembers where you left each canvas on this computer.',
			'Where you put your cards stays with the folder on your computer. It is not shared through git any more, so moving a card no longer shows up as a change there. Descriptions and connections are shared as before.',
			'If you keep your notes in git: the removed files show up as deletions, and BaseHalf no longer edits .gitignore. It keeps card positions and its own working files out of git by itself. Card positions that an earlier version committed stay in git until you remove them there. A folder that ignores all of .bh/ does not share the upstream lists of PDFs, folders, and other non-note files.'
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

	test('a version counts as shown once its page was opened: a start in which it was not leaves it for the next', async () => {
		/** One window after a start. What it did, and the version that is recorded afterwards. */
		async function start(recorded: string | undefined, options: { readonly hadLastFocus?: boolean; readonly switchedOff?: boolean; readonly opens?: boolean } = {}) {
			const did: string[] = [];
			let after = recorded;
			await showBaseHalfReleaseNotesAfterUpdate({
				recorded,
				current: '0.5.0',
				switchedOff: options.switchedOff ?? false,
				hadLastFocus: async () => options.hadLastFocus ?? true,
				show: async () => {
					if (options.opens === false) {
						throw new Error('The page cannot be opened.');
					}
					did.push('shown');
				},
				record: () => {
					did.push('recorded');
					after = '0.5.0';
				}
			}).catch(error => did.push((error as Error).message));
			return { did, after: after ?? null };
		}

		// After an update from 0.4.1: the window that did not have focus last, then the next start.
		const withoutFocus = await start('0.4.1', { hadLastFocus: false });
		const nextStart = await start(withoutFocus.after ?? undefined);
		const startAfterThat = await start(nextStart.after ?? undefined);

		assert.deepStrictEqual({
			withoutFocus,
			nextStart,
			startAfterThat,
			notOpened: await start('0.4.1', { opens: false }),
			firstStartEver: await start(undefined),
			switchedOff: await start('0.4.1', { switchedOff: true })
		}, {
			withoutFocus: { did: [], after: '0.4.1' },
			nextStart: { did: ['shown', 'recorded'], after: '0.5.0' },
			startAfterThat: { did: ['recorded'], after: '0.5.0' },
			notOpened: { did: ['The page cannot be opened.'], after: '0.4.1' },
			firstStartEver: { did: ['recorded'], after: '0.5.0' },
			switchedOff: { did: ['recorded'], after: '0.5.0' }
		});
	});
});

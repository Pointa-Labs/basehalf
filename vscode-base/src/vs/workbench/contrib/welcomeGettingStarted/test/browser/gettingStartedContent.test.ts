/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { startEntries, walkthroughs } from '../../common/gettingStartedContent.js';

suite('Getting Started Content', () => {

	test('uses BaseHalf start entries instead of stock VS Code onboarding entries', () => {
		assert.deepStrictEqual(
			startEntries.map(entry => entry.id),
			[
				'basehalfOpenFolder',
				'basehalfOpenFolderOther',
				'basehalfOpenFolderWeb',
				'basehalfCloneRepository',
				'basehalfOpenAgentArea',
				'basehalfOpenSettings',
				'basehalfShowCommands'
			]
		);

		for (const entry of startEntries) {
			assert.ok(!entry.id.includes('Remote'), entry.id);
			assert.ok(!entry.id.includes('NewWorkspaceChat'), entry.id);
			assert.ok(!entry.content.command.includes('welcome.newWorkspaceChat'), entry.content.command);
			assert.ok(!entry.content.command.includes('showPopularExtensions'), entry.content.command);
		}

		const visibleTitles = startEntries.map(entry => entry.title);
		assert.ok(visibleTitles.includes('Open Folder as Canvas...'));
		assert.ok(visibleTitles.includes('Open Agent Area...'));
		assert.ok(visibleTitles.includes('Open BaseHalf Settings...'));
	});

	test('does not contribute a second walkthrough-style welcome page', () => {
		assert.deepStrictEqual(walkthroughs, []);
	});
});

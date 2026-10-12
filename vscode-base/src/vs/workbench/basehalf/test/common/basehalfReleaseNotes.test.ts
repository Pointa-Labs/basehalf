/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BASEHALF_RELEASE_NOTES_COMMAND_ID, baseHalfReleaseNotesUrl } from '../../common/basehalfReleaseNotes.js';

suite('BaseHalfReleaseNotes', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the notes of a version are on the releases page, under the command that the update interface calls', () => {
		const releases = 'https://github.com/Pointa-Labs/basehalf/releases';

		assert.deepStrictEqual({
			// The id of the base's own command: the update tooltip and the Help menu run it.
			command: BASEHALF_RELEASE_NOTES_COMMAND_ID,
			ofAVersion: baseHalfReleaseNotesUrl(releases, '0.5.1'),
			withASlashAtTheEnd: baseHalfReleaseNotesUrl(`${releases}/`, '12.0.30'),
			withoutAReleasesPage: baseHalfReleaseNotesUrl(undefined, '0.5.1') ?? null,
			withoutAVersion: baseHalfReleaseNotesUrl(releases, undefined) ?? null,
			// Nothing but a version becomes part of the address.
			notAVersion: ['0.5', 'v0.5.1', '0.5.1/../../settings', '0.5.1?tab=readme', ''].map(version => baseHalfReleaseNotesUrl(releases, version) ?? null)
		}, {
			command: 'update.showCurrentReleaseNotes',
			ofAVersion: 'https://github.com/Pointa-Labs/basehalf/releases/tag/v0.5.1',
			withASlashAtTheEnd: 'https://github.com/Pointa-Labs/basehalf/releases/tag/v12.0.30',
			withoutAReleasesPage: null,
			withoutAVersion: null,
			notAVersion: [null, null, null, null, null]
		});
	});
});

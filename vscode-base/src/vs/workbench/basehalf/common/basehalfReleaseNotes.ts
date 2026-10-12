/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export const BASEHALF_RELEASE_NOTES_COMMAND_ID = 'update.showCurrentReleaseNotes';

/**
 * Where the release notes of a version are: on the releases page, with the
 * release they belong to (app update, "After an update"). They are written
 * there once, and BaseHalf holds no text of its own about what changed.
 *
 * Without a releases page, or for something that is not a version of
 * BaseHalf, there is no address.
 */
export function baseHalfReleaseNotesUrl(releasesUrl: string | undefined, version: string | undefined): string | undefined {
	if (!releasesUrl || !version || !/^\d+\.\d+\.\d+$/.test(version)) {
		return undefined;
	}
	return `${releasesUrl.replace(/\/+$/, '')}/tag/v${version}`;
}

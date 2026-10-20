/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { State, StateType } from '../../../../platform/update/common/update.js';

/** The page of Settings that holds the version, the state of an update, and "Release Notes". */
export const BASEHALF_ABOUT_SETTINGS_SECTION_ID = 'basehalf/about';
export const BASEHALF_OPEN_ABOUT_COMMAND_ID = 'basehalf.about.open';

export type BaseHalfAboutAction = 'check' | 'download' | 'install' | 'restart';

/** The commands of the base that carry the actions out. */
export const BASEHALF_ABOUT_ACTION_COMMANDS: Readonly<Record<BaseHalfAboutAction, string>> = {
	check: 'update.check',
	download: 'update.downloadNow',
	install: 'update.install',
	restart: 'update.restart'
};

/**
 * The one action the About page offers for a state of the update service
 * (app update, "Where an update shows"). A state in which there is nothing to
 * do, a check or a download that runs, updates that are switched off, has
 * none.
 */
export function baseHalfAboutAction(state: State): BaseHalfAboutAction | undefined {
	switch (state.type) {
		case StateType.Idle:
			return 'check';
		case StateType.AvailableForDownload:
			return 'download';
		case StateType.Downloaded:
			return 'install';
		case StateType.Ready:
			return 'restart';
		default:
			return undefined;
	}
}

/**
 * What a failed check says, when it is to be told. The update service names
 * an error only for a check that the user asked for, and one that BaseHalf
 * started by itself fails without a word.
 */
export function baseHalfUpdateCheckFailure(state: State): string | undefined {
	return state.type === StateType.Idle && state.error ? state.error : undefined;
}

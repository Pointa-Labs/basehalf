/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DisablementReason, IUpdate, State, UpdateType } from '../../../../platform/update/common/update.js';
import { BASEHALF_ABOUT_ACTION_COMMANDS, baseHalfAboutAction, baseHalfUpdateCheckFailure } from '../../common/basehalfAbout.js';

suite('BaseHalfAbout', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const update: IUpdate = { version: '0.5.1', productVersion: '0.5.1' };
	const states: Record<string, State> = {
		uninitialized: State.Uninitialized,
		switchedOff: State.Disabled(DisablementReason.ManuallyDisabled),
		idle: State.Idle(UpdateType.Archive),
		nothingNewer: State.Idle(UpdateType.Archive, undefined, true),
		checking: State.CheckingForUpdates(true),
		canBeDownloaded: State.AvailableForDownload(update, true),
		downloading: State.Downloading(update, true, false, 10, 100),
		downloaded: State.Downloaded(update, true, false),
		unpacking: State.Updating(update, true),
		ready: State.Ready(update, false, false),
		restarting: State.Restarting(update)
	};

	test('the About page offers the one action a state calls for, and none where there is nothing to do', () => {
		const offered = Object.fromEntries(Object.entries(states).map(([name, state]) => {
			const action = baseHalfAboutAction(state);
			return [name, action ? `${action}: ${BASEHALF_ABOUT_ACTION_COMMANDS[action]}` : null];
		}));

		assert.deepStrictEqual(offered, {
			uninitialized: null,
			switchedOff: null,
			idle: 'check: update.check',
			nothingNewer: 'check: update.check',
			checking: null,
			canBeDownloaded: 'download: update.downloadNow',
			downloading: null,
			downloaded: 'install: update.install',
			unpacking: null,
			ready: 'restart: update.restart',
			restarting: null
		});
	});

	test('a failed check is told when the update service names its error, which it does for a check the user asked for', () => {
		assert.deepStrictEqual({
			// What the service sets after a check the user asked for failed.
			askedFor: baseHalfUpdateCheckFailure(State.Idle(UpdateType.Archive, 'Could not reach the update feed (HTTP 503).')),
			// And after one it started by itself: no error.
			byItself: baseHalfUpdateCheckFailure(State.Idle(UpdateType.Archive)) ?? null,
			others: Object.values(states).map(state => baseHalfUpdateCheckFailure(state) ?? null).filter(failure => failure !== null)
		}, {
			askedFor: 'Could not reach the update feed (HTTP 503).',
			byItself: null,
			others: []
		});
	});
});

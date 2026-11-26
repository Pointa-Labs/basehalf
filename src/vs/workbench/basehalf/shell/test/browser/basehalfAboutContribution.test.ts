/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IUpdateService, State, UpdateType } from '../../../../../platform/update/common/update.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { BaseHalfUpdateCheckFailureContribution } from '../../browser/basehalfAbout.contribution.js';

suite('BaseHalfUpdateCheckFailureContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('a failed check that the user asked for is told in the window the user last worked in, and only there', async () => {
		const told: string[][] = [];
		for (const lastFocused of [true, false]) {
			const states = disposables.add(new Emitter<State>());
			const messages: string[] = [];
			const updateService = { onStateChange: states.event } as Partial<IUpdateService> as IUpdateService;
			const notificationService = { error: (message: string) => { messages.push(message); } } as Partial<INotificationService> as INotificationService;
			const hostService = { hadLastFocus: async () => lastFocused } as Partial<IHostService> as IHostService;
			disposables.add(new BaseHalfUpdateCheckFailureContribution(updateService, notificationService, hostService));
			states.fire(State.Idle(UpdateType.Archive, 'net::ERR_INTERNET_DISCONNECTED'));
			// A check that BaseHalf started by itself ends without an error to tell.
			states.fire(State.Idle(UpdateType.Archive));
			await timeout(0);
			told.push(messages);
		}
		assert.deepStrictEqual(told, [['BaseHalf could not check for updates. net::ERR_INTERNET_DISCONNECTED'], []]);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_AGENT_SESSION_NO_BELL, baseHalfAgentSessionBellEnded, baseHalfAgentSessionBellLingered, baseHalfAgentSessionBellRang, baseHalfAgentSessionBellSeen, baseHalfAgentSessionShowsBell, IBaseHalfAgentSessionBell } from '../../common/basehalfAgentSessionBell.js';

suite('BaseHalfAgentSessionBell', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	type Step = 'ringInView' | 'ringOutOfView' | 'end' | 'seen' | 'lingered';

	/** Whether the bell shows after each step. */
	function shows(steps: readonly Step[]): boolean[] {
		let bell: IBaseHalfAgentSessionBell = BASEHALF_AGENT_SESSION_NO_BELL;
		return steps.map(step => {
			switch (step) {
				case 'ringInView': bell = baseHalfAgentSessionBellRang(bell, true); break;
				case 'ringOutOfView': bell = baseHalfAgentSessionBellRang(bell, false); break;
				case 'end': bell = baseHalfAgentSessionBellEnded(bell); break;
				case 'seen': bell = baseHalfAgentSessionBellSeen(bell); break;
				case 'lingered': bell = baseHalfAgentSessionBellLingered(bell); break;
			}
			return baseHalfAgentSessionShowsBell(bell);
		});
	}

	test('a bell in view shows for its time, and one out of view until the session is seen and for that time after', () => {
		assert.deepStrictEqual(
			{
				inView: shows(['ringInView', 'end']),
				outOfView: shows(['ringOutOfView', 'end', 'seen', 'lingered']),
				seenWhileRinging: shows(['ringOutOfView', 'seen', 'end', 'lingered']),
				seenWhileRingingLingersPastIt: shows(['ringOutOfView', 'seen', 'lingered', 'end']),
				leftWhileRinging: shows(['ringInView', 'seen', 'end']),
				rungAgainOutOfView: shows(['ringInView', 'end', 'ringOutOfView', 'ringOutOfView', 'end', 'seen', 'lingered'])
			},
			{
				inView: [true, false],
				outOfView: [true, true, true, false],
				seenWhileRinging: [true, true, true, false],
				seenWhileRingingLingersPastIt: [true, true, true, false],
				leftWhileRinging: [true, true, false],
				rungAgainOutOfView: [true, false, true, true, true, true, false]
			}
		);
	});

	test('seeing a session without an unseen bell changes nothing', () => {
		const ringing = baseHalfAgentSessionBellRang(BASEHALF_AGENT_SESSION_NO_BELL, true);
		assert.deepStrictEqual(
			[baseHalfAgentSessionBellSeen(BASEHALF_AGENT_SESSION_NO_BELL) === BASEHALF_AGENT_SESSION_NO_BELL, baseHalfAgentSessionBellSeen(ringing) === ringing],
			[true, true]
		);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_AGENT_SESSION_NO_BELL, baseHalfAgentAreaButtonShowsBell, baseHalfAgentSessionBellAreaShown, baseHalfAgentSessionBellEnded, baseHalfAgentSessionBellLingered, baseHalfAgentSessionBellRang, baseHalfAgentSessionBellSeen, baseHalfAgentSessionShowsBell, IBaseHalfAgentSessionBell } from '../../common/basehalfAgentSessionBell.js';

suite('BaseHalfAgentSessionBell', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	type Step = 'ringInView' | 'ringOutOfView' | 'end' | 'seen' | 'lingered';

	/** Whether the bell shows after each step. */
	function shows(steps: readonly Step[]): boolean[] {
		let bell: IBaseHalfAgentSessionBell = BASEHALF_AGENT_SESSION_NO_BELL;
		return steps.map(step => {
			switch (step) {
				case 'ringInView': bell = baseHalfAgentSessionBellRang(bell, true, true); break;
				case 'ringOutOfView': bell = baseHalfAgentSessionBellRang(bell, false, true); break;
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
		const ringing = baseHalfAgentSessionBellRang(BASEHALF_AGENT_SESSION_NO_BELL, true, true);
		assert.deepStrictEqual(
			[baseHalfAgentSessionBellSeen(BASEHALF_AGENT_SESSION_NO_BELL) === BASEHALF_AGENT_SESSION_NO_BELL, baseHalfAgentSessionBellSeen(ringing) === ringing],
			[true, true]
		);
	});

	test('the title bar\'s button shows a dot from a ring while the Agent Area is hidden until the area is shown', () => {
		type AreaStep = 'ringHidden' | 'ringInView' | 'ringOnAnotherTab' | 'end' | 'areaShown' | 'seen' | 'lingered';
		/** After each step: whether the button shows the dot, and whether the tab shows the bell. */
		const marks = (steps: readonly AreaStep[]): string[] => {
			let bell: IBaseHalfAgentSessionBell = BASEHALF_AGENT_SESSION_NO_BELL;
			return steps.map(step => {
				switch (step) {
					case 'ringHidden': bell = baseHalfAgentSessionBellRang(bell, false, false); break;
					case 'ringInView': bell = baseHalfAgentSessionBellRang(bell, true, true); break;
					case 'ringOnAnotherTab': bell = baseHalfAgentSessionBellRang(bell, false, true); break;
					case 'end': bell = baseHalfAgentSessionBellEnded(bell); break;
					case 'areaShown': bell = baseHalfAgentSessionBellAreaShown(bell); break;
					case 'seen': bell = baseHalfAgentSessionBellSeen(bell); break;
					case 'lingered': bell = baseHalfAgentSessionBellLingered(bell); break;
				}
				return `${baseHalfAgentAreaButtonShowsBell([bell]) ? 'button' : '-'} ${baseHalfAgentSessionShowsBell(bell) ? 'tab' : '-'}`;
			});
		};
		const quiet = BASEHALF_AGENT_SESSION_NO_BELL;
		const rangHidden = baseHalfAgentSessionBellRang(quiet, false, false);
		assert.deepStrictEqual(
			{
				// The dot outlasts the time of a bell; once the area is shown, the tab in front shows the bell for that time.
				hidden: marks(['ringHidden', 'end', 'areaShown', 'seen', 'lingered']),
				// A tab that is not in front keeps its bell after the area was shown.
				hiddenOnAnotherTab: marks(['ringHidden', 'end', 'areaShown']),
				shownInView: marks(['ringInView', 'end']),
				shownOnAnotherTab: marks(['ringOnAnotherTab', 'end']),
				// Hiding the area with a bell on a tab puts no dot on the button: only a ring does.
				rungAgainHidden: marks(['ringOnAnotherTab', 'end', 'ringHidden', 'areaShown']),
				severalSessions: [baseHalfAgentAreaButtonShowsBell([]), baseHalfAgentAreaButtonShowsBell([quiet, quiet]), baseHalfAgentAreaButtonShowsBell([quiet, rangHidden])],
				showingAnAreaWithoutSuchABellChangesNothing: baseHalfAgentSessionBellAreaShown(quiet) === quiet
			},
			{
				hidden: ['button tab', 'button tab', '- tab', '- tab', '- -'],
				hiddenOnAnotherTab: ['button tab', 'button tab', '- tab'],
				shownInView: ['- tab', '- -'],
				shownOnAnotherTab: ['- tab', '- tab'],
				rungAgainHidden: ['- tab', '- tab', 'button tab', '- tab'],
				severalSessions: [false, false, true],
				showingAnAreaWithoutSuchABellChangesNothing: true
			}
		);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildHelpMessage, OPTIONS, parseArgs } from '../../../environment/node/argv.js';
import { BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID, baseHalfRunLaunchCommands, IBaseHalfLaunchWindow } from '../../common/basehalfLaunchCommands.js';

class TestLaunchWindow implements IBaseHalfLaunchWindow {
	readonly sent: unknown[][] = [];

	constructor(readonly name: string) { }

	sendWhenReady(channel: string, token: CancellationToken, ...args: unknown[]): void {
		this.sent.push([channel, ...args]);
	}
}

/** What each window was sent, by its name. */
function sentBy(windows: readonly TestLaunchWindow[]): Record<string, unknown[][]> {
	return Object.fromEntries(windows.map(window => [window.name, window.sent]));
}

suite('BaseHalf launch commands', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const install = ['vscode:runAction', { id: BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID, from: 'cli' }];

	test('the command line reads --install-agent-skill beside a folder, and its help lists it', () => {
		const args = parseArgs(['--install-agent-skill', 'notes'], OPTIONS);
		assert.deepStrictEqual(
			{ option: args['install-agent-skill'], paths: args._, without: parseArgs(['notes'], OPTIONS)['install-agent-skill'], help: buildHelpMessage('BaseHalf', 'basehalf', '1.0.0', OPTIONS).includes('--install-agent-skill') },
			{ option: true, paths: ['notes'], without: false, help: true }
		);
	});

	test('with the option, the window that was active last among the used ones installs the skill', () => {
		const first = new TestLaunchWindow('first');
		const second = new TestLaunchWindow('second');
		const asked = baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [first, second], second);
		assert.deepStrictEqual({ asked, sent: sentBy([first, second]) }, { asked: true, sent: { first: [], second: [install] } });
	});

	test('a window that the launch did not use is not asked: the first used one is', () => {
		const first = new TestLaunchWindow('first');
		const second = new TestLaunchWindow('second');
		const other = new TestLaunchWindow('other');
		const asked = baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [first, second], other);
		const askedWithoutActive = baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [second], undefined);
		assert.deepStrictEqual(
			{ asked, askedWithoutActive, sent: sentBy([first, second, other]) },
			{ asked: true, askedWithoutActive: true, sent: { first: [install], second: [install], other: [] } }
		);
	});

	test('without the option, and without a window, nothing is asked', () => {
		const window = new TestLaunchWindow('window');
		const withoutOption = baseHalfRunLaunchCommands({}, [window], window);
		const withoutWindow = baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [], window);
		assert.deepStrictEqual({ withoutOption, withoutWindow, sent: sentBy([window]) }, { withoutOption: false, withoutWindow: false, sent: { window: [] } });
	});
});

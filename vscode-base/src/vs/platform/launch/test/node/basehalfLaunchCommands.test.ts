/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildHelpMessage, OPTIONS, parseArgs } from '../../../environment/node/argv.js';
import { BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID, baseHalfRelaunchArguments, baseHalfRunLaunchCommands, IBaseHalfLaunchWindow } from '../../common/basehalfLaunchCommands.js';

/** A window that records what it is sent, and under which page: the one it shows, or the one it loads. */
class TestLaunchWindow implements IBaseHalfLaunchWindow {
	readonly sent: unknown[][] = [];
	private readonly _onWillLoad = new Emitter<unknown>();
	readonly onWillLoad = this._onWillLoad.event;
	private page = 1;

	constructor(readonly name: string, public isReady = false) { }

	sendWhenReady(channel: string, token: CancellationToken, ...args: unknown[]): void {
		this.sent.push([this.isReady ? `page ${this.page}` : `page ${this.page}, when it is ready`, channel, ...args]);
	}

	/** The window begins to load another page, as it does for a folder that is opened in it. */
	load(): void {
		this.isReady = false;
		this.page++;
		this._onWillLoad.fire(undefined);
	}

	dispose(): void {
		this._onWillLoad.dispose();
	}
}

suite('BaseHalf launch commands', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const install = ['vscode:runAction', { id: BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID, from: 'cli' }];

	function windows(...names: string[]): TestLaunchWindow[] {
		return names.map(name => store.add(new TestLaunchWindow(name)));
	}

	/** What each window was sent, by its name. */
	function sentBy(all: readonly TestLaunchWindow[]): Record<string, unknown[][]> {
		return Object.fromEntries(all.map(window => [window.name, window.sent]));
	}

	test('the command line reads --install-agent-skill beside a folder, and its help lists it', () => {
		const args = parseArgs(['--install-agent-skill', 'notes'], OPTIONS);
		assert.deepStrictEqual(
			{ option: args['install-agent-skill'], paths: args._, without: parseArgs(['notes'], OPTIONS)['install-agent-skill'], help: buildHelpMessage('BaseHalf', 'basehalf', '1.0.0', OPTIONS).includes('--install-agent-skill') },
			{ option: true, paths: ['notes'], without: false, help: true }
		);
	});

	test('with the option, the window that was active last among the used ones installs the skill', () => {
		const [first, second] = windows('first', 'second');
		const waits = baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [first, second], second);
		assert.deepStrictEqual(
			{ waits: !!waits, sent: sentBy([first, second]) },
			{ waits: false, sent: { first: [], second: [['page 1, when it is ready', ...install]] } }
		);
	});

	test('a window that the launch did not use is not asked: the first used one is', () => {
		const [first, second, other] = windows('first', 'second', 'other');
		baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [first, second], other);
		baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [second], undefined);
		const asked = ['page 1, when it is ready', ...install];
		assert.deepStrictEqual(sentBy([first, second, other]), { first: [asked], second: [asked], other: [] });
	});

	test('without the option, and without a window, nothing is asked', () => {
		const [window] = windows('window');
		const withoutOption = baseHalfRunLaunchCommands({}, [window], window);
		const withoutWindow = baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [], window);
		assert.deepStrictEqual({ withoutOption, withoutWindow, sent: sentBy([window]) }, { withoutOption: undefined, withoutWindow: undefined, sent: { window: [] } });
	});

	test('a window that was open is asked at once, and once more when it loads what the launch opens in it', () => {
		const [stays, loads, loadsLater] = windows('stays', 'loads', 'loadsLater');
		for (const window of [stays, loads, loadsLater]) {
			window.isReady = true;
		}
		const waiting = new DisposableStore();
		for (const window of [stays, loads, loadsLater]) {
			waiting.add(baseHalfRunLaunchCommands({ 'install-agent-skill': true }, [window], window)!);
		}
		loads.load();
		// A second load is the user's own, such as a reload: nothing is asked for it.
		loads.load();
		// What waits has an end, after which a load is no longer the launch's.
		waiting.dispose();
		loadsLater.load();
		assert.deepStrictEqual(sentBy([stays, loads, loadsLater]), {
			stays: [['page 1', ...install]],
			loads: [['page 1', ...install], ['page 2, when it is ready', ...install]],
			loadsLater: [['page 1', ...install]]
		});
	});

	test('a restart does not carry the option along, and carries everything else', () => {
		assert.deepStrictEqual(
			baseHalfRelaunchArguments(['--install-agent-skill', '/notes', '--user-data-dir=/profile', '--install-agent-skill']),
			['/notes', '--user-data-dir=/profile']
		);
	});
});

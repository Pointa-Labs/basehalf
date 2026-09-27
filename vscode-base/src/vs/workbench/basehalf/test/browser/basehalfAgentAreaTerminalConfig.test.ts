/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../base/common/platform.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IShellLaunchConfig } from '../../../../platform/terminal/common/terminal.js';
import { baseHalfCreateAgentAreaTerminalConfig, baseHalfRelaunchTerminalAfterExit } from '../../browser/basehalfAgentArea.contribution.js';
import { baseHalfTuiSessionLaunchConfig } from '../../common/basehalfAgentArea.js';
import { BASEHALF_AGENT_LAUNCH_INSTRUCTIONS } from '../../common/basehalfAgentLaunchInstructions.js';

/**
 * Follows the order in which `TerminalInstance` handles a process exit with
 * `waitOnExit` set: `onExit` fires first, and a microtask later the
 * terminal disables input and attaches its "press any key to close"
 * listener. `reuseTerminal` removes that listener, then waits for an xterm
 * write callback (a macrotask), and only then enables input again.
 */
class ExitingTerminal {
	isDisposed = false;
	pressAnyKeyToClose = false;
	inputDisabled = false;
	readonly relaunches: IShellLaunchConfig[] = [];
	private readonly onExitEmitter = new Emitter<number>();
	readonly onExit = this.onExitEmitter.event;

	exit(code: number): void {
		this.onExitEmitter.fire(code);
		void Promise.resolve().then(() => {
			this.inputDisabled = true;
			this.pressAnyKeyToClose = true;
		});
	}

	async reuseTerminal(shell: IShellLaunchConfig): Promise<void> {
		this.pressAnyKeyToClose = false;
		await timeout(0);
		this.inputDisabled = false;
		this.relaunches.push(shell);
	}

	dispose(): void {
		this.onExitEmitter.dispose();
	}
}

suite('BaseHalfAgentAreaTerminalConfig', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('passes the Claude Code launch instruction through to the terminal launch configuration', () => {
		const tui = baseHalfTuiSessionLaunchConfig('tui-claude', { isRemote: false, os: OperatingSystem.Macintosh, hasMarkedWorkspaceFolder: false });
		assert.ok(tui?.args);

		const config = baseHalfCreateAgentAreaTerminalConfig('Claude Code', { ...tui, args: [...tui.args], name: 'Claude Code' }, true) as IShellLaunchConfig;

		assert.deepStrictEqual({
			executable: config.executable,
			args: config.args,
			bridge: config.baseHalfAgentAreaNodeCommandBridge,
			hideFromUser: config.hideFromUser
		}, {
			executable: 'claude',
			args: ['--append-system-prompt', BASEHALF_AGENT_LAUNCH_INSTRUCTIONS],
			bridge: true,
			hideFromUser: true
		});
	});

	test('launches Codex and plain terminals without launch arguments', () => {
		const codex = baseHalfTuiSessionLaunchConfig('tui-codex', { isRemote: false, os: OperatingSystem.Linux, hasMarkedWorkspaceFolder: false });
		assert.ok(codex);

		const codexConfig = baseHalfCreateAgentAreaTerminalConfig('Codex', { ...codex, args: undefined, name: 'Codex' }, true) as IShellLaunchConfig;
		const terminalConfig = baseHalfCreateAgentAreaTerminalConfig('Terminal', undefined, true) as IShellLaunchConfig;

		assert.deepStrictEqual([codexConfig.args, terminalConfig.args], [undefined, undefined]);
	});

	suite('relaunch after an early exit', () => {
		const relaunched: IShellLaunchConfig = { executable: 'claude', name: 'Claude Code' };

		function exitingTerminal(): ExitingTerminal {
			const terminal = new ExitingTerminal();
			disposables.add({ dispose: () => terminal.dispose() });
			return terminal;
		}

		test('relaunches after the terminal attached its press-any-key listener, so the new session keeps its keystrokes', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const store = disposables.add(new DisposableStore());
			const errors: unknown[] = [];
			const terminal = exitingTerminal();
			store.add(terminal.onExit(() => baseHalfRelaunchTerminalAfterExit(terminal, relaunched, { isCurrent: () => true, onError: error => errors.push(error) }, store)));

			terminal.exit(1);
			await timeout(10);

			assert.deepStrictEqual({
				pressAnyKeyToClose: terminal.pressAnyKeyToClose,
				inputDisabled: terminal.inputDisabled,
				relaunches: terminal.relaunches,
				errors
			}, { pressAnyKeyToClose: false, inputDisabled: false, relaunches: [relaunched], errors: [] });

			// A relaunch started inside onExit would keep the listener, and the
			// relaunched session's first keystroke would close its terminal.
			const eager = exitingTerminal();
			store.add(eager.onExit(() => void eager.reuseTerminal(relaunched)));
			eager.exit(1);
			await timeout(10);
			assert.deepStrictEqual({ pressAnyKeyToClose: eager.pressAnyKeyToClose, relaunches: eager.relaunches.length }, { pressAnyKeyToClose: true, relaunches: 1 });
		}));

		test('skips the relaunch when the session is no longer current, the terminal was disposed, or the session closed', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const store = disposables.add(new DisposableStore());
			const replaced = exitingTerminal();
			const disposed = exitingTerminal();
			const closed = exitingTerminal();
			const closedSession = new DisposableStore();
			const onError = () => { };

			store.add(replaced.onExit(() => baseHalfRelaunchTerminalAfterExit(replaced, relaunched, { isCurrent: () => false, onError }, store)));
			store.add(disposed.onExit(() => baseHalfRelaunchTerminalAfterExit(disposed, relaunched, { isCurrent: () => true, onError }, store)));
			store.add(closed.onExit(() => baseHalfRelaunchTerminalAfterExit(closed, relaunched, { isCurrent: () => true, onError }, closedSession)));

			replaced.exit(1);
			disposed.exit(1);
			disposed.isDisposed = true;
			closed.exit(1);
			closedSession.dispose();
			await timeout(10);

			assert.deepStrictEqual([replaced.relaunches.length, disposed.relaunches.length, closed.relaunches.length], [0, 0, 0]);
		}));
	});
});

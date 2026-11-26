/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { decodeKeybinding } from '../../../../../base/common/keybindings.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IShellLaunchConfig } from '../../../../../platform/terminal/common/terminal.js';
import { baseHalfTuiSessionLaunchConfig } from '../../common/basehalfAgentArea.js';
import { BASEHALF_AGENT_LAUNCH_INSTRUCTIONS } from '../../common/basehalfAgentLaunchInstructions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { TerminalCommandId } from '../../../../contrib/terminal/common/terminal.js';
import '../../browser/basehalfAgentArea.contribution.js';
import { BaseHalfAgentAreaService } from '../../browser/basehalfAgentAreaService.js';
import { baseHalfCreateAgentAreaTerminalConfig, baseHalfRelaunchTerminalAfterExit } from '../../browser/basehalfAgentAreaTerminalConfig.js';
import { baseHalfWindowEnding } from '../../browser/basehalfAgentAreaClosing.js';
import { ShutdownReason } from '../../../../services/lifecycle/common/lifecycle.js';
import { baseHalfAgentSessionCloseQuestion } from '../../common/basehalfAgentSessionClose.js';

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

	test('the Agent Area loads: its service with its parts, and its actions', () => {
		// No other unit test evaluates these modules; a fault of one of them at load would show only in a window.
		assert.deepStrictEqual({
			service: typeof BaseHalfAgentAreaService,
			toggle: typeof CommandsRegistry.getCommand(TerminalCommandId.Toggle)?.handler
		}, { service: 'function', toggle: 'function' });
	});

	test('one command of BaseHalf\'s shows the Agent Area with a session, with the two keys that show a terminal in the base', () => {
		const keys = [KeyMod.WinCtrl | KeyCode.Backquote, KeyMod.CtrlCmd | KeyCode.KeyJ].map(key => decodeKeybinding(key, OperatingSystem.Macintosh)?.getHashCode());
		assert.deepStrictEqual({
			// BaseHalf's own Toggle Agent Area is gone: the base's toggle of the part has the name (D150).
			own: CommandsRegistry.getCommand('basehalf.agentArea.toggle'),
			keys: KeybindingsRegistry.getDefaultKeybindingsForOS(OperatingSystem.Macintosh)
				.filter(item => item.command === TerminalCommandId.Toggle)
				.map(item => keys.indexOf(item.keybinding?.getHashCode()))
				.sort()
		}, { own: undefined, keys: [0, 1] });
	});

	test('passes the Claude Code launch instruction through to the terminal launch configuration', () => {
		const tui = baseHalfTuiSessionLaunchConfig('tui-claude', { isRemote: false, os: OperatingSystem.Macintosh, hasMarkedWorkspaceFolder: false });
		assert.ok(tui?.args);

		const config = baseHalfCreateAgentAreaTerminalConfig({ ...tui, args: [...tui.args] }, true) as IShellLaunchConfig;

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

	test('declares synchronized output to Claude Code in the environment of every Agent Area terminal on macOS and Linux', () => {
		const declared = (os: OperatingSystem, config?: IShellLaunchConfig) => (baseHalfCreateAgentAreaTerminalConfig(config, false, os) as IShellLaunchConfig).env?.CLAUDE_CODE_FORCE_SYNC_OUTPUT;

		assert.deepStrictEqual({
			macOS: declared(OperatingSystem.Macintosh),
			linux: declared(OperatingSystem.Linux),
			windows: declared(OperatingSystem.Windows),
			claudeCode: declared(OperatingSystem.Macintosh, { executable: 'claude' }),
			ownValue: declared(OperatingSystem.Macintosh, { executable: 'claude', env: { CLAUDE_CODE_FORCE_SYNC_OUTPUT: '0' } })
		}, {
			macOS: '1',
			linux: '1',
			windows: undefined,
			claudeCode: '1',
			ownValue: '0'
		});
	});

	test('launches Codex and plain terminals without launch arguments', () => {
		const codex = baseHalfTuiSessionLaunchConfig('tui-codex', { isRemote: false, os: OperatingSystem.Linux, hasMarkedWorkspaceFolder: false });
		assert.ok(codex);

		const codexConfig = baseHalfCreateAgentAreaTerminalConfig({ ...codex, args: undefined }, true) as IShellLaunchConfig;
		const terminalConfig = baseHalfCreateAgentAreaTerminalConfig(undefined, true) as IShellLaunchConfig;

		assert.deepStrictEqual([codexConfig.args, terminalConfig.args], [undefined, undefined]);
	});

	test('the question before a window closes names what the answer does, also when another folder is opened in the window', () => {
		const button = (reason: ShutdownReason) => baseHalfAgentSessionCloseQuestion(baseHalfWindowEnding(reason), ['sleep']).primaryButton;
		assert.deepStrictEqual(
			[button(ShutdownReason.CLOSE), button(ShutdownReason.QUIT), button(ShutdownReason.RELOAD), button(ShutdownReason.LOAD)],
			['Close Window', 'Quit', 'Reload Window', 'Close Folder']
		);
	});

	test('starts every session as one the base does not keep, with and without the command bridge', () => {
		const codex = baseHalfTuiSessionLaunchConfig('tui-codex', { isRemote: true, os: OperatingSystem.Linux, hasMarkedWorkspaceFolder: false });
		assert.ok(codex);
		const transient = (config: Parameters<typeof baseHalfCreateAgentAreaTerminalConfig>[0], usesNodeRunBridge: boolean) => {
			const created = baseHalfCreateAgentAreaTerminalConfig(config, usesNodeRunBridge) as IShellLaunchConfig;
			return [created.isTransient, created.hideFromUser];
		};
		assert.deepStrictEqual({
			plain: [transient(undefined, true), transient(undefined, false)],
			agent: [transient({ ...codex, args: undefined }, true), transient({ ...codex, args: undefined }, false)],
			shell: [transient({ executable: '/bin/zsh' }, true), transient({ executable: '/bin/zsh', isTransient: false }, false)],
			profile: [transient({ profileName: 'zsh', path: '/bin/zsh', isDefault: true }, true), transient({ profileName: 'zsh', path: '/bin/zsh', isDefault: true }, false)]
		}, {
			plain: [[true, true], [true, true]],
			agent: [[true, true], [true, true]],
			shell: [[true, true], [true, true]],
			profile: [[true, true], [true, true]]
		});
	});

	test('gives a terminal no name, so that its tab follows the settings, and keeps a name its creator gave', () => {
		const claude = baseHalfTuiSessionLaunchConfig('tui-claude', { isRemote: false, os: OperatingSystem.Macintosh, hasMarkedWorkspaceFolder: true });
		assert.ok(claude);
		const name = (config: Parameters<typeof baseHalfCreateAgentAreaTerminalConfig>[0]) => (baseHalfCreateAgentAreaTerminalConfig(config, false) as IShellLaunchConfig).name;

		assert.deepStrictEqual({
			plain: name(undefined),
			agent: name({ ...claude, args: undefined }),
			shell: name({ executable: '/bin/zsh' }),
			named: name({ executable: '/bin/zsh', name: 'Build' }),
			profile: name({ profileName: 'zsh', path: '/bin/zsh', isDefault: true }),
			profileThatNames: name({ profileName: 'Tools', path: '/bin/zsh', isDefault: false, overrideName: true })
		}, {
			plain: undefined,
			agent: undefined,
			shell: undefined,
			named: 'Build',
			profile: undefined,
			profileThatNames: 'Tools'
		});
	});

	suite('relaunch after an early exit', () => {
		const relaunched: IShellLaunchConfig = { executable: 'claude' };

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

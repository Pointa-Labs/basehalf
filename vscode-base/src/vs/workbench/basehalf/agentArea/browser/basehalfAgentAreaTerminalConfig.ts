/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { ITerminalEnvironment, IShellLaunchConfig } from '../../../../platform/terminal/common/terminal.js';
import { ICreateTerminalOptions, ITerminalInstance } from '../../../contrib/terminal/browser/terminal.js';
import { OperatingSystem, OS } from '../../../../base/common/platform.js';
import { hasKey } from '../../../../base/common/types.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { disposableTimeout } from '../../../../base/common/async.js';


// How the terminal of an Agent Area session starts: its configuration and environment, and whether a terminal
// that ended is started again without the launch instructions (Agent Area terminal).

const BASEHALF_GHOSTTY_TERMINAL_ENV: ITerminalEnvironment = {
	TERM: 'xterm-256color',
	COLORTERM: 'truecolor',
	NO_COLOR: null,
	NODE_DISABLE_COLORS: null,
	FORCE_COLOR: null,
	CLICOLOR: '1',
	CLICOLOR_FORCE: null
};

/**
 * Tells Claude Code that the terminal supports synchronized output, which it
 * does not detect under BaseHalf's name before it decides how to scroll. With
 * it, Claude Code moves its transcript with scroll regions instead of sending
 * every row again (docs/specs/agent-area-terminal.md, Scroll regions for
 * Claude Code).
 */
const BASEHALF_SYNCHRONIZED_OUTPUT_ENV: ITerminalEnvironment = {
	CLAUDE_CODE_FORCE_SYNC_OUTPUT: '1'
};

/**
 * The launch configuration of an Agent Area terminal. Launch arguments of a
 * plain shell launch configuration (such as a TUI session's launch
 * instruction) pass through unchanged.
 */
export function baseHalfCreateAgentAreaTerminalConfig(label: string, config: ICreateTerminalOptions['config'], usesNodeRunBridge: boolean, os: OperatingSystem = OS): ICreateTerminalOptions['config'] {
	const baseHalfAgentAreaNodeCommandBridge = usesNodeRunBridge ? true : undefined;
	const isTransient = baseHalfAgentAreaNodeCommandBridge ? true : undefined;
	if (!config) {
		return { name: label, env: createAgentAreaTerminalEnv(os), hideFromUser: true, baseHalfAgentAreaNodeCommandBridge, isTransient };
	}

	if (hasKey(config, { extensionIdentifier: true })) {
		return config;
	}

	if (hasKey(config, { profileName: true }) && config.path) {
		const profile = config;
		return {
			executable: profile.path,
			args: profile.args,
			env: createAgentAreaTerminalEnv(os, profile.env),
			icon: profile.icon,
			color: profile.color,
			name: profile.overrideName ? profile.profileName : label,
			hideFromUser: true,
			baseHalfAgentAreaNodeCommandBridge,
			isTransient
		};
	}

	const shellLaunchConfig = config as IShellLaunchConfig;
	return {
		...shellLaunchConfig,
		env: createAgentAreaTerminalEnv(os, shellLaunchConfig.env),
		name: shellLaunchConfig.name ?? label,
		hideFromUser: true,
		baseHalfAgentAreaNodeCommandBridge,
		isTransient: isTransient ?? shellLaunchConfig.isTransient
	};
}

function createAgentAreaTerminalEnv(os: OperatingSystem, env?: ITerminalEnvironment): ITerminalEnvironment {
	return {
		...BASEHALF_GHOSTTY_TERMINAL_ENV,
		// On Windows a pseudoconsole stands between the program and the terminal.
		...(os === OperatingSystem.Windows ? undefined : BASEHALF_SYNCHRONIZED_OUTPUT_ENV),
		...env
	};
}

/**
 * Relaunch `terminal` with `shellLaunchConfig` after VS Code finished handling
 * the process exit that asked for it. A terminal fires `onExit` first and
 * only then, in a microtask, writes its exit and wait-on-exit messages,
 * disables input, and attaches its "press any key to close" listener.
 * `reuseTerminal` removes that listener and enables input again, so it must
 * run after them. A relaunch started inside `onExit` leaves the listener
 * attached, and the relaunched session's first keystroke closes it.
 *
 * The relaunch is skipped when the terminal was disposed or `isCurrent`
 * returns false by then. Disposing `store` cancels a pending relaunch.
 */
export function baseHalfRelaunchTerminalAfterExit(
	terminal: Pick<ITerminalInstance, 'isDisposed' | 'reuseTerminal'>,
	shellLaunchConfig: IShellLaunchConfig,
	options: { readonly isCurrent: () => boolean; readonly onError: (error: unknown) => void },
	store: DisposableStore
): void {
	disposableTimeout(() => {
		if (terminal.isDisposed || !options.isCurrent()) {
			return;
		}
		terminal.reuseTerminal(shellLaunchConfig).catch(options.onError);
	}, 0, store);
}

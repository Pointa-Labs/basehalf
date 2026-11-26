/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { INativeRunActionInWindowRequest } from '../../window/common/window.js';

/**
 * Install Agent Skill, the command of a window. It is named here because the
 * main process asks a window for it when the command line carries
 * `--install-agent-skill` (agent skill, "Commands"; D156).
 */
export const BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID = 'basehalf.agentSkill.install';

/** The option as a command line spells it. */
const INSTALL_AGENT_SKILL_ARGUMENT = '--install-agent-skill';

/**
 * How long after a launch a window that was open may still begin to load
 * what the launch opens in it. The window first asks the page it shows
 * whether it may go, which a question about unsaved work can hold up; a page
 * that waits that long has run the command long before.
 */
const BASEHALF_LAUNCH_RELOAD_MS = 30_000;

/** What this reads of the arguments of a command line. */
export interface IBaseHalfLaunchArguments {
	readonly 'install-agent-skill'?: boolean;
}

/** What this needs of a window of the main process. */
export interface IBaseHalfLaunchWindow {
	/** Whether the page of the window can take a command now. */
	readonly isReady: boolean;
	/** The window begins to load a page, in place of the one it shows. */
	readonly onWillLoad: Event<unknown>;
	sendWhenReady(channel: string, token: CancellationToken, ...args: unknown[]): void;
}

/**
 * The window that runs what a command line asked of the windows: of the
 * windows the launch opened or brought forward, the one that was active
 * last, and otherwise the first.
 */
export function baseHalfLaunchCommandWindow<T>(usedWindows: readonly T[], lastActive: T | undefined): T | undefined {
	return lastActive !== undefined && usedWindows.includes(lastActive) ? lastActive : usedWindows.at(0);
}

/**
 * Runs what the command line of a launch asked of a window, once that window
 * can take a command: with `--install-agent-skill`, Install Agent Skill. A
 * launch that used no window asks none.
 *
 * A window that was open can be about to load the folder of this launch in
 * place of what it shows. The page that took the command goes then, maybe
 * before it ran it, so the page that comes is asked again; installing twice
 * changes nothing. Returns what waits for that, or nothing when no window
 * was asked or none can load: disposing it stops the wait.
 */
export function baseHalfRunLaunchCommands<T extends IBaseHalfLaunchWindow>(args: IBaseHalfLaunchArguments, usedWindows: readonly T[], lastActive: T | undefined): IDisposable | undefined {
	if (!args['install-agent-skill']) {
		return undefined;
	}
	const window = baseHalfLaunchCommandWindow(usedWindows, lastActive);
	if (!window) {
		return undefined;
	}
	const request: INativeRunActionInWindowRequest = { id: BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID, from: 'cli' };
	const ask = () => window.sendWhenReady('vscode:runAction', CancellationToken.None, request);
	const wasReady = window.isReady;
	ask();
	if (!wasReady) {
		// A window that is loading runs the command in the page it loads.
		return undefined;
	}
	const reload = new DisposableStore();
	reload.add(Event.once(window.onWillLoad)(() => {
		reload.dispose();
		ask();
	}));
	reload.add(disposableTimeout(() => reload.dispose(), BASEHALF_LAUNCH_RELOAD_MS));
	return reload;
}

/**
 * The arguments BaseHalf starts itself again with. What a command line asked
 * once is not asked again by a restart: a BaseHalf that restarts for an
 * update would otherwise install the skill anew, also after the user removed
 * it.
 */
export function baseHalfRelaunchArguments(args: readonly string[]): string[] {
	return args.filter(argument => argument !== INSTALL_AGENT_SKILL_ARGUMENT);
}

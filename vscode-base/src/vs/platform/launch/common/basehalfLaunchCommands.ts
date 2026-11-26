/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { INativeRunActionInWindowRequest } from '../../window/common/window.js';

/**
 * Install Agent Skill, the command of a window. It is named here because the
 * main process asks a window for it when the command line carries
 * `--install-agent-skill` (agent skill, "Commands"; D156).
 */
export const BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID = 'basehalf.agentSkill.install';

/** What this reads of the arguments of a command line. */
export interface IBaseHalfLaunchArguments {
	readonly 'install-agent-skill'?: boolean;
}

/** What this needs of a window of the main process. */
export interface IBaseHalfLaunchWindow {
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
 * can take a command: with `--install-agent-skill`, Install Agent Skill.
 * Returns whether a window was asked. A launch that used no window asks
 * none.
 */
export function baseHalfRunLaunchCommands<T extends IBaseHalfLaunchWindow>(args: IBaseHalfLaunchArguments, usedWindows: readonly T[], lastActive: T | undefined): boolean {
	if (!args['install-agent-skill']) {
		return false;
	}
	const window = baseHalfLaunchCommandWindow(usedWindows, lastActive);
	if (!window) {
		return false;
	}
	const request: INativeRunActionInWindowRequest = { id: BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID, from: 'cli' };
	window.sendWhenReady('vscode:runAction', CancellationToken.None, request);
	return true;
}

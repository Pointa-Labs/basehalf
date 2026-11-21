/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import type { BaseHalfAgentSessionKind } from './basehalfAgentArea.js';

// Closing with something running: when a session of the Agent Area counts as running, which values of the
// base's settings ask before sessions or the window close, and what the question says
// (docs/specs/agent-area-terminal.md, Closing with something running).

/** What a session's terminal says of its program. */
export interface IBaseHalfAgentSessionProgram {
	readonly kind: BaseHalfAgentSessionKind;
	/** The program of the terminal has started and has not ended. */
	readonly programRuns: boolean;
	/** The program of the terminal has a child process, as the base counts them. */
	readonly hasChildProcesses: boolean;
}

/**
 * Whether something runs in a session. An agent is the program of its terminal, as if a shell had started it;
 * a shell runs something when it has a child process. A session that an extension draws has no terminal.
 */
export function baseHalfSomethingRunsInAgentSession(program: IBaseHalfAgentSessionProgram): boolean {
	switch (program.kind) {
		case 'tui-codex':
		case 'tui-claude':
			return program.programRuns;
		case 'terminal':
			return program.programRuns && program.hasChildProcesses;
		case 'extension-codex':
		case 'extension-claude':
			return false;
	}
}

/**
 * Whether `terminal.integrated.confirmOnKill` asks before a session in which something runs is closed. The
 * Agent Area stands in the place of the base's panel, and BaseHalf has no terminal in the editor area.
 */
export function baseHalfClosingSessionAsks(confirmOnKill: unknown): boolean {
	return confirmOnKill === 'panel' || confirmOnKill === 'always';
}

/** Whether `terminal.integrated.confirmOnExit` asks before the window closes, for its terminal sessions. */
export function baseHalfClosingWindowAsks(confirmOnExit: unknown, sessions: readonly { readonly running: boolean }[]): boolean {
	switch (confirmOnExit) {
		case 'always':
			return sessions.length > 0;
		case 'hasChildProcesses':
			return sessions.some(session => session.running);
		default:
			return false;
	}
}

/** What ends the sessions that a question is about. */
export type BaseHalfAgentSessionEnding = 'close' | 'kill' | 'closeWindow' | 'quit' | 'reloadWindow';

export interface IBaseHalfAgentSessionCloseQuestion {
	readonly message: string;
	readonly primaryButton: string;
}

/**
 * The question before sessions end. `running` holds the names of the sessions in which something runs, and
 * `open` counts every terminal session, which matters only where a window asks though nothing runs.
 */
export function baseHalfAgentSessionCloseQuestion(ending: BaseHalfAgentSessionEnding, running: readonly string[], open: number = running.length): IBaseHalfAgentSessionCloseQuestion {
	let message: string;
	if (running.length === 1) {
		message = localize('basehalf.agentArea.close.oneRunning', "“{0}” is still running.", running[0]);
	} else if (running.length > 1) {
		message = localize('basehalf.agentArea.close.severalRunning', "{0} sessions are still running.", running.length);
	} else if (open === 1) {
		message = localize('basehalf.agentArea.close.oneOpen', "The Agent Area has an open session.");
	} else {
		message = localize('basehalf.agentArea.close.severalOpen', "The Agent Area has {0} open sessions.", open);
	}
	return { message, primaryButton: primaryButton(ending, running.length > 1) };
}

function primaryButton(ending: BaseHalfAgentSessionEnding, several: boolean): string {
	switch (ending) {
		case 'close':
			return several
				? localize('basehalf.agentArea.close.closeSessions', "Close Sessions")
				: localize('basehalf.agentArea.close.closeSession', "Close Session");
		case 'kill':
			return localize('basehalf.agentArea.close.killSession', "Kill Session");
		case 'closeWindow':
			return localize('basehalf.agentArea.close.closeWindow', "Close Window");
		case 'quit':
			return localize('basehalf.agentArea.close.quit', "Quit");
		case 'reloadWindow':
			return localize('basehalf.agentArea.close.reloadWindow', "Reload Window");
	}
}

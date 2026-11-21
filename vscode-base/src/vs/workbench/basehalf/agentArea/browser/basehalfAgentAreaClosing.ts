/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { TerminalSettingId } from '../../../../platform/terminal/common/terminal.js';
import { ShutdownReason } from '../../../services/lifecycle/common/lifecycle.js';
import { BaseHalfAgentSessionEnding, baseHalfAgentSessionCloseQuestion, baseHalfClosingSessionAsks, baseHalfClosingWindowAsks, baseHalfSomethingRunsInAgentSession } from '../common/basehalfAgentSessionClose.js';
import type { BaseHalfAgentAreaService, IBaseHalfRuntimeAgentSession } from './basehalfAgentAreaService.js';

/**
 * Closing with something running: the question before sessions are closed or killed, and before the window
 * closes, as the base's settings of a terminal say (docs/specs/agent-area-terminal.md).
 *
 * A part of the Agent Area (`basehalfAgentAreaService.ts`): it keeps its own state, and reaches the
 * Agent Area's as `area`.
 */
export class BaseHalfAgentAreaClosing {
	/** The sessions that an open question is about. */
	private readonly asked = new Set<string>();

	constructor(private readonly area: BaseHalfAgentAreaService) { }

	/** Whether something runs in a session: an agent's program, or a child process of a shell. */
	somethingRuns(session: IBaseHalfRuntimeAgentSession): boolean {
		const terminal = session.terminal;
		if (!terminal || terminal.isDisposed) {
			return false;
		}
		return baseHalfSomethingRunsInAgentSession({
			kind: session.kind,
			programRuns: terminal.processId !== undefined && terminal.exitCode === undefined,
			hasChildProcesses: terminal.hasChildProcesses
		});
	}

	/**
	 * Asks before the sessions of `paneIds` end, when `terminal.integrated.confirmOnKill` says so and something
	 * runs in one of them. Resolves to whether they may end. A request that names a session of an open
	 * question resolves to false: that question decides.
	 */
	async confirmEnding(paneIds: readonly string[], ending: Extract<BaseHalfAgentSessionEnding, 'close' | 'kill'>): Promise<boolean> {
		if (paneIds.some(paneId => this.asked.has(paneId))) {
			return false;
		}
		const running = paneIds
			.map(paneId => this.area.runtime.get(paneId))
			.filter((session): session is IBaseHalfRuntimeAgentSession => !!session && this.somethingRuns(session));
		if (!running.length || !baseHalfClosingSessionAsks(this.area.configurationService.getValue(TerminalSettingId.ConfirmOnKill))) {
			return true;
		}
		const question = baseHalfAgentSessionCloseQuestion(ending, running.map(session => this.area.sessionName(session)));
		for (const paneId of paneIds) {
			this.asked.add(paneId);
		}
		try {
			const { confirmed } = await this.area.dialogService.confirm({ type: 'warning', ...question });
			if (!confirmed) {
				this.keepKeyboard();
			}
			return confirmed;
		} finally {
			for (const paneId of paneIds) {
				this.asked.delete(paneId);
			}
		}
	}

	/**
	 * After Cancel the keyboard is where it was. A question asked from a menu finds the keyboard in the menu,
	 * which is gone when the question closes: the keyboard then goes to the pane in front.
	 */
	private keepKeyboard(): void {
		const active = mainWindow.document.activeElement;
		if (!active || active === mainWindow.document.body) {
			void this.area.surface.focusActivePane();
		}
	}

	/**
	 * Asks before the window closes, when `terminal.integrated.confirmOnExit` says so. Resolves to whether the
	 * window stays. A session whose tab was closed and that has not ended yet counts.
	 */
	async vetoWindowClose(reason: ShutdownReason): Promise<boolean> {
		const sessions = [...this.area.runtime.values()]
			.filter(session => !!session.terminal && !session.terminal.isDisposed)
			.map(session => ({ session, running: this.somethingRuns(session) }));
		if (!baseHalfClosingWindowAsks(this.area.configurationService.getValue(TerminalSettingId.ConfirmOnExit), sessions)) {
			return false;
		}
		const ending: BaseHalfAgentSessionEnding = reason === ShutdownReason.QUIT ? 'quit' : reason === ShutdownReason.RELOAD ? 'reloadWindow' : 'closeWindow';
		const running = sessions.filter(entry => entry.running).map(entry => this.area.sessionName(entry.session));
		const { confirmed } = await this.area.dialogService.confirm({ type: 'warning', ...baseHalfAgentSessionCloseQuestion(ending, running, sessions.length) });
		return !confirmed;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfAgentSessionKind, baseHalfAgentSessionChoiceForKind, IBaseHalfCreateAgentTerminalOptions, baseHalfHasAgentLaunchInstructions, baseHalfAgentSessionUsesLocalNodeRunBridge, baseHalfTuiSessionLaunchConfig, baseHalfStripAgentLaunchInstructions, baseHalfTuiSessionLaunchFailureGuidance } from '../common/basehalfAgentArea.js';
import { ITerminalInstance, ICreateTerminalOptions } from '../../../contrib/terminal/browser/terminal.js';
import { removeAgentPane, markAgentPaneActivity } from '../common/basehalfAgentTabsModel.js';
import { Severity } from '../../../../platform/notification/common/notification.js';
import { type IShellLaunchConfig, type ITerminalLaunchError } from '../../../../platform/terminal/common/terminal.js';
import { isObject, hasKey } from '../../../../base/common/types.js';
import { baseHalfInstallTerminalEdges } from './basehalfTerminalEdges.js';
import { OS } from '../../../../base/common/platform.js';
import { baseHalfCreateAgentAreaTerminalConfig, baseHalfRelaunchTerminalAfterExit } from './basehalfAgentAreaTerminalConfig.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfSourceTreeMarker.js';
import type { BaseHalfAgentAreaService, IBaseHalfRuntimeAgentSession } from './basehalfAgentAreaService.js';

/**
 * The panes that hold a terminal: the options a session's terminal starts with, attaching a terminal to its
 * pane, and what a terminal that ended or could not start leaves in the pane.
 *
 * A part of the Agent Area (`basehalfAgentAreaService.ts`): it reaches the Agent Area's state as `area`.
 */
export class BaseHalfAgentAreaTerminalPanes {
	constructor(private readonly area: BaseHalfAgentAreaService) { }

	async initializeTerminalPane(session: IBaseHalfRuntimeAgentSession, options: IBaseHalfCreateAgentTerminalOptions): Promise<void> {
		try {
			const hasMarkedWorkspaceFolder = session.kind === 'tui-claude' ? await this.hasMarkedWorkspaceFolder() : false;
			// With the BaseHalf skill installed for Claude Code, the launch
			// context only points at it. Read at each launch, so a session
			// started after the user installs the skill uses the pointer.
			const agentSkillInstalled = session.kind === 'tui-claude' && await this.area.agentSkillService.isInstalledFor('claude').catch(() => false);
			const terminalOptions = this.createTerminalOptions(session.kind, session.label, options, {
				hasMarkedWorkspaceFolder,
				launchInstructions: session.launchInstructions.enabled,
				agentSkillInstalled
			});
			const terminal = await this.area.terminalService.createTerminal(terminalOptions);
			session.launchInstructions.didLaunch(baseHalfHasAgentLaunchInstructions(terminal.shellLaunchConfig.args));
			await this.attachTerminalToSession(session, terminal, options.command ?? baseHalfAgentSessionChoiceForKind(session.kind).terminalCommand);
		} catch (error) {
			this.area.markSessionFailed(session, error);
		}
	}

	isTerminalInstance(candidate: unknown): candidate is ITerminalInstance {
		return isObject(candidate)
			&& typeof (candidate as Partial<ITerminalInstance>).attachToElement === 'function'
			&& typeof (candidate as Partial<ITerminalInstance>).setVisible === 'function'
			&& typeof (candidate as Partial<ITerminalInstance>).focusWhenReady === 'function';
	}

	async attachTerminalToSession(session: IBaseHalfRuntimeAgentSession, terminal: ITerminalInstance, command?: string, focus = true): Promise<void> {
		session.terminal = terminal;
		this.area.rememberTerminalProcess(session, terminal);
		session.disposables.add(terminal.onDisposed(() => this.handleTerminalDisposed(session)));
		session.disposables.add(terminal.onTitleChanged(instance => {
			if (instance.title && session.label !== instance.title) {
				session.label = instance.title;
				this.area.render();
			}
		}));
		session.disposables.add(terminal.onData(() => {
			this.area.mutateTabs(state => markAgentPaneActivity(state, session.id));
		}));
		session.disposables.add(terminal.onDidInputData(() => session.launchInstructions.didReceiveUserInput()));
		session.disposables.add(terminal.onProcessIdReady(() => {
			this.area.rememberTerminalProcess(session, terminal);
			this.area.surface.clearSessionStatePanel(session);
			if (session.state === 'starting' || session.state === 'exited' || session.state === 'failed') {
				session.state = 'ready';
				session.detail = command ? `Running ${command}` : undefined;
				this.area.render();
			}
		}));
		session.disposables.add(terminal.onExit(exit => this.markTerminalProcessExited(session, exit)));

		terminal.attachToElement(session.surface);
		void terminal.xtermReadyPromise.then(xterm => {
			if (xterm && session.terminal === terminal && !session.disposables.isDisposed) {
				session.edges.value = baseHalfInstallTerminalEdges(session.host, xterm.raw, () => this.area.logService.warn('Agent Area terminal: xterm.js color internals are missing; the pane keeps the theme background around the grid.'));
			}
		});
		this.setActiveTerminalForVsCodeCompatibility(terminal);
		if (!command) {
			session.state = 'ready';
			session.detail = undefined;
		}
		this.area.render();
		if (focus) {
			await this.area.surface.focusActivePane();
		}
	}

	private handleTerminalDisposed(session: IBaseHalfRuntimeAgentSession): void {
		if (!this.area.runtime.has(session.id)) {
			return; // already finalized/destroyed
		}
		this.area.runtime.delete(session.id);
		this.area.disposeRuntimeSession(session, false);
		this.area.mutateTabs(state => removeAgentPane(state, session.id));
		this.area.render();
	}

	private createTerminalOptions(
		kind: BaseHalfAgentSessionKind,
		label: string,
		options: IBaseHalfCreateAgentTerminalOptions,
		launch: { readonly hasMarkedWorkspaceFolder: boolean; readonly launchInstructions: boolean; readonly agentSkillInstalled: boolean }
	): ICreateTerminalOptions | undefined {
		const isRemote = !!this.area.remoteAgentService.getConnection();
		const usesNodeRunBridge = baseHalfAgentSessionUsesLocalNodeRunBridge(kind, isRemote);
		const tuiConfig = baseHalfTuiSessionLaunchConfig(kind, { isRemote, os: OS, ...launch });
		if (tuiConfig) {
			return {
				config: baseHalfCreateAgentAreaTerminalConfig(label, {
					...tuiConfig,
					args: tuiConfig.args ? [...tuiConfig.args] : undefined,
					name: label
				}, usesNodeRunBridge)
			};
		}

		const raw = this.asTerminalOptions(options.rawTerminalOptions);
		const terminalOptions: ICreateTerminalOptions = raw ? { ...raw } : {};
		terminalOptions.config = baseHalfCreateAgentAreaTerminalConfig(label, terminalOptions.config, usesNodeRunBridge);
		return terminalOptions;
	}

	/** Development sessions on the BaseHalf source tree must not receive
	 *  product instructions; an undeterminable marker counts as present. */
	private async hasMarkedWorkspaceFolder(): Promise<boolean> {
		const markers = await Promise.all(this.area.workspaceContextService.getWorkspace().folders.map(folder => baseHalfIsWorkspaceFolderMarked(this.area.fileService, folder.uri)));
		return markers.some(marked => marked);
	}

	/**
	 * An installed Claude Code that rejects the launch-instruction argument
	 * exits right away. Relaunch that session once without the argument; it
	 * and its restarts then continue without launch context. Called from the
	 * terminal's `onExit`, so the relaunch waits for the terminal's own exit
	 * handling (see {@link baseHalfRelaunchTerminalAfterExit}).
	 */
	private relaunchWithoutLaunchInstructions(session: IBaseHalfRuntimeAgentSession, terminal: ITerminalInstance, exitCode: number): void {
		this.area.logService.warn(`[BaseHalf] ${session.label} exited with code ${exitCode} right after launch with the BaseHalf launch instruction; relaunching this session without it.`);
		session.state = 'starting';
		session.detail = 'Restarting without BaseHalf launch context';
		this.area.surface.clearSessionStatePanel(session);
		this.area.render();
		const shellLaunchConfig: IShellLaunchConfig = {
			...terminal.shellLaunchConfig,
			args: baseHalfStripAgentLaunchInstructions(terminal.shellLaunchConfig.args)
		};
		delete shellLaunchConfig.attachPersistentProcess;
		session.launchInstructions.didLaunch(false);
		baseHalfRelaunchTerminalAfterExit(terminal, shellLaunchConfig, {
			isCurrent: () => !session.closing && session.state !== 'disposed' && session.terminal === terminal,
			onError: error => this.area.markSessionFailed(session, error)
		}, session.disposables);
	}

	setActiveTerminalForVsCodeCompatibility(terminal: ITerminalInstance): void {
		if (!terminal.shellLaunchConfig.hideFromUser) {
			this.area.terminalService.setActiveInstance(terminal);
		}
	}

	private asTerminalOptions(raw: unknown): ICreateTerminalOptions | undefined {
		if (!isObject(raw)) {
			return undefined;
		}
		if (hasKey(raw as Partial<Record<'target' | 'currentTarget', unknown>>, { target: true, currentTarget: true })) {
			return undefined;
		}
		return raw as ICreateTerminalOptions;
	}

	private markTerminalProcessExited(session: IBaseHalfRuntimeAgentSession, exit: number | ITerminalLaunchError | undefined): void {
		if (session.closing || session.state === 'disposed') {
			return;
		}

		if (typeof exit === 'number' && session.terminal && !session.terminal.isDisposed && session.launchInstructions.shouldRelaunchWithoutInstructions(exit)) {
			this.relaunchWithoutLaunchInstructions(session, session.terminal, exit);
			return;
		}

		if (this.isTerminalLaunchError(exit)) {
			session.state = 'failed';
			const message = exit.code === undefined ? exit.message : `${exit.message} (${exit.code})`;
			const guidance = baseHalfTuiSessionLaunchFailureGuidance(session.kind);
			session.detail = guidance ? `${message}. ${guidance}` : message;
			this.area.surface.renderSessionStatePanel(session);
			this.area.render();
			this.area.logService.error(`BaseHalf Agent Area terminal process failed: ${session.detail}`);
			this.area.notificationService.notify({
				severity: Severity.Error,
				message: `BaseHalf Agent Area terminal process failed for ${session.label}: ${session.detail}`
			});
			return;
		}

		session.state = 'exited';
		session.detail = exit === undefined || exit === 0
			? `${session.label} session ended`
			: `${session.label} exited with code ${exit}`;
		this.area.render();
	}

	private isTerminalLaunchError(candidate: unknown): candidate is ITerminalLaunchError {
		return isObject(candidate) && typeof (candidate as Partial<ITerminalLaunchError>).message === 'string';
	}
}

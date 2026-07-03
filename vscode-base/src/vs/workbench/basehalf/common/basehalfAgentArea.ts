/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IBaseHalfAgentAreaService = createDecorator<IBaseHalfAgentAreaService>('baseHalfAgentAreaService');

export const BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID = 'basehalf.agentArea.toggle';
export const BASEHALF_AGENT_AREA_NEW_TERMINAL_COMMAND_ID = 'basehalf.agentArea.newTerminal';
export const BASEHALF_AGENT_AREA_NEW_CODEX_TUI_COMMAND_ID = 'basehalf.agentArea.newCodexTui';
export const BASEHALF_AGENT_AREA_NEW_CLAUDE_TUI_COMMAND_ID = 'basehalf.agentArea.newClaudeTui';
export const BASEHALF_AGENT_AREA_NEW_CODEX_EXTENSION_COMMAND_ID = 'basehalf.agentArea.newCodexExtension';
export const BASEHALF_AGENT_AREA_NEW_CLAUDE_EXTENSION_COMMAND_ID = 'basehalf.agentArea.newClaudeExtension';
export const BASEHALF_AGENT_AREA_RESTART_ACTIVE_COMMAND_ID = 'basehalf.agentArea.restartActive';
export const BASEHALF_AGENT_AREA_KILL_ACTIVE_COMMAND_ID = 'basehalf.agentArea.killActive';
export const BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID = 'basehalf.internal.terminal.toggleView';

export const BASEHALF_AGENT_AREA_NEW_TAB_COMMAND_ID = 'basehalf.agentArea.newTab';
export const BASEHALF_AGENT_AREA_CLOSE_PANE_COMMAND_ID = 'basehalf.agentArea.closePane';
export const BASEHALF_AGENT_AREA_CLOSE_TAB_COMMAND_ID = 'basehalf.agentArea.closeTab';
export const BASEHALF_AGENT_AREA_SPLIT_RIGHT_COMMAND_ID = 'basehalf.agentArea.splitPaneRight';
export const BASEHALF_AGENT_AREA_SPLIT_DOWN_COMMAND_ID = 'basehalf.agentArea.splitPaneDown';
export const BASEHALF_AGENT_AREA_FOCUS_PANE_LEFT_COMMAND_ID = 'basehalf.agentArea.focusPaneLeft';
export const BASEHALF_AGENT_AREA_FOCUS_PANE_RIGHT_COMMAND_ID = 'basehalf.agentArea.focusPaneRight';
export const BASEHALF_AGENT_AREA_FOCUS_PANE_UP_COMMAND_ID = 'basehalf.agentArea.focusPaneUp';
export const BASEHALF_AGENT_AREA_FOCUS_PANE_DOWN_COMMAND_ID = 'basehalf.agentArea.focusPaneDown';
export const BASEHALF_AGENT_AREA_FOCUS_NEXT_PANE_COMMAND_ID = 'basehalf.agentArea.focusNextPane';
export const BASEHALF_AGENT_AREA_FOCUS_PREVIOUS_PANE_COMMAND_ID = 'basehalf.agentArea.focusPreviousPane';
export const BASEHALF_AGENT_AREA_NEXT_TAB_COMMAND_ID = 'basehalf.agentArea.nextTab';
export const BASEHALF_AGENT_AREA_PREVIOUS_TAB_COMMAND_ID = 'basehalf.agentArea.previousTab';
export const BASEHALF_AGENT_AREA_RESIZE_PANE_LEFT_COMMAND_ID = 'basehalf.agentArea.resizePaneLeft';
export const BASEHALF_AGENT_AREA_RESIZE_PANE_RIGHT_COMMAND_ID = 'basehalf.agentArea.resizePaneRight';
export const BASEHALF_AGENT_AREA_RESIZE_PANE_UP_COMMAND_ID = 'basehalf.agentArea.resizePaneUp';
export const BASEHALF_AGENT_AREA_RESIZE_PANE_DOWN_COMMAND_ID = 'basehalf.agentArea.resizePaneDown';
export const BASEHALF_AGENT_AREA_EQUALIZE_PANES_COMMAND_ID = 'basehalf.agentArea.equalizePanes';
export const BASEHALF_AGENT_AREA_TOGGLE_ZOOM_COMMAND_ID = 'basehalf.agentArea.togglePaneZoom';
export const BASEHALF_AGENT_AREA_GOTO_TAB_COMMAND_IDS = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `basehalf.agentArea.gotoTab${n}`);
export const BASEHALF_AGENT_AREA_LAST_TAB_COMMAND_ID = 'basehalf.agentArea.lastTab';

/**
 * Every Agent Area command with a keybinding that must fire while an xterm
 * inside the area owns keyboard focus. The terminal swallows keydowns unless
 * the bound command is in the commands-to-skip-shell list, so this array is
 * spliced into the terminal's default skip-shell commands.
 */
export const BASEHALF_AGENT_AREA_SKIP_SHELL_COMMAND_IDS: readonly string[] = [
	BASEHALF_AGENT_AREA_NEW_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_CLOSE_PANE_COMMAND_ID,
	BASEHALF_AGENT_AREA_CLOSE_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_SPLIT_RIGHT_COMMAND_ID,
	BASEHALF_AGENT_AREA_SPLIT_DOWN_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_LEFT_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_RIGHT_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_UP_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_DOWN_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_NEXT_PANE_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PREVIOUS_PANE_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEXT_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_PREVIOUS_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_LEFT_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_RIGHT_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_UP_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_DOWN_COMMAND_ID,
	BASEHALF_AGENT_AREA_EQUALIZE_PANES_COMMAND_ID,
	BASEHALF_AGENT_AREA_TOGGLE_ZOOM_COMMAND_ID,
	...BASEHALF_AGENT_AREA_GOTO_TAB_COMMAND_IDS,
	BASEHALF_AGENT_AREA_LAST_TAB_COMMAND_ID
];

export type BaseHalfAgentSessionKind = 'terminal' | 'tui-codex' | 'tui-claude' | 'extension-codex' | 'extension-claude';
export type BaseHalfAgentSessionState = 'starting' | 'ready' | 'exited' | 'unavailable' | 'failed' | 'disposed';

export interface IBaseHalfAgentSessionChoice {
	readonly kind: BaseHalfAgentSessionKind;
	readonly label: string;
	readonly description: string;
	readonly commandId: string;
	readonly terminalCommand?: string;
	readonly requiresExtensionSlot?: string;
	readonly extensionId?: string;
	readonly extensionViewContainerIds?: readonly string[];
	readonly extensionViewIds?: readonly string[];
}

export const BASEHALF_AGENT_SESSION_CHOICES = [
	{
		kind: 'tui-codex',
		label: 'Codex',
		description: 'Run the Codex CLI in a BaseHalf Agent Area terminal session.',
		commandId: BASEHALF_AGENT_AREA_NEW_CODEX_TUI_COMMAND_ID,
		terminalCommand: 'codex'
	},
	{
		kind: 'tui-claude',
		label: 'Claude Code',
		description: 'Run Claude Code in a BaseHalf Agent Area terminal session.',
		commandId: BASEHALF_AGENT_AREA_NEW_CLAUDE_TUI_COMMAND_ID,
		terminalCommand: 'claude'
	},
	{
		kind: 'extension-codex',
		label: 'Codex Extension',
		description: 'Host the curated VS Code Codex extension experience inside the Agent Area.',
		commandId: BASEHALF_AGENT_AREA_NEW_CODEX_EXTENSION_COMMAND_ID,
		requiresExtensionSlot: 'basehalf.agentArea.extension.codex',
		extensionId: 'openai.chatgpt',
		extensionViewContainerIds: ['workbench.view.extension.codexSecondaryViewContainer', 'workbench.view.extension.codexViewContainer'],
		extensionViewIds: ['chatgpt.sidebarSecondaryView', 'chatgpt.sidebarView']
	},
	{
		kind: 'extension-claude',
		label: 'Claude Code Extension',
		description: 'Host the curated VS Code Claude Code extension experience inside the Agent Area.',
		commandId: BASEHALF_AGENT_AREA_NEW_CLAUDE_EXTENSION_COMMAND_ID,
		requiresExtensionSlot: 'basehalf.agentArea.extension.claude',
		extensionId: 'anthropic.claude-code',
		extensionViewContainerIds: ['workbench.view.extension.claude-sidebar-secondary', 'workbench.view.extension.claude-sidebar'],
		extensionViewIds: ['claudeVSCodeSidebarSecondary', 'claudeVSCodeSidebar']
	},
	{
		kind: 'terminal',
		label: 'Terminal',
		description: 'Open a shell for OpenCode, Gemini CLI, or another terminal-based agent.',
		commandId: BASEHALF_AGENT_AREA_NEW_TERMINAL_COMMAND_ID
	}
] as const satisfies readonly IBaseHalfAgentSessionChoice[];

export const BASEHALF_VISIBLE_AGENT_SESSION_CHOICES: readonly IBaseHalfAgentSessionChoice[] = BASEHALF_AGENT_SESSION_CHOICES;

export interface IBaseHalfAgentAreaSession {
	readonly id: string;
	readonly kind: BaseHalfAgentSessionKind;
	readonly label: string;
	readonly description: string;
	readonly state: BaseHalfAgentSessionState;
	readonly detail?: string;
}

/**
 * Launch configuration for a TUI agent session. The agent CLI is the terminal
 * process itself (not a command typed into a shell), so a missing CLI surfaces
 * as a launch failure and process exit means the agent session ended.
 */
export interface IBaseHalfTuiSessionLaunchConfig {
	readonly name: string;
	readonly executable: string;
	readonly waitOnExit: string;
	readonly hideFromUser: true;
}

export function baseHalfTuiSessionLaunchConfig(kind: BaseHalfAgentSessionKind): IBaseHalfTuiSessionLaunchConfig | undefined {
	const choice = baseHalfAgentSessionChoiceForKind(kind);
	if (!choice.terminalCommand) {
		return undefined;
	}

	return {
		name: choice.label,
		executable: choice.terminalCommand,
		waitOnExit: `${choice.label} session ended. Press any key to close it, or restart it from its tab.`,
		hideFromUser: true
	};
}

export function baseHalfTuiSessionLaunchFailureGuidance(kind: BaseHalfAgentSessionKind): string | undefined {
	const choice = baseHalfAgentSessionChoiceForKind(kind);
	if (!choice.terminalCommand) {
		return undefined;
	}

	return `Make sure the '${choice.terminalCommand}' command is installed and on your PATH, then restart this session.`;
}

export interface IBaseHalfCreateAgentTerminalOptions {
	readonly label?: string;
	readonly command?: string;
	readonly source?: string;
	readonly rawTerminalOptions?: unknown;
}

export interface IBaseHalfAdoptAgentTerminalOptions {
	readonly label?: string;
	readonly source?: string;
	readonly reveal?: boolean;
	readonly preserveFocus?: boolean;
}

export type BaseHalfExtensionAgentSessionKind = Extract<BaseHalfAgentSessionKind, 'extension-codex' | 'extension-claude'>;

export interface IBaseHalfExtensionAgentProviderResult {
	readonly label?: string;
	readonly description?: string;
	readonly detail?: string;
	readonly setVisible?: (visible: boolean) => void;
	readonly layout?: () => void;
	readonly focus?: () => void | Promise<void>;
	readonly dispose?: () => void | Promise<void>;
}

export interface IBaseHalfExtensionAgentProvider {
	createSession(kind: BaseHalfExtensionAgentSessionKind, container: unknown): Promise<IBaseHalfExtensionAgentProviderResult>;
}

export interface IBaseHalfAgentAreaService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeVisibility: Event<boolean>;
	readonly onDidChangeSessions: Event<readonly IBaseHalfAgentAreaSession[]>;
	readonly visible: boolean;
	readonly sessions: readonly IBaseHalfAgentAreaSession[];
	readonly activeSessionId: string | undefined;
	readonly activeTerminal: unknown | undefined;

	show(preserveFocus?: boolean): Promise<void>;
	hide(): void;
	toggle(preserveFocus?: boolean): Promise<void>;
	createTerminalSession(options?: IBaseHalfCreateAgentTerminalOptions): Promise<IBaseHalfAgentAreaSession>;
	adoptTerminalSession(terminal: unknown, options?: IBaseHalfAdoptAgentTerminalOptions): Promise<IBaseHalfAgentAreaSession>;
	revealTerminalSession(terminal: unknown, options?: IBaseHalfAdoptAgentTerminalOptions): Promise<IBaseHalfAgentAreaSession | undefined>;
	hideTerminalSession(terminal: unknown): void;
	createSession(kind: BaseHalfAgentSessionKind): Promise<IBaseHalfAgentAreaSession>;
	registerExtensionAgentProvider(kind: BaseHalfExtensionAgentSessionKind, provider: IBaseHalfExtensionAgentProvider): IDisposable;
	focusSession(id: string): Promise<void>;
	restartSession(id: string): Promise<void>;
	killSession(id: string): Promise<void>;
	closeSession(id: string): Promise<void>;

	// Tab strip + pane splits (Ghostty-style layout ported from the original dock)
	newTab(): Promise<IBaseHalfAgentAreaSession | undefined>;
	splitActivePane(dir: 'right' | 'down'): Promise<IBaseHalfAgentAreaSession | undefined>;
	closeActivePane(): void;
	closeActiveTab(): void;
	focusPaneDirection(dir: 'left' | 'right' | 'up' | 'down'): Promise<void>;
	cyclePaneFocus(delta: 1 | -1): Promise<void>;
	cycleTab(delta: 1 | -1): Promise<void>;
	gotoTab(index: number): Promise<void>;
	gotoLastTab(): Promise<void>;
	resizeActivePane(dir: 'left' | 'right' | 'up' | 'down'): void;
	equalizePanes(): void;
	togglePaneZoom(): void;
}

export function baseHalfAgentSessionChoiceForKind(kind: BaseHalfAgentSessionKind): IBaseHalfAgentSessionChoice {
	const choice = BASEHALF_AGENT_SESSION_CHOICES.find(choice => choice.kind === kind);
	if (!choice) {
		throw new Error(`Unknown BaseHalf Agent Area session kind: ${kind}`);
	}

	return choice;
}

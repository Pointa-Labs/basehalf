/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../base/common/platform.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { BASEHALF_AGENT_LAUNCH_INSTRUCTIONS, BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_FLAG } from './basehalfAgentLaunchInstructions.js';

export const IBaseHalfAgentAreaService = createDecorator<IBaseHalfAgentAreaService>('baseHalfAgentAreaService');

/**
 * The Agent Area is a real workbench surface: a BaseHalf-owned view container
 * in the auxiliary bar (the right-side part). The part gives it grid layout,
 * a native sash, size persistence, and — critically — the same stacking layer
 * as every other part, so extension webviews anchored into it render normally.
 */
export const BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID = 'basehalf.agentArea';
export const BASEHALF_AGENT_AREA_VIEW_ID = 'basehalf.agentArea.view';

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
	readonly extensionCanonicalViewContainerIds?: readonly string[];
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
		extensionCanonicalViewContainerIds: ['workbench.view.extension.claude-sessions-sidebar'],
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

/**
 * The canonical view containers the curated agent extensions contribute their
 * webview views to (secondary sidebar/activity bar homes). BaseHalf hosts
 * those views inside the Agent Area instead, so these containers are never a
 * product surface: opening one is closed by the workbench profile guard, which
 * also keeps the single webview instance claimed by the Agent Area's pane.
 */
export const BASEHALF_AGENT_EXTENSION_CANONICAL_VIEW_CONTAINER_IDS: readonly string[] = (BASEHALF_AGENT_SESSION_CHOICES as readonly IBaseHalfAgentSessionChoice[])
	.flatMap(choice => [...(choice.extensionViewContainerIds ?? []), ...(choice.extensionCanonicalViewContainerIds ?? [])])
	.flatMap(id => id.startsWith('workbench.view.extension.') ? [id, id.slice('workbench.view.extension.'.length)] : [`workbench.view.extension.${id}`, id]);

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
	/** Launch-time context arguments; see {@link baseHalfTuiSessionLaunchConfig}. */
	readonly args?: readonly string[];
	readonly waitOnExit: string;
	readonly hideFromUser: true;
}

/** Where and how a TUI session would be launched. */
export interface IBaseHalfTuiSessionLaunchContext {
	/** The session runs through a remote connection. */
	readonly isRemote: boolean;
	/** The operating system that runs the session's process. */
	readonly os: OperatingSystem;
	/** Some workspace folder holds `.basehalf-no-workspace-setup` (or its
	 *  presence could not be determined): development sessions on the BaseHalf
	 *  source tree must not receive product instructions. */
	readonly hasMarkedWorkspaceFolder: boolean;
	/** False once this session relaunched without launch context because the
	 *  installed CLI rejected the argument. */
	readonly launchInstructions?: boolean;
}

/**
 * Whether a session receives the BaseHalf launch instruction: only a local
 * Claude Code TUI session (the one that gets the node-run bridge) on macOS or
 * Linux, in a workspace without a marked folder. Codex, extension agents,
 * plain terminals, remote sessions, and Windows receive none.
 */
export function baseHalfTuiSessionReceivesLaunchInstructions(kind: BaseHalfAgentSessionKind, context: IBaseHalfTuiSessionLaunchContext): boolean {
	return kind === 'tui-claude'
		&& baseHalfAgentSessionUsesLocalNodeRunBridge(kind, context.isRemote)
		&& (context.os === OperatingSystem.Macintosh || context.os === OperatingSystem.Linux)
		&& !context.hasMarkedWorkspaceFolder
		&& context.launchInstructions !== false;
}

export function baseHalfTuiSessionLaunchConfig(kind: BaseHalfAgentSessionKind, context: IBaseHalfTuiSessionLaunchContext): IBaseHalfTuiSessionLaunchConfig | undefined {
	const choice = baseHalfAgentSessionChoiceForKind(kind);
	if (!choice.terminalCommand) {
		return undefined;
	}

	return {
		name: choice.label,
		executable: choice.terminalCommand,
		...(baseHalfTuiSessionReceivesLaunchInstructions(kind, context)
			? { args: [BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_FLAG, BASEHALF_AGENT_LAUNCH_INSTRUCTIONS] }
			: {}),
		waitOnExit: `${choice.label} session ended. Press any key to close it, or restart it from its tab.`,
		hideFromUser: true
	};
}

/** Launch arguments with the BaseHalf launch instruction (flag and text) removed. */
export function baseHalfStripAgentLaunchInstructions(args: readonly string[] | string | undefined): string[] | string | undefined {
	if (!Array.isArray(args)) {
		return typeof args === 'string' ? args : undefined;
	}
	const stripped: string[] = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_FLAG && args[index + 1] === BASEHALF_AGENT_LAUNCH_INSTRUCTIONS) {
			index++;
			continue;
		}
		stripped.push(args[index]);
	}
	return stripped.length > 0 ? stripped : undefined;
}

/** Whether launch arguments carry the BaseHalf launch instruction. */
export function baseHalfHasAgentLaunchInstructions(args: readonly string[] | string | undefined): boolean {
	return Array.isArray(args) && args.some((arg, index) => arg === BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_FLAG && args[index + 1] === BASEHALF_AGENT_LAUNCH_INSTRUCTIONS);
}

/** An exit this soon after a launch with the argument, before any user input,
 *  means the installed CLI most likely rejected the argument. */
export const BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_EARLY_EXIT_MS = 5000;

/**
 * Tracks one Agent Area TUI session's launches so an installed Claude Code
 * that rejects `--append-system-prompt` never makes the TUI unusable: an
 * early non-zero exit before any user input relaunches the session once
 * without the argument, and the session and its restarts then continue
 * without launch context.
 */
export class BaseHalfAgentLaunchInstructionsMonitor {
	private launchedAt: number | undefined;
	private userInput = false;
	private disabled = false;

	constructor(private readonly now: () => number = Date.now) { }

	/** Whether the next launch may carry the argument. */
	get enabled(): boolean {
		return !this.disabled;
	}

	didLaunch(withInstructions: boolean): void {
		this.launchedAt = withInstructions && !this.disabled ? this.now() : undefined;
		this.userInput = false;
	}

	didReceiveUserInput(): void {
		this.userInput = true;
	}

	/**
	 * True exactly once, for a non-zero exit of a launch that carried the
	 * argument, within {@link BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_EARLY_EXIT_MS}
	 * and before any user input. Launch context is then disabled for good.
	 */
	shouldRelaunchWithoutInstructions(exitCode: number | undefined): boolean {
		const launchedAt = this.launchedAt;
		this.launchedAt = undefined;
		if (this.disabled || launchedAt === undefined || this.userInput || exitCode === undefined || exitCode === 0) {
			return false;
		}
		if (this.now() - launchedAt > BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_EARLY_EXIT_MS) {
			return false;
		}
		this.disabled = true;
		return true;
	}
}

export function baseHalfTuiSessionLaunchFailureGuidance(kind: BaseHalfAgentSessionKind): string | undefined {
	const choice = baseHalfAgentSessionChoiceForKind(kind);
	if (!choice.terminalCommand) {
		return undefined;
	}

	return `Make sure the '${choice.terminalCommand}' command is installed and on your PATH, then restart this session.`;
}

export function baseHalfAgentSessionCanRequestNodeRuns(kind: BaseHalfAgentSessionKind): boolean {
	return kind === 'tui-codex' || kind === 'tui-claude' || kind === 'terminal';
}

export function baseHalfAgentSessionUsesLocalNodeRunBridge(kind: BaseHalfAgentSessionKind, isRemote: boolean): boolean {
	return !isRemote && baseHalfAgentSessionCanRequestNodeRuns(kind);
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
	readonly onDidReleaseTerminalProcess: Event<number>;
	readonly visible: boolean;
	readonly sessions: readonly IBaseHalfAgentAreaSession[];
	readonly activeSessionId: string | undefined;
	readonly activeTerminal: unknown | undefined;
	ownsTerminalProcess(persistentProcessId: number): boolean;
	terminalProcessOwnership(persistentProcessId: number): 'owned' | 'released' | 'unknown';

	/**
	 * Adopt the Agent Area's chrome into the given host element — called by the
	 * Agent Area view pane when the auxiliary bar creates it. Typed loosely
	 * because this is a common-layer interface; the browser-layer
	 * implementation narrows it to an HTMLElement.
	 */
	mountIn(container: unknown): void;
	focusActivePane(): Promise<void>;

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

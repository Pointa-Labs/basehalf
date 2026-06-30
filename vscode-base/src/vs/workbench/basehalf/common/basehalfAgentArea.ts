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
export const BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID = 'basehalf.internal.terminal.toggleView';

export type BaseHalfAgentSessionKind = 'terminal' | 'tui-codex' | 'tui-claude' | 'extension-codex' | 'extension-claude';
export type BaseHalfAgentSessionState = 'starting' | 'ready' | 'unavailable' | 'failed' | 'disposed';

export interface IBaseHalfAgentSessionChoice {
	readonly kind: BaseHalfAgentSessionKind;
	readonly label: string;
	readonly description: string;
	readonly commandId: string;
	readonly terminalCommand?: string;
	readonly requiresExtensionSlot?: string;
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
		requiresExtensionSlot: 'basehalf.agentArea.extension.codex'
	},
	{
		kind: 'extension-claude',
		label: 'Claude Code Extension',
		description: 'Host the curated VS Code Claude Code extension experience inside the Agent Area.',
		commandId: BASEHALF_AGENT_AREA_NEW_CLAUDE_EXTENSION_COMMAND_ID,
		requiresExtensionSlot: 'basehalf.agentArea.extension.claude'
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

	show(preserveFocus?: boolean): Promise<void>;
	hide(): void;
	toggle(preserveFocus?: boolean): Promise<void>;
	createTerminalSession(options?: IBaseHalfCreateAgentTerminalOptions): Promise<IBaseHalfAgentAreaSession>;
	adoptTerminalSession(terminal: unknown, options?: IBaseHalfAdoptAgentTerminalOptions): Promise<IBaseHalfAgentAreaSession>;
	hideTerminalSession(terminal: unknown): void;
	createSession(kind: BaseHalfAgentSessionKind): Promise<IBaseHalfAgentAreaSession>;
	registerExtensionAgentProvider(kind: BaseHalfExtensionAgentSessionKind, provider: IBaseHalfExtensionAgentProvider): IDisposable;
	focusSession(id: string): Promise<void>;
	closeSession(id: string): Promise<void>;
}

export function baseHalfAgentSessionChoiceForKind(kind: BaseHalfAgentSessionKind): IBaseHalfAgentSessionChoice {
	const choice = BASEHALF_AGENT_SESSION_CHOICES.find(choice => choice.kind === kind);
	if (!choice) {
		throw new Error(`Unknown BaseHalf Agent Area session kind: ${kind}`);
	}

	return choice;
}

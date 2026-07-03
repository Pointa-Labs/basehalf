/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DEFAULT_COMMANDS_TO_SKIP_SHELL, TerminalCommandId } from '../../../contrib/terminal/common/terminal.js';
import {
	BASEHALF_AGENT_AREA_NEW_CLAUDE_EXTENSION_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_CLAUDE_TUI_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_CODEX_EXTENSION_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_CODEX_TUI_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_TERMINAL_COMMAND_ID,
	BASEHALF_AGENT_AREA_KILL_ACTIVE_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESTART_ACTIVE_COMMAND_ID,
	BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID,
	BASEHALF_AGENT_SESSION_CHOICES,
	type BaseHalfAgentSessionState,
	BASEHALF_VISIBLE_AGENT_SESSION_CHOICES,
	BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID,
	BASEHALF_AGENT_AREA_SKIP_SHELL_COMMAND_IDS,
	baseHalfAgentSessionChoiceForKind,
	baseHalfTuiSessionLaunchConfig,
	baseHalfTuiSessionLaunchFailureGuidance
} from '../../common/basehalfAgentArea.js';
import { isBaseHalfAgentExtensionSlot } from '../../common/basehalfWorkbenchProfile.js';

suite('BaseHalfAgentArea', () => {
	test('declares five first-class Agent Area session choices', () => {
		assert.deepStrictEqual(
			BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.kind),
			[
				'tui-codex',
				'tui-claude',
				'extension-codex',
				'extension-claude',
				'terminal'
			]
		);

		assert.deepStrictEqual(
			BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.commandId),
			[
				BASEHALF_AGENT_AREA_NEW_CODEX_TUI_COMMAND_ID,
				BASEHALF_AGENT_AREA_NEW_CLAUDE_TUI_COMMAND_ID,
				BASEHALF_AGENT_AREA_NEW_CODEX_EXTENSION_COMMAND_ID,
				BASEHALF_AGENT_AREA_NEW_CLAUDE_EXTENSION_COMMAND_ID,
				BASEHALF_AGENT_AREA_NEW_TERMINAL_COMMAND_ID
			]
		);
	});

	test('keeps terminal and TUI sessions on VS Code terminal plumbing', () => {
		assert.strictEqual(baseHalfAgentSessionChoiceForKind('terminal').terminalCommand, undefined);
		assert.strictEqual(baseHalfAgentSessionChoiceForKind('tui-codex').terminalCommand, 'codex');
		assert.strictEqual(baseHalfAgentSessionChoiceForKind('tui-claude').terminalCommand, 'claude');
	});

	test('launches TUI agent sessions as the terminal process itself', () => {
		assert.deepStrictEqual(baseHalfTuiSessionLaunchConfig('tui-codex'), {
			name: 'Codex',
			executable: 'codex',
			waitOnExit: 'Codex session ended. Press any key to close it, or restart it from its tab.',
			hideFromUser: true
		});
		assert.deepStrictEqual(baseHalfTuiSessionLaunchConfig('tui-claude'), {
			name: 'Claude Code',
			executable: 'claude',
			waitOnExit: 'Claude Code session ended. Press any key to close it, or restart it from its tab.',
			hideFromUser: true
		});
		assert.strictEqual(baseHalfTuiSessionLaunchConfig('terminal'), undefined);
		assert.strictEqual(baseHalfTuiSessionLaunchConfig('extension-codex'), undefined);
		assert.strictEqual(baseHalfTuiSessionLaunchConfig('extension-claude'), undefined);
	});

	test('gives install guidance when a TUI agent CLI fails to launch', () => {
		assert.strictEqual(
			baseHalfTuiSessionLaunchFailureGuidance('tui-codex'),
			'Make sure the \'codex\' command is installed and on your PATH, then restart this session.'
		);
		assert.strictEqual(
			baseHalfTuiSessionLaunchFailureGuidance('tui-claude'),
			'Make sure the \'claude\' command is installed and on your PATH, then restart this session.'
		);
		assert.strictEqual(baseHalfTuiSessionLaunchFailureGuidance('terminal'), undefined);
		assert.strictEqual(baseHalfTuiSessionLaunchFailureGuidance('extension-codex'), undefined);
	});

	test('keeps extension sessions behind curated Agent Area slots', () => {
		const codex = baseHalfAgentSessionChoiceForKind('extension-codex');
		const claude = baseHalfAgentSessionChoiceForKind('extension-claude');

		assert.strictEqual(codex.requiresExtensionSlot, 'basehalf.agentArea.extension.codex');
		assert.strictEqual(claude.requiresExtensionSlot, 'basehalf.agentArea.extension.claude');
		assert.strictEqual(codex.extensionId, 'openai.chatgpt');
		assert.strictEqual(claude.extensionId, 'anthropic.claude-code');
		assert.deepStrictEqual(codex.extensionViewContainerIds, ['workbench.view.extension.codexSecondaryViewContainer', 'workbench.view.extension.codexViewContainer']);
		assert.deepStrictEqual(codex.extensionViewIds, ['chatgpt.sidebarSecondaryView', 'chatgpt.sidebarView']);
		assert.deepStrictEqual(claude.extensionViewContainerIds, ['workbench.view.extension.claude-sidebar-secondary', 'workbench.view.extension.claude-sidebar']);
		assert.deepStrictEqual(claude.extensionViewIds, ['claudeVSCodeSidebarSecondary', 'claudeVSCodeSidebar']);
		assert.strictEqual(isBaseHalfAgentExtensionSlot(codex.requiresExtensionSlot), true);
		assert.strictEqual(isBaseHalfAgentExtensionSlot(claude.requiresExtensionSlot), true);
	});

	test('exposes all five first-class Agent Area session choices in the product UI', () => {
		assert.deepStrictEqual(
			BASEHALF_VISIBLE_AGENT_SESSION_CHOICES.map(choice => choice.kind),
			[
				'tui-codex',
				'tui-claude',
				'extension-codex',
				'extension-claude',
				'terminal'
			]
		);
		assert.strictEqual(BASEHALF_VISIBLE_AGENT_SESSION_CHOICES.length, 5);
	});

	test('takes over the VS Code terminal toggle command without losing the stock view open command', () => {
		assert.strictEqual(BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID, 'basehalf.agentArea.toggle');
		assert.strictEqual(BASEHALF_AGENT_AREA_RESTART_ACTIVE_COMMAND_ID, 'basehalf.agentArea.restartActive');
		assert.strictEqual(BASEHALF_AGENT_AREA_KILL_ACTIVE_COMMAND_ID, 'basehalf.agentArea.killActive');
		assert.strictEqual(TerminalCommandId.Toggle, 'workbench.action.terminal.toggleTerminal');
		assert.strictEqual(BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID, 'basehalf.internal.terminal.toggleView');
		assert.notStrictEqual(BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID, TerminalCommandId.Toggle);
	});

	test('models process exit as an Agent Area lifecycle state', () => {
		const states: BaseHalfAgentSessionState[] = ['starting', 'ready', 'exited', 'unavailable', 'failed', 'disposed'];
		assert.ok(states.includes('exited'));
	});

	test('tab and pane keybinding commands skip the shell so they fire while an xterm is focused', () => {
		assert.ok(BASEHALF_AGENT_AREA_SKIP_SHELL_COMMAND_IDS.length >= 20);
		const missing = BASEHALF_AGENT_AREA_SKIP_SHELL_COMMAND_IDS.filter(id => !DEFAULT_COMMANDS_TO_SKIP_SHELL.includes(id));
		assert.deepStrictEqual(missing, []);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { TerminalCommandId } from '../../../contrib/terminal/common/terminal.js';
import {
	BASEHALF_AGENT_AREA_NEW_CLAUDE_EXTENSION_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_CLAUDE_TUI_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_CODEX_EXTENSION_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_CODEX_TUI_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_TERMINAL_COMMAND_ID,
	BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID,
	BASEHALF_AGENT_SESSION_CHOICES,
	BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID,
	baseHalfAgentSessionChoiceForKind
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

	test('keeps extension sessions behind curated Agent Area slots', () => {
		const codex = baseHalfAgentSessionChoiceForKind('extension-codex');
		const claude = baseHalfAgentSessionChoiceForKind('extension-claude');

		assert.strictEqual(codex.requiresExtensionSlot, 'basehalf.agentArea.extension.codex');
		assert.strictEqual(claude.requiresExtensionSlot, 'basehalf.agentArea.extension.claude');
		assert.strictEqual(isBaseHalfAgentExtensionSlot(codex.requiresExtensionSlot), true);
		assert.strictEqual(isBaseHalfAgentExtensionSlot(claude.requiresExtensionSlot), true);
	});

	test('takes over the VS Code terminal toggle command without losing the stock view open command', () => {
		assert.strictEqual(BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID, 'basehalf.agentArea.toggle');
		assert.strictEqual(TerminalCommandId.Toggle, 'workbench.action.terminal.toggleTerminal');
		assert.strictEqual(BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID, 'basehalf.internal.terminal.toggleView');
		assert.notStrictEqual(BASEHALF_INTERNAL_TERMINAL_VIEW_TOGGLE_COMMAND_ID, TerminalCommandId.Toggle);
	});
});

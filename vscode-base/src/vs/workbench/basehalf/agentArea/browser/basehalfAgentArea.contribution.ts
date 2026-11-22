/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './basehalfAgentAreaView.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { TerminalCommandId } from '../../../contrib/terminal/common/terminal.js';
import { TerminalSettingId } from '../../../../platform/terminal/common/terminal.js';
import {
	BASEHALF_AGENT_AREA_KILL_ACTIVE_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESTART_ACTIVE_COMMAND_ID,
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
	BASEHALF_AGENT_AREA_GOTO_TAB_COMMAND_IDS,
	BASEHALF_AGENT_AREA_LAST_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_LARGER_TEXT_COMMAND_ID,
	BASEHALF_AGENT_AREA_SMALLER_TEXT_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESET_TEXT_SIZE_COMMAND_ID,
	BASEHALF_VISIBLE_AGENT_SESSION_CHOICES,
	BaseHalfAgentSessionKind,
	IBaseHalfAgentAreaService,
	IBaseHalfAgentAreaSession
} from '../common/basehalfAgentArea.js';
import { baseHalfAgentAreaTextSizeStep } from '../common/basehalfAgentAreaTextSize.js';
import { BaseHalfAgentAreaService } from './basehalfAgentAreaService.js';

class BaseHalfAgentAreaWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.agentArea';

	constructor(
		@IBaseHalfAgentAreaService agentAreaService: IBaseHalfAgentAreaService
	) {
		super();
		void agentAreaService;
	}
}

registerSingleton(IBaseHalfAgentAreaService, BaseHalfAgentAreaService, InstantiationType.Delayed);

registerAction2(class BaseHalfToggleTerminalAgentAreaAction extends Action2 {
	constructor() {
		super({
			id: TerminalCommandId.Toggle,
			title: localize2('basehalf.toggleAgentAreaTerminal', 'Toggle Agent Area Terminal'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true,
			// The two keys that show a terminal in the base: the terminal's own, and the key of the panel,
			// which BaseHalf does not have (commands and menus, "One command for one thing", D150).
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Backquote,
				secondary: [KeyMod.CtrlCmd | KeyCode.KeyJ],
				mac: { primary: KeyMod.WinCtrl | KeyCode.Backquote, secondary: [KeyMod.CtrlCmd | KeyCode.KeyJ] },
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfAgentAreaService).toggle();
	}
});

registerAction2(class BaseHalfRestartActiveAgentSessionAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_AGENT_AREA_RESTART_ACTIVE_COMMAND_ID,
			title: localize2('basehalf.restartActiveAgentAreaSession', 'Restart Active Agent Area Session'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const agentAreaService = accessor.get(IBaseHalfAgentAreaService);
		return agentAreaService.activeSessionId ? agentAreaService.restartSession(agentAreaService.activeSessionId) : Promise.resolve();
	}
});

registerAction2(class BaseHalfKillActiveAgentSessionAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_AGENT_AREA_KILL_ACTIVE_COMMAND_ID,
			title: localize2('basehalf.killActiveAgentAreaSession', 'Kill Active Agent Area Session'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const agentAreaService = accessor.get(IBaseHalfAgentAreaService);
		return agentAreaService.activeSessionId ? agentAreaService.killSession(agentAreaService.activeSessionId) : Promise.resolve();
	}
});

function registerCreateAgentSessionAction(id: string, kind: BaseHalfAgentSessionKind, title: string): void {
	registerAction2(class BaseHalfCreateAgentSessionAction extends Action2 {
		constructor() {
			super({
				id,
				title: actionTitle(title),
				category: localize2('basehalf.category', 'BaseHalf'),
				f1: true
			});
		}

		run(accessor: ServicesAccessor): Promise<IBaseHalfAgentAreaSession> {
			return accessor.get(IBaseHalfAgentAreaService).createSession(kind);
		}
	});
}

function actionTitle(title: string): { value: string; original: string } {
	return { value: title, original: title };
}

for (const choice of BASEHALF_VISIBLE_AGENT_SESSION_CHOICES) {
	registerCreateAgentSessionAction(choice.commandId, choice.kind, createAgentSessionActionLabel(choice.kind));
}

function createAgentSessionActionLabel(kind: BaseHalfAgentSessionKind): string {
	switch (kind) {
		case 'terminal':
			return 'New Agent Area Terminal';
		case 'tui-codex':
			return 'New Codex TUI Session';
		case 'tui-claude':
			return 'New Claude Code TUI Session';
		case 'extension-codex':
			return 'New Codex Extension Session';
		case 'extension-claude':
			return 'New Claude Code Extension Session';
	}
}

// ── Tab strip + pane keybindings (fire only while the Agent Area owns focus) ──

const AGENT_AREA_WHEN = ContextKeyExpr.has('basehalfAgentAreaFocused');
const AGENT_KEYBINDING_WEIGHT = KeybindingWeight.WorkbenchContrib + 51;

interface IBaseHalfAgentPaneActionSpec {
	readonly id: string;
	readonly title: string;
	readonly primary: number;
	readonly run: (service: IBaseHalfAgentAreaService) => unknown;
}

const AGENT_PANE_ACTIONS: readonly IBaseHalfAgentPaneActionSpec[] = [
	{ id: BASEHALF_AGENT_AREA_NEW_TAB_COMMAND_ID, title: 'New Agent Tab', primary: KeyMod.CtrlCmd | KeyCode.KeyT, run: service => service.newTab() },
	{ id: BASEHALF_AGENT_AREA_CLOSE_PANE_COMMAND_ID, title: 'Close Agent Pane', primary: KeyMod.CtrlCmd | KeyCode.KeyW, run: service => service.closeActivePane() },
	{ id: BASEHALF_AGENT_AREA_CLOSE_TAB_COMMAND_ID, title: 'Close Agent Tab', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyW, run: service => service.closeActiveTab() },
	{ id: BASEHALF_AGENT_AREA_SPLIT_RIGHT_COMMAND_ID, title: 'Split Agent Pane Right', primary: KeyMod.CtrlCmd | KeyCode.KeyD, run: service => service.splitActivePane('right') },
	{ id: BASEHALF_AGENT_AREA_SPLIT_DOWN_COMMAND_ID, title: 'Split Agent Pane Down', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyD, run: service => service.splitActivePane('down') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_LEFT_COMMAND_ID, title: 'Focus Agent Pane Left', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow, run: service => service.focusPaneDirection('left') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_RIGHT_COMMAND_ID, title: 'Focus Agent Pane Right', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow, run: service => service.focusPaneDirection('right') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_UP_COMMAND_ID, title: 'Focus Agent Pane Up', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.UpArrow, run: service => service.focusPaneDirection('up') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_DOWN_COMMAND_ID, title: 'Focus Agent Pane Down', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.DownArrow, run: service => service.focusPaneDirection('down') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_NEXT_PANE_COMMAND_ID, title: 'Focus Next Agent Pane', primary: KeyMod.CtrlCmd | KeyCode.BracketRight, run: service => service.cyclePaneFocus(1) },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PREVIOUS_PANE_COMMAND_ID, title: 'Focus Previous Agent Pane', primary: KeyMod.CtrlCmd | KeyCode.BracketLeft, run: service => service.cyclePaneFocus(-1) },
	{ id: BASEHALF_AGENT_AREA_NEXT_TAB_COMMAND_ID, title: 'Next Agent Tab', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.BracketRight, run: service => service.cycleTab(1) },
	{ id: BASEHALF_AGENT_AREA_PREVIOUS_TAB_COMMAND_ID, title: 'Previous Agent Tab', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.BracketLeft, run: service => service.cycleTab(-1) },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_LEFT_COMMAND_ID, title: 'Resize Agent Pane Left', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.LeftArrow, run: service => service.resizeActivePane('left') },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_RIGHT_COMMAND_ID, title: 'Resize Agent Pane Right', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.RightArrow, run: service => service.resizeActivePane('right') },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_UP_COMMAND_ID, title: 'Resize Agent Pane Up', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.UpArrow, run: service => service.resizeActivePane('up') },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_DOWN_COMMAND_ID, title: 'Resize Agent Pane Down', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.DownArrow, run: service => service.resizeActivePane('down') },
	{ id: BASEHALF_AGENT_AREA_EQUALIZE_PANES_COMMAND_ID, title: 'Equalize Agent Panes', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.Equal, run: service => service.equalizePanes() },
	{ id: BASEHALF_AGENT_AREA_TOGGLE_ZOOM_COMMAND_ID, title: 'Toggle Agent Pane Zoom', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter, run: service => service.togglePaneZoom() },
	{ id: BASEHALF_AGENT_AREA_LAST_TAB_COMMAND_ID, title: 'Go to Last Agent Tab', primary: KeyMod.CtrlCmd | KeyCode.Digit9, run: service => service.gotoLastTab() }
];

function registerAgentPaneAction(spec: IBaseHalfAgentPaneActionSpec): void {
	registerAction2(class BaseHalfAgentPaneAction extends Action2 {
		constructor() {
			super({
				id: spec.id,
				title: actionTitle(spec.title),
				category: localize2('basehalf.category', 'BaseHalf'),
				f1: true,
				keybinding: {
					primary: spec.primary,
					when: AGENT_AREA_WHEN,
					weight: AGENT_KEYBINDING_WEIGHT
				}
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			await spec.run(accessor.get(IBaseHalfAgentAreaService));
		}
	});
}

for (const spec of AGENT_PANE_ACTIONS) {
	registerAgentPaneAction(spec);
}

const DIGIT_KEY_CODES = [KeyCode.Digit1, KeyCode.Digit2, KeyCode.Digit3, KeyCode.Digit4, KeyCode.Digit5, KeyCode.Digit6, KeyCode.Digit7, KeyCode.Digit8];
BASEHALF_AGENT_AREA_GOTO_TAB_COMMAND_IDS.forEach((commandId, i) => {
	registerAgentPaneAction({
		id: commandId,
		title: `Go to Agent Tab ${i + 1}`,
		primary: KeyMod.CtrlCmd | DIGIT_KEY_CODES[i],
		run: service => service.gotoTab(i + 1)
	});
});

// ── The size of the Agent Area's text (each part zooms by itself, rule 10) ──
// The keys that zoom the window change the Agent Area's text while it has the keyboard: their weight is above that of
// the window's zoom, and their commands go to no program in the terminal (BASEHALF_AGENT_AREA_SKIP_SHELL_COMMAND_IDS).

interface IBaseHalfAgentTextSizeActionSpec {
	readonly id: string;
	readonly title: string;
	readonly primary: number;
	readonly secondary: number[];
	/** One pixel larger or smaller, or back to the default. */
	readonly direction: 1 | -1 | 'default';
}

const AGENT_TEXT_SIZE_ACTIONS: readonly IBaseHalfAgentTextSizeActionSpec[] = [
	{ id: BASEHALF_AGENT_AREA_LARGER_TEXT_COMMAND_ID, title: 'Larger Agent Area Text', primary: KeyMod.CtrlCmd | KeyCode.Equal, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Equal, KeyMod.CtrlCmd | KeyCode.NumpadAdd], direction: 1 },
	{ id: BASEHALF_AGENT_AREA_SMALLER_TEXT_COMMAND_ID, title: 'Smaller Agent Area Text', primary: KeyMod.CtrlCmd | KeyCode.Minus, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Minus, KeyMod.CtrlCmd | KeyCode.NumpadSubtract], direction: -1 },
	{ id: BASEHALF_AGENT_AREA_RESET_TEXT_SIZE_COMMAND_ID, title: 'Reset Agent Area Text Size', primary: KeyMod.CtrlCmd | KeyCode.Digit0, secondary: [KeyMod.CtrlCmd | KeyCode.Numpad0], direction: 'default' }
];

/** The writes of the text's size, one after another: a key pressed before the last write landed steps from what it wrote. */
let textSizeWrites: Promise<void> = Promise.resolve();

for (const spec of AGENT_TEXT_SIZE_ACTIONS) {
	registerAction2(class BaseHalfAgentTextSizeAction extends Action2 {
		constructor() {
			super({
				id: spec.id,
				title: actionTitle(spec.title),
				category: localize2('basehalf.category', 'BaseHalf'),
				f1: true,
				keybinding: {
					primary: spec.primary,
					secondary: spec.secondary,
					when: AGENT_AREA_WHEN,
					weight: AGENT_KEYBINDING_WEIGHT
				}
			});
		}

		run(accessor: ServicesAccessor): Promise<void> {
			const configurationService = accessor.get(IConfigurationService);
			// Written as Settings writes it: where the value in effect comes from, and the default as no value.
			const write = async () => {
				if (spec.direction === 'default') {
					await configurationService.updateValue(TerminalSettingId.FontSize, undefined);
					return;
				}
				const defaultSize = configurationService.inspect<number>(TerminalSettingId.FontSize).defaultValue ?? 13;
				const size = baseHalfAgentAreaTextSizeStep(configurationService.getValue(TerminalSettingId.FontSize), defaultSize, spec.direction);
				await configurationService.updateValue(TerminalSettingId.FontSize, size);
			};
			textSizeWrites = textSizeWrites.then(write, write);
			return textSizeWrites;
		}
	});
}

registerWorkbenchContribution2(BaseHalfAgentAreaWorkbenchContribution.ID, BaseHalfAgentAreaWorkbenchContribution, WorkbenchPhase.AfterRestored);

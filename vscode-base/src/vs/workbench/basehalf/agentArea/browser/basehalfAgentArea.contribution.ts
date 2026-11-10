/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './basehalfAgentAreaView.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { TerminalCommandId } from '../../../contrib/terminal/common/terminal.js';
import {
	BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID,
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
	BASEHALF_VISIBLE_AGENT_SESSION_CHOICES,
	BaseHalfAgentSessionKind,
	IBaseHalfAgentAreaService,
	IBaseHalfAgentAreaSession
} from '../common/basehalfAgentArea.js';
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
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Backquote,
				mac: { primary: KeyMod.WinCtrl | KeyCode.Backquote },
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfAgentAreaService).toggle();
	}
});

registerAction2(class BaseHalfToggleAgentAreaAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID,
			title: localize2('basehalf.toggleAgentArea', 'Toggle Agent Area'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
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

registerWorkbenchContribution2(BaseHalfAgentAreaWorkbenchContribution.ID, BaseHalfAgentAreaWorkbenchContribution, WorkbenchPhase.AfterRestored);

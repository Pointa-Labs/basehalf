import type { FocusDir, SplitDir } from './terminalTree.js';

export enum TerminalActionId {
  New = 'workbench.action.terminal.new',
  CloseActiveTab = 'workbench.action.terminal.killActiveTab',
  SplitPane = 'workbench.action.terminal.split',
  ToggleZoom = 'workbench.action.terminal.toggleZoom',
  SwitchTab = 'workbench.action.terminal.switchTerminal',
  GotoTab = 'workbench.action.terminal.focusAtIndex',
  LastTab = 'workbench.action.terminal.focusLast',
  GotoPaneRing = 'workbench.action.terminal.focusPaneByOrder',
  GotoPaneDirection = 'workbench.action.terminal.focusPaneByDirection',
  ResizePane = 'workbench.action.terminal.resizePane',
  EqualizePanes = 'workbench.action.terminal.resizePaneEqual',
}

export type TerminalAction =
  | { readonly id: TerminalActionId.New }
  | { readonly id: TerminalActionId.CloseActiveTab }
  | { readonly id: TerminalActionId.SplitPane; readonly dir: SplitDir }
  | { readonly id: TerminalActionId.ToggleZoom }
  | { readonly id: TerminalActionId.SwitchTab; readonly delta: 1 | -1 }
  | { readonly id: TerminalActionId.GotoTab; readonly index: number }
  | { readonly id: TerminalActionId.LastTab }
  | { readonly id: TerminalActionId.GotoPaneRing; readonly delta: 1 | -1 }
  | { readonly id: TerminalActionId.GotoPaneDirection; readonly dir: FocusDir }
  | { readonly id: TerminalActionId.ResizePane; readonly dir: FocusDir }
  | { readonly id: TerminalActionId.EqualizePanes };

export interface TerminalKeybindingEvent {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

export interface TerminalKeybindingContext {
  readonly terminalFocused: boolean;
  readonly targetEditable: boolean;
}

export interface TerminalActionTarget {
  readonly activeTabId: string;
  newTab: () => void;
  closeTab: (tabId: string) => void;
  splitPane: (dir: SplitDir) => void;
  toggleZoom: () => void;
  switchTab: (delta: 1 | -1) => void;
  gotoTab: (index: number) => void;
  lastTab: () => void;
  gotoPaneRing: (delta: 1 | -1) => void;
  gotoPaneDir: (dir: FocusDir) => void;
  resizePane: (dir: FocusDir) => void;
  equalizePanes: () => void;
}

// VS Code keeps terminal commands in terminalActions.ts and lets keybindings
// point at those commands. Our app has no global command registry yet, so this
// resolver is the local equivalent: DOM keyboard input becomes a terminal
// command model, then a separate runner talks to the terminal store.
export function resolveTerminalKeybinding(
  event: TerminalKeybindingEvent,
  context: TerminalKeybindingContext,
): TerminalAction | null {
  if (!event.metaKey || !context.terminalFocused || context.targetEditable) return null;

  const digit = terminalDigit(event);
  if (digit >= 1 && digit <= 9 && !event.shiftKey && !event.altKey && !event.ctrlKey) {
    return digit === 9
      ? { id: TerminalActionId.LastTab }
      : { id: TerminalActionId.GotoTab, index: digit };
  }

  const key = event.key.toLowerCase();
  const dir = arrowDirection(event.key);

  if (
    (key === 't' || event.code === 'KeyT') &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey
  ) {
    return { id: TerminalActionId.New };
  }
  if ((key === 'w' || event.code === 'KeyW') && event.altKey && !event.shiftKey && !event.ctrlKey) {
    return { id: TerminalActionId.CloseActiveTab };
  }
  if ((key === 'd' || event.code === 'KeyD') && !event.altKey && !event.ctrlKey) {
    return {
      id: TerminalActionId.SplitPane,
      dir: event.shiftKey ? 'down' : 'right',
    };
  }
  if (event.key === 'Enter' && event.shiftKey) {
    return { id: TerminalActionId.ToggleZoom };
  }
  if (event.code === 'BracketLeft') {
    return event.shiftKey
      ? { id: TerminalActionId.SwitchTab, delta: -1 }
      : { id: TerminalActionId.GotoPaneRing, delta: -1 };
  }
  if (event.code === 'BracketRight') {
    return event.shiftKey
      ? { id: TerminalActionId.SwitchTab, delta: 1 }
      : { id: TerminalActionId.GotoPaneRing, delta: 1 };
  }
  if (dir && event.altKey && !event.ctrlKey) {
    return { id: TerminalActionId.GotoPaneDirection, dir };
  }
  if (dir && event.ctrlKey && !event.altKey) {
    return { id: TerminalActionId.ResizePane, dir };
  }
  if (
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === '=' || event.code === 'Equal')
  ) {
    return { id: TerminalActionId.EqualizePanes };
  }

  return null;
}

export function runTerminalAction(action: TerminalAction, target: TerminalActionTarget): void {
  switch (action.id) {
    case TerminalActionId.New:
      target.newTab();
      return;
    case TerminalActionId.CloseActiveTab:
      target.closeTab(target.activeTabId);
      return;
    case TerminalActionId.SplitPane:
      target.splitPane(action.dir);
      return;
    case TerminalActionId.ToggleZoom:
      target.toggleZoom();
      return;
    case TerminalActionId.SwitchTab:
      target.switchTab(action.delta);
      return;
    case TerminalActionId.GotoTab:
      target.gotoTab(action.index);
      return;
    case TerminalActionId.LastTab:
      target.lastTab();
      return;
    case TerminalActionId.GotoPaneRing:
      target.gotoPaneRing(action.delta);
      return;
    case TerminalActionId.GotoPaneDirection:
      target.gotoPaneDir(action.dir);
      return;
    case TerminalActionId.ResizePane:
      target.resizePane(action.dir);
      return;
    case TerminalActionId.EqualizePanes:
      target.equalizePanes();
      return;
  }
}

function terminalDigit(event: TerminalKeybindingEvent): number {
  if (event.code.length === 6 && event.code.startsWith('Digit')) {
    return Number(event.code.slice(5));
  }
  return /^[1-9]$/.test(event.key) ? Number(event.key) : 0;
}

function arrowDirection(key: string): FocusDir | null {
  if (key === 'ArrowLeft') return 'left';
  if (key === 'ArrowRight') return 'right';
  if (key === 'ArrowUp') return 'up';
  if (key === 'ArrowDown') return 'down';
  return null;
}

import { describe, expect, it, vi } from 'vitest';
import {
  TerminalActionId,
  type TerminalActionTarget,
  type TerminalKeybindingEvent,
  resolveTerminalKeybinding,
  runTerminalAction,
} from '../src/workbench/contrib/terminal/browser/terminalActions.js';

const key = (overrides: Partial<TerminalKeybindingEvent>): TerminalKeybindingEvent => ({
  key: '',
  code: '',
  metaKey: true,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...overrides,
});

const focused = { terminalFocused: true, targetEditable: false };

describe('terminal actions', () => {
  it('ignores keybindings outside terminal focus or inside editable controls', () => {
    expect(
      resolveTerminalKeybinding(key({ key: 't', code: 'KeyT' }), {
        terminalFocused: false,
        targetEditable: false,
      }),
    ).toBeNull();
    expect(
      resolveTerminalKeybinding(key({ key: 't', code: 'KeyT' }), {
        terminalFocused: true,
        targetEditable: true,
      }),
    ).toBeNull();
    expect(
      resolveTerminalKeybinding(key({ key: 't', code: 'KeyT', metaKey: false }), focused),
    ).toBeNull();
  });

  it('resolves tab number keybindings to tab selection commands', () => {
    expect(resolveTerminalKeybinding(key({ key: '2', code: 'Digit2' }), focused)).toEqual({
      id: TerminalActionId.GotoTab,
      index: 2,
    });
    expect(resolveTerminalKeybinding(key({ key: '9', code: 'Digit9' }), focused)).toEqual({
      id: TerminalActionId.LastTab,
    });
  });

  it('resolves the terminal creation, closing, split, zoom, focus, and resize keys', () => {
    expect(resolveTerminalKeybinding(key({ key: 't', code: 'KeyT' }), focused)).toEqual({
      id: TerminalActionId.New,
    });
    expect(
      resolveTerminalKeybinding(key({ key: 'w', code: 'KeyW', altKey: true }), focused),
    ).toEqual({ id: TerminalActionId.CloseActiveTab });
    expect(resolveTerminalKeybinding(key({ key: 'd', code: 'KeyD' }), focused)).toEqual({
      id: TerminalActionId.SplitPane,
      dir: 'right',
    });
    expect(
      resolveTerminalKeybinding(key({ key: 'D', code: 'KeyD', shiftKey: true }), focused),
    ).toEqual({ id: TerminalActionId.SplitPane, dir: 'down' });
    expect(
      resolveTerminalKeybinding(key({ key: 'Enter', code: 'Enter', shiftKey: true }), focused),
    ).toEqual({ id: TerminalActionId.ToggleZoom });
    expect(resolveTerminalKeybinding(key({ key: '[', code: 'BracketLeft' }), focused)).toEqual({
      id: TerminalActionId.GotoPaneRing,
      delta: -1,
    });
    expect(
      resolveTerminalKeybinding(key({ key: '[', code: 'BracketLeft', shiftKey: true }), focused),
    ).toEqual({ id: TerminalActionId.SwitchTab, delta: -1 });
    expect(
      resolveTerminalKeybinding(
        key({ key: 'ArrowRight', code: 'ArrowRight', altKey: true }),
        focused,
      ),
    ).toEqual({ id: TerminalActionId.GotoPaneDirection, dir: 'right' });
    expect(
      resolveTerminalKeybinding(
        key({ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true }),
        focused,
      ),
    ).toEqual({ id: TerminalActionId.ResizePane, dir: 'down' });
    expect(
      resolveTerminalKeybinding(key({ key: '=', code: 'Equal', ctrlKey: true }), focused),
    ).toEqual({ id: TerminalActionId.EqualizePanes });
  });

  it('runs resolved terminal actions against the terminal state target', () => {
    const target: TerminalActionTarget = {
      activeTabId: 'tab1',
      newTab: vi.fn(),
      closeTab: vi.fn(),
      splitPane: vi.fn(),
      toggleZoom: vi.fn(),
      switchTab: vi.fn(),
      gotoTab: vi.fn(),
      lastTab: vi.fn(),
      gotoPaneRing: vi.fn(),
      gotoPaneDir: vi.fn(),
      resizePane: vi.fn(),
      equalizePanes: vi.fn(),
    };

    runTerminalAction({ id: TerminalActionId.New }, target);
    runTerminalAction({ id: TerminalActionId.CloseActiveTab }, target);
    runTerminalAction({ id: TerminalActionId.SplitPane, dir: 'down' }, target);
    runTerminalAction({ id: TerminalActionId.ToggleZoom }, target);
    runTerminalAction({ id: TerminalActionId.SwitchTab, delta: 1 }, target);
    runTerminalAction({ id: TerminalActionId.GotoTab, index: 3 }, target);
    runTerminalAction({ id: TerminalActionId.LastTab }, target);
    runTerminalAction({ id: TerminalActionId.GotoPaneRing, delta: -1 }, target);
    runTerminalAction({ id: TerminalActionId.GotoPaneDirection, dir: 'left' }, target);
    runTerminalAction({ id: TerminalActionId.ResizePane, dir: 'up' }, target);
    runTerminalAction({ id: TerminalActionId.EqualizePanes }, target);

    expect(target.newTab).toHaveBeenCalledTimes(1);
    expect(target.closeTab).toHaveBeenCalledWith('tab1');
    expect(target.splitPane).toHaveBeenCalledWith('down');
    expect(target.toggleZoom).toHaveBeenCalledTimes(1);
    expect(target.switchTab).toHaveBeenCalledWith(1);
    expect(target.gotoTab).toHaveBeenCalledWith(3);
    expect(target.lastTab).toHaveBeenCalledTimes(1);
    expect(target.gotoPaneRing).toHaveBeenCalledWith(-1);
    expect(target.gotoPaneDir).toHaveBeenCalledWith('left');
    expect(target.resizePane).toHaveBeenCalledWith('up');
    expect(target.equalizePanes).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  QuickPickFocus,
  quickInputService,
} from '../src/platform/quickinput/browser/quickInputService.js';

describe('quickInputService', () => {
  it('owns a stable quick access controller instance', () => {
    expect(quickInputService.quickAccess).toBe(quickInputService.quickAccess);

    quickInputService.quickAccess.show('>');
    expect(quickInputService.quickAccess.getState()).toMatchObject({ visible: true, value: '>' });

    quickInputService.quickAccess.hide();
    expect(quickInputService.quickAccess.isVisible()).toBe(false);
  });

  it('creates a headless quick pick with VS Code-style lifecycle events', () => {
    const picker = quickInputService.createQuickPick<{
      readonly id: string;
      readonly label: string;
    }>();
    const first = { id: 'first', label: 'First' };
    const second = { id: 'second', label: 'Second' };
    const values: string[] = [];
    const onAccept = vi.fn();
    const onHide = vi.fn();

    const disposeValueListener = picker.onDidChangeValue((value) => values.push(value));
    picker.onDidAccept(onAccept);
    picker.onDidHide(onHide);

    picker.items = [first, second];
    picker.activeItems = [first];
    picker.selectedItems = [second];
    picker.value = 'git';
    picker.value = 'git';

    expect(values).toEqual(['git']);
    expect(picker.items).toEqual([first, second]);

    picker.items = [first];
    expect(picker.activeItems).toEqual([first]);
    expect(picker.selectedItems).toEqual([]);

    picker.show();
    expect(picker.visible).toBe(true);

    picker.accept();
    expect(onAccept).toHaveBeenCalledTimes(1);

    picker.hide();
    expect(picker.visible).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);

    disposeValueListener();
    picker.value = 'branch';
    expect(values).toEqual(['git']);
  });

  it('disposes visible quick picks by hiding once and rejecting later mutation', () => {
    const picker = quickInputService.createQuickPick();
    const onHide = vi.fn();
    picker.onDidHide(onHide);

    picker.show();
    picker.dispose();

    expect(picker.disposed).toBe(true);
    expect(picker.visible).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(() => {
      picker.value = 'after-dispose';
    }).toThrow('Quick pick is disposed');
  });

  it('routes focus, navigation, accept, and cancel through the active quick pick', () => {
    const picker = quickInputService.createQuickPick<{
      readonly id: string;
      readonly label: string;
    }>();
    const first = { id: 'first', label: 'First' };
    const second = { id: 'second', label: 'Second' };
    const activeIds: string[][] = [];
    const onFocus = vi.fn();
    const onAccept = vi.fn();
    const onHide = vi.fn();

    picker.items = [first, second];
    picker.onDidFocus(onFocus);
    picker.onDidAccept(onAccept);
    picker.onDidHide(onHide);
    picker.onDidChangeActive((items) => activeIds.push(items.map((item) => item.id)));
    picker.show();

    quickInputService.focus();
    quickInputService.navigate(true);
    quickInputService.navigate(true);
    quickInputService.navigate(false);
    quickInputService.accept();
    quickInputService.cancel();

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(activeIds).toEqual([['first'], ['second'], ['first']]);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(picker.visible).toBe(false);
  });

  it('keeps VS Code-shaped quick pick state and accept events headless', () => {
    const picker = quickInputService.createQuickPick<{
      readonly id: string;
      readonly label: string;
    }>({ useSeparators: true });
    const first = { id: 'first', label: 'First' };
    const second = { id: 'second', label: 'Second' };
    const onAccept = vi.fn();
    const onWillAccept = vi.fn();

    picker.items = [{ type: 'separator', label: 'Group' }, first, second];
    picker.filterValue = (value) => value.replace(/^>/, '');
    picker.valueSelection = [1, 4];
    picker.onWillAccept((event) => {
      onWillAccept();
      event.veto();
    });
    picker.onDidAccept(onAccept);

    expect(picker.filterValue('>git')).toBe('git');
    expect(picker.valueSelection).toEqual([1, 4]);

    picker.show();
    picker.focusOnInput();
    expect(picker.inputHasFocus()).toBe(true);

    picker.focus(QuickPickFocus.Last);
    expect(picker.activeItems).toEqual([second]);

    picker.accept(true);
    expect(onWillAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('passes background accept metadata when no will-accept listener vetoes', () => {
    const picker = quickInputService.createQuickPick();
    const onAccept = vi.fn();

    picker.onDidAccept(onAccept);
    picker.accept(true);

    expect(onAccept).toHaveBeenCalledWith({ inBackground: true });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { QuickInputController } from '../src/platform/quickinput/browser/quickInputController.js';

describe('QuickInputController', () => {
  it('creates quick picks and routes focus, navigation, accept, and cancel to the active one', () => {
    const controller = new QuickInputController();
    const picker = controller.createQuickPick<{
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

    controller.focus();
    controller.navigate(true);
    controller.navigate(true);
    controller.navigate(false);
    controller.accept();
    controller.cancel();

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(activeIds).toEqual([['first'], ['second'], ['first']]);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(picker.visible).toBe(false);
  });

  it('does not route commands to a hidden picker', () => {
    const controller = new QuickInputController();
    const picker = controller.createQuickPick<{ readonly id: string; readonly label: string }>();
    const item = { id: 'item', label: 'Item' };
    const onAccept = vi.fn();

    picker.items = [item];
    picker.onDidAccept(onAccept);
    picker.show();
    picker.hide();

    controller.accept();

    expect(onAccept).not.toHaveBeenCalled();
  });
});

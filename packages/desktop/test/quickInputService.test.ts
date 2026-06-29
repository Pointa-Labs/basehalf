import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QuickPickFocus,
  isQuickPickItem,
  quickInputService,
} from '../src/platform/quickinput/browser/quickInputService.js';
import type { IQuickPick, IQuickPickItem } from '../src/platform/quickinput/common/quickInput.js';

describe('quickInputService', () => {
  afterEach(() => {
    quickInputService.cancel();
    quickInputService.quickAccess.hide();
  });

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

  it('resolves single picks through the host quick pick model', async () => {
    const choice = quickInputService.pick({
      title: 'Switch Branch',
      options: [
        { value: 'main', label: 'main' },
        { value: 'topic', label: 'topic', hint: 'local' },
      ],
    });
    const picker = expectActiveQuickPick();

    expect(picker).toMatchObject({
      visible: true,
      title: 'Switch Branch',
      placeholder: 'Search…',
      canSelectMany: false,
    });
    expect(picker.items.map((item) => (isQuickPickItem(item) ? item.label : ''))).toEqual([
      'main',
      'topic',
    ]);
    expect(picker.activeItems.map((item) => item.id)).toEqual(['main']);

    quickInputService.accept();

    await expect(choice).resolves.toBe('main');
    expect(quickInputService.getHostState().activeQuickPick).toBeUndefined();
  });

  it('resolves pickWithInputValue with the raw query while preserving always-show choices', async () => {
    const choice = quickInputService.pickWithInputValue({
      title: 'Create Branch',
      options: [{ value: 'cmd:create', label: 'Create new branch', alwaysShow: true }],
    });
    const picker = expectActiveQuickPick();

    picker.value = 'feature/new-branch';
    picker.activeItems = [expectQuickPickItem(picker, 0)];
    quickInputService.accept();

    await expect(choice).resolves.toEqual({
      value: 'cmd:create',
      inputValue: 'feature/new-branch',
    });
  });

  it('resolves many picks with selected value normalization intact', async () => {
    const choice = quickInputService.pick({
      title: 'Select refs',
      canSelectMany: true,
      selectedValues: ['main', 'missing'],
      normalizeSelectedValues: ({ addedValue, nextValues }) =>
        addedValue === 'topic' ? ['topic'] : nextValues,
      options: [
        { value: 'main', label: 'main' },
        { value: 'topic', label: 'topic' },
      ],
    });
    const picker = expectActiveQuickPick();
    const topic = expectQuickPickItem(picker, 1);

    expect(picker.canSelectMany).toBe(true);
    expect(picker.selectedItems.map((item) => item.id)).toEqual(['main']);

    picker.selectedItems = [...picker.selectedItems, topic];
    quickInputService.accept();

    await expect(choice).resolves.toEqual(['topic']);
  });

  it('keeps many-pick selections while filtering hides selected rows', async () => {
    const choice = quickInputService.pick({
      title: 'Select refs',
      canSelectMany: true,
      selectedValues: ['main'],
      options: [
        { value: 'main', label: 'main' },
        { value: 'topic', label: 'topic' },
      ],
    });
    const picker = expectActiveQuickPick();

    picker.value = 'topic';

    expect(picker.items.map((item) => (isQuickPickItem(item) ? item.id : ''))).toEqual(['topic']);
    expect(picker.selectedItems).toEqual([]);

    quickInputService.accept();

    await expect(choice).resolves.toEqual(['main']);
  });
});

function expectActiveQuickPick(): IQuickPick<IQuickPickItem> {
  const picker = quickInputService.getHostState().activeQuickPick;
  if (picker === undefined) throw new Error('Expected an active host quick pick');
  return picker;
}

function expectQuickPickItem(picker: IQuickPick<IQuickPickItem>, index: number): IQuickPickItem {
  const item = picker.items[index];
  if (item === undefined || !isQuickPickItem(item)) {
    throw new Error(`Expected quick pick item at index ${index}`);
  }
  return item;
}

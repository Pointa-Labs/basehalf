import { describe, expect, it, vi } from 'vitest';
import {
  type PickerQuickAccessDisposableStore,
  type PickerQuickAccessItem,
  PickerQuickAccessProvider,
  type PickerQuickAccessProviderOptions,
} from '../src/platform/quickinput/browser/pickerQuickAccess.js';
import { QuickAccessController } from '../src/platform/quickinput/browser/quickAccessController.js';
import { QuickInputController } from '../src/platform/quickinput/browser/quickInputController.js';
import type {
  CancellationToken,
  QuickAccessProviderRunOptions,
} from '../src/platform/quickinput/common/quickAccess.js';
import { QuickAccessRegistry } from '../src/platform/quickinput/common/quickAccess.js';
import type { IQuickPick } from '../src/platform/quickinput/common/quickInput.js';

interface TestPick extends PickerQuickAccessItem {
  readonly id: string;
}

class TestPickerProvider extends PickerQuickAccessProvider<TestPick> {
  readonly calls: string[] = [];
  lastPicker: IQuickPick<TestPick> | undefined;

  constructor(
    private readonly picksForFilter: (filter: string) => readonly TestPick[],
    options?: PickerQuickAccessProviderOptions<TestPick>,
  ) {
    super('>', options);
  }

  override provide(
    picker: IQuickPick<TestPick>,
    token: CancellationToken,
    runOptions?: QuickAccessProviderRunOptions,
  ) {
    this.lastPicker = picker;
    return super.provide(picker, token, runOptions);
  }

  protected getPicks(
    filter: string,
    _disposables: PickerQuickAccessDisposableStore,
    _token: CancellationToken,
  ) {
    this.calls.push(filter);
    return this.picksForFilter(filter);
  }
}

describe('PickerQuickAccessProvider', () => {
  it('fills picker items from the filtered value and updates as the picker changes', () => {
    const provider = new TestPickerProvider((filter) => [
      { id: filter || 'empty', label: `Pick ${filter || 'empty'}` },
    ]);
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });
    const controller = new QuickAccessController(registry, new QuickInputController());

    controller.show('>git');
    const picker = provider.lastPicker;
    if (picker === undefined) throw new Error('picker was not provided');

    expect(provider.calls).toEqual(['git']);
    expect(picker.items).toEqual([{ id: 'git', label: 'Pick git' }]);
    expect(picker.matchOnLabel).toBe(false);
    expect(picker.sortByLabel).toBe(false);

    picker.value = '>branch';

    expect(provider.calls).toEqual(['git', 'branch']);
    expect(picker.items).toEqual([{ id: 'branch', label: 'Pick branch' }]);
  });

  it('uses no-results picks for non-empty filters', () => {
    const provider = new TestPickerProvider(() => [], {
      noResultsPick: (filter) => ({ id: 'empty', label: `No results for ${filter}` }),
    });
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });

    new QuickAccessController(registry, new QuickInputController()).show('>  missing  ');

    expect(provider.calls).toEqual(['missing']);
    expect(provider.lastPicker?.items).toEqual([{ id: 'empty', label: 'No results for missing' }]);
  });

  it('accepts the active pick and hides the picker', () => {
    const accept = vi.fn();
    const pick: TestPick = { id: 'git', label: 'Git', accept };
    const provider = new TestPickerProvider(() => ({ items: [pick], active: pick }));
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });
    const controller = new QuickAccessController(registry, new QuickInputController());

    controller.show('>git');
    const picker = provider.lastPicker;
    if (picker === undefined) throw new Error('picker was not provided');
    picker.accept();

    expect(accept).toHaveBeenCalledWith(picker.keyMods, { inBackground: false });
    expect(controller.getState()).toMatchObject({ visible: false });
  });

  it('delegates accepts to run options when provided', () => {
    const pick: TestPick = { id: 'git', label: 'Git' };
    const handleAccept = vi.fn();
    const provider = new TestPickerProvider(() => ({ items: [pick], active: pick }));
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });

    new QuickAccessController(registry, new QuickInputController()).show('>git', {
      providerOptions: { handleAccept },
    });
    provider.lastPicker?.accept(true);

    expect(handleAccept).toHaveBeenCalledWith(pick, true);
    expect(provider.lastPicker?.visible).toBe(true);
  });
});

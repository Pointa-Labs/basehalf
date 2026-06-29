import { describe, expect, it, vi } from 'vitest';
import { QuickAccessController } from '../src/platform/quickinput/browser/quickAccessController.js';
import { QuickInputController } from '../src/platform/quickinput/browser/quickInputController.js';
import { quickInputService } from '../src/platform/quickinput/browser/quickInputService.js';
import {
  type CancellationToken,
  DefaultQuickAccessFilterValue,
  type IQuickAccessProvider,
  QuickAccessRegistry,
} from '../src/platform/quickinput/common/quickAccess.js';
import { ItemActivation } from '../src/platform/quickinput/common/quickInput.js';
import { registerCommandPaletteQuickAccessProviders } from '../src/workbench/browser/quickaccess/quickAccessContributions.js';
import {
  COMMANDS_QUICK_ACCESS_ID,
  COMMANDS_QUICK_ACCESS_PREFIX,
  DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID,
} from '../src/workbench/common/quickaccess/commandPaletteProviders.js';

describe('QuickAccessController', () => {
  it('shows and hides quick access while notifying subscribers', () => {
    const controller = new QuickAccessController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.show('>git');

    expect(controller.getState()).toEqual({
      visible: true,
      value: '>git',
      filterValue: '>git',
      prefix: '',
      valueSelection: [0, 4],
    });
    expect(controller.isVisible()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    controller.hide();

    expect(controller.getState()).toEqual({
      visible: false,
      value: '',
      filterValue: '',
      prefix: '',
      valueSelection: [0, 0],
    });
    expect(controller.isVisible()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    controller.show();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when a show or hide keeps the same state', () => {
    const controller = new QuickAccessController();
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.hide();
    controller.show();
    controller.show();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('toggles visibility using the same controller state path', () => {
    const controller = new QuickAccessController();

    controller.toggle('files');
    expect(controller.getState()).toMatchObject({
      visible: true,
      value: 'files',
      filterValue: 'files',
    });

    controller.toggle('ignored');
    expect(controller.getState()).toMatchObject({ visible: false, value: '' });
  });

  it('resolves providers by longest prefix and exposes filter metadata', () => {
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({
      id: 'anything',
      prefix: '',
      placeholder: 'Anything',
    });
    registry.registerQuickAccessProvider({
      id: 'commands',
      prefix: '>',
      placeholder: 'Commands',
    });
    registry.registerQuickAccessProvider({
      id: 'tasks',
      prefix: '>task ',
      placeholder: 'Tasks',
    });
    const controller = new QuickAccessController(registry);

    controller.show('>task build');

    expect(controller.getState()).toEqual({
      visible: true,
      value: '>task build',
      filterValue: 'build',
      providerId: 'tasks',
      prefix: '>task ',
      placeholder: 'Tasks',
      valueSelection: [6, 11],
    });
  });

  it('updates provider metadata when the typed value changes', () => {
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({
      id: 'anything',
      prefix: '',
      placeholder: 'Anything',
    });
    registry.registerQuickAccessProvider({
      id: 'commands',
      prefix: '>',
      placeholder: 'Commands',
    });
    const controller = new QuickAccessController(registry);

    controller.show();
    controller.updateValue('>git');

    expect(controller.getState()).toMatchObject({
      visible: true,
      value: '>git',
      filterValue: 'git',
      providerId: 'commands',
      prefix: '>',
      placeholder: 'Commands',
      valueSelection: [4, 4],
    });
  });

  it('keeps an existing provider run alive while syncing typed values', () => {
    const registry = new QuickAccessRegistry();
    const quickInput = new QuickInputController();
    const dispose = vi.fn();
    const provider: IQuickAccessProvider = {
      provide: vi.fn(() => ({ dispose })),
    };
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });
    const controller = new QuickAccessController(registry, quickInput);

    controller.show('>');
    const picker = vi.mocked(provider.provide).mock.calls[0]?.[0];
    controller.updateValue('>git');

    expect(provider.provide).toHaveBeenCalledTimes(1);
    expect(picker?.value).toBe('>git');
    expect(dispose).not.toHaveBeenCalled();
  });

  it('remembers accepted provider values for LAST defaults', () => {
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({
      id: 'commands',
      prefix: '>',
      defaultFilterValue: DefaultQuickAccessFilterValue.LAST,
    });
    const controller = new QuickAccessController(registry);

    controller.show('>git');
    controller.accept('>branch');
    controller.hide();
    controller.show('>');

    expect(controller.getState()).toMatchObject({
      value: '>branch',
      filterValue: 'branch',
      providerId: 'commands',
    });
  });

  it('uses provider-owned defaults when the descriptor delegates provider behavior', () => {
    const registry = new QuickAccessRegistry();
    const provider: IQuickAccessProvider = {
      defaultFilterValue: 'git',
      provide: vi.fn(() => ({ dispose: vi.fn() })),
    };
    registry.registerQuickAccessProvider({
      id: 'commands',
      prefix: '>',
      provider,
    });
    const controller = new QuickAccessController(registry);

    controller.show('>');

    expect(controller.getState()).toMatchObject({
      value: '>git',
      filterValue: 'git',
      providerId: 'commands',
    });
    expect(registry.getQuickAccessProvider('>')?.provider).toBe(provider);
  });

  it('runs provider lifecycle with a quick pick when quick input is available', () => {
    const registry = new QuickAccessRegistry();
    const quickInput = new QuickInputController();
    const dispose = vi.fn();
    const provider: IQuickAccessProvider = {
      provide: vi.fn((picker, token, options) => {
        picker.items = [{ label: 'Git: Fetch' }];
        return { dispose };
      }),
    };
    registry.registerQuickAccessProvider({
      id: 'commands',
      prefix: '>',
      contextKey: 'inCommandPalette',
      placeholder: 'Commands',
      provider,
    });
    const controller = new QuickAccessController(registry, quickInput);

    controller.show('>git', {
      providerOptions: { from: 'test' },
      quickNavigateConfiguration: { keybindings: ['ctrl+p'] },
      itemActivation: ItemActivation.LAST,
    });

    expect(provider.provide).toHaveBeenCalledTimes(1);
    const [picker, token, options] = vi.mocked(provider.provide).mock.calls[0] ?? [];
    expect(picker?.value).toBe('>git');
    expect(picker?.filterValue('>git')).toBe('git');
    expect(picker?.valueSelection).toEqual([1, 4]);
    expect(picker?.placeholder).toBe('Commands');
    expect(picker?.contextKey).toBe('inCommandPalette');
    expect(picker?.quickNavigate).toEqual({ keybindings: ['ctrl+p'] });
    expect(picker?.hideInput).toBe(true);
    expect(picker?.itemActivation).toBe(ItemActivation.LAST);
    expect(picker?.visible).toBe(true);
    expect(picker?.items).toEqual([{ label: 'Git: Fetch' }]);
    expect(token?.isCancellationRequested).toBe(false);
    expect(options).toEqual({ from: 'test' });
  });

  it('switches provider runs when a provider-owned picker value changes prefix', () => {
    const registry = new QuickAccessRegistry();
    const quickInput = new QuickInputController();
    const disposeCommands = vi.fn();
    const disposeTasks = vi.fn();
    const commandsProvider: IQuickAccessProvider = {
      provide: vi.fn(() => ({ dispose: disposeCommands })),
    };
    const tasksProvider: IQuickAccessProvider = {
      provide: vi.fn(() => ({ dispose: disposeTasks })),
    };
    registry.registerQuickAccessProvider({
      id: 'commands',
      prefix: '>',
      provider: commandsProvider,
    });
    registry.registerQuickAccessProvider({
      id: 'tasks',
      prefix: '#',
      provider: tasksProvider,
    });
    const controller = new QuickAccessController(registry, quickInput);

    controller.show('>git');
    const commandsPicker = vi.mocked(commandsProvider.provide).mock.calls[0]?.[0];
    if (commandsPicker === undefined) throw new Error('commands picker was not provided');
    commandsPicker.value = '#build';

    expect(controller.getState()).toMatchObject({
      visible: true,
      value: '#build',
      filterValue: 'build',
      providerId: 'tasks',
      prefix: '#',
    });
    expect(disposeCommands).toHaveBeenCalledTimes(1);
    expect(tasksProvider.provide).toHaveBeenCalledTimes(1);
    const tasksPicker = vi.mocked(tasksProvider.provide).mock.calls[0]?.[0];
    expect(tasksPicker?.value).toBe('#build');
    expect(tasksPicker?.filterValue('#build')).toBe('build');
    expect(disposeTasks).not.toHaveBeenCalled();
  });

  it('remembers LAST defaults when a provider-owned picker accepts', () => {
    const registry = new QuickAccessRegistry();
    const quickInput = new QuickInputController();
    const provider: IQuickAccessProvider = {
      defaultFilterValue: DefaultQuickAccessFilterValue.LAST,
      provide: vi.fn(() => ({ dispose: vi.fn() })),
    };
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });
    const controller = new QuickAccessController(registry, quickInput);

    controller.show('>git');
    const picker = vi.mocked(provider.provide).mock.calls[0]?.[0];
    if (picker === undefined) throw new Error('picker was not provided');
    picker.accept();
    controller.hide();
    controller.show('>');

    expect(controller.getState()).toMatchObject({
      value: '>git',
      filterValue: 'git',
      providerId: 'commands',
    });
  });

  it('closes controller state when a provider-owned picker hides itself', () => {
    const registry = new QuickAccessRegistry();
    const quickInput = new QuickInputController();
    const dispose = vi.fn();
    const provider: IQuickAccessProvider = {
      provide: vi.fn(() => ({ dispose })),
    };
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });
    const controller = new QuickAccessController(registry, quickInput);

    controller.show('>git');
    const picker = vi.mocked(provider.provide).mock.calls[0]?.[0];
    if (picker === undefined) throw new Error('picker was not provided');
    picker.hide();

    expect(controller.getState()).toMatchObject({ visible: false, value: '' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('cancels and disposes provider runs when quick access hides', () => {
    const registry = new QuickAccessRegistry();
    const quickInput = new QuickInputController();
    const dispose = vi.fn();
    const onCancellationRequested = vi.fn();
    let providedToken: CancellationToken | undefined;
    const provider: IQuickAccessProvider = {
      provide: vi.fn((_picker, token) => {
        providedToken = token;
        token.onCancellationRequested(onCancellationRequested);
        return { dispose };
      }),
    };
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });
    const controller = new QuickAccessController(registry, quickInput);

    controller.show('>git');
    controller.hide();

    expect(providedToken?.isCancellationRequested).toBe(true);
    expect(onCancellationRequested).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('cleans up quick picks when a provider throws during startup', () => {
    const registry = new QuickAccessRegistry();
    const quickInput = new QuickInputController();
    const onCancellationRequested = vi.fn();
    let providedPicker: { readonly visible: boolean; readonly disposed: boolean } | undefined;
    let providedToken: CancellationToken | undefined;
    const provider: IQuickAccessProvider = {
      provide: vi.fn((picker, token) => {
        providedPicker = picker;
        providedToken = token;
        token.onCancellationRequested(onCancellationRequested);
        throw new Error('provider exploded');
      }),
    };
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>', provider });
    const controller = new QuickAccessController(registry, quickInput);

    expect(() => controller.show('>git')).toThrow('provider exploded');

    expect(providedToken?.isCancellationRequested).toBe(true);
    expect(onCancellationRequested).toHaveBeenCalledTimes(1);
    expect(providedPicker?.visible).toBe(false);
    expect(providedPicker?.disposed).toBe(true);
  });

  it('can preserve the full value selection for direct re-entry', () => {
    const registry = new QuickAccessRegistry();
    registry.registerQuickAccessProvider({ id: 'commands', prefix: '>' });
    const controller = new QuickAccessController(registry);

    controller.show('>git', { preserveValue: true });

    expect(controller.getState()).toMatchObject({
      value: '>git',
      filterValue: 'git',
      valueSelection: [4, 4],
    });
  });

  it('registers command palette quick access providers from an explicit contribution', () => {
    const registry = new QuickAccessRegistry();

    registerCommandPaletteQuickAccessProviders(registry);
    registerCommandPaletteQuickAccessProviders(registry);

    expect(registry.getQuickAccessProviders().map((provider) => provider.id)).toEqual([
      DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID,
      COMMANDS_QUICK_ACCESS_ID,
    ]);
    expect(registry.getQuickAccessProvider('>git')).toMatchObject({
      id: COMMANDS_QUICK_ACCESS_ID,
      prefix: COMMANDS_QUICK_ACCESS_PREFIX,
      placeholder: 'Type the name of a command to run',
    });
  });

  it('is exposed through the quick input service boundary', () => {
    quickInputService.quickAccess.hide();

    quickInputService.quickAccess.show('>');

    expect(quickInputService.quickAccess.getState()).toMatchObject({
      visible: true,
      value: '>',
    });

    quickInputService.quickAccess.hide();
    expect(quickInputService.quickAccess.isVisible()).toBe(false);
  });
});

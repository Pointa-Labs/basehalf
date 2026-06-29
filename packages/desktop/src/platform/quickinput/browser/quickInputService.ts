import type {
  CreateQuickPickOptions,
  IQuickInputService,
  IQuickPick,
  IQuickPickItem,
  QuickInputHostState,
  QuickInputHostStateListener,
  QuickPickItemOrSeparator,
  QuickPickManyOptions,
  QuickPickOption,
  QuickPickSingleOptions,
  QuickPickValueResult,
} from '../common/quickInput.js';
import { isQuickPickItem } from '../common/quickInput.js';
import {
  filterQuickPickOptions,
  normalizeQuickPickSelectedValues,
  quickPickItemsWithSeparators,
  updateQuickPickSelectedValues,
} from '../common/quickPickModel.js';
import { QuickAccessController } from './quickAccessController.js';
import { QuickInputController } from './quickInputController.js';

export type {
  CreateQuickPickOptions,
  IKeyMods,
  IQuickInputButton,
  IQuickInputService,
  IQuickNavigateConfiguration,
  QuickInputHostState,
  QuickInputHostStateListener,
  IQuickPick,
  IQuickPickDidAcceptEvent,
  IQuickPickItem,
  IQuickPickItemButtonEvent,
  IQuickPickSeparator,
  IQuickPickSeparatorButtonEvent,
  IQuickPickWillAcceptEvent,
  QuickInputValidationSeverity,
  QuickPickBaseOptions,
  QuickPickItemOrSeparator,
  QuickPickManyOptions,
  QuickPickOption,
  QuickPickOptions,
  QuickPickSelectionChange,
  QuickPickSelectionNormalizer,
  QuickPickSingleOptions,
  QuickPickSortOptions,
  QuickPickValueResult,
} from '../common/quickInput.js';
export {
  ItemActivation,
  NO_KEY_MODS,
  QuickPickFocus,
  isKeyModified,
  isQuickPickItem,
  isQuickPickSeparator,
} from '../common/quickInput.js';

interface ServiceQuickPickItem extends IQuickPickItem {
  readonly option: QuickPickOption;
  readonly value: string;
}

class BrowserQuickInputService implements IQuickInputService {
  readonly quickAccess = new QuickAccessController(undefined, this);
  private readonly controller = new QuickInputController();

  getHostState(): QuickInputHostState {
    return this.controller.getHostState();
  }

  subscribe(listener: QuickInputHostStateListener): () => void {
    return this.controller.subscribe(listener);
  }

  createQuickPick<T extends IQuickPickItem>(_options: CreateQuickPickOptions = {}): IQuickPick<T> {
    return this.controller.createQuickPick<T>(_options);
  }

  focus(): void {
    this.controller.focus();
  }

  navigate(next: boolean): void {
    this.controller.navigate(next);
  }

  accept(): void {
    this.controller.accept();
  }

  cancel(): void {
    this.controller.cancel();
  }

  pick(opts: QuickPickSingleOptions): Promise<string | null>;
  pick(opts: QuickPickManyOptions): Promise<readonly string[] | null>;
  pick(
    opts: QuickPickSingleOptions | QuickPickManyOptions,
  ): Promise<string | readonly string[] | null> {
    return this.pickWithHostQuickPick(opts, false);
  }

  pickWithInputValue(opts: QuickPickSingleOptions): Promise<QuickPickValueResult | null> {
    return this.pickWithHostQuickPick(opts, true);
  }

  private pickWithHostQuickPick(
    opts: QuickPickSingleOptions,
    includeInputValue: true,
  ): Promise<QuickPickValueResult | null>;
  private pickWithHostQuickPick(
    opts: QuickPickSingleOptions | QuickPickManyOptions,
    includeInputValue: false,
  ): Promise<string | readonly string[] | null>;
  private pickWithHostQuickPick(
    opts: QuickPickSingleOptions | QuickPickManyOptions,
    includeInputValue: boolean,
  ): Promise<string | readonly string[] | QuickPickValueResult | null> {
    return new Promise((resolve) => {
      const picker = this.controller.createQuickPick<ServiceQuickPickItem>({
        renderInHost: true,
        useSeparators: true,
      });
      const optionItems = opts.options.map(quickPickItemFromOption);
      const itemByOption = new Map<QuickPickOption, ServiceQuickPickItem>();
      const itemByValue = new Map<string, ServiceQuickPickItem>();
      for (const item of optionItems) {
        itemByOption.set(item.option, item);
        if (!itemByValue.has(item.value)) itemByValue.set(item.value, item);
      }

      let settled = false;
      let previousSelectedValues =
        opts.canSelectMany === true
          ? normalizeQuickPickSelectedValues(opts.selectedValues ?? [], opts.options)
          : [];
      let normalizingSelection = false;
      let applyingFilteredItems = false;
      const disposables: (() => void)[] = [];

      const filteredItems = (
        query: string,
      ): readonly QuickPickItemOrSeparator<ServiceQuickPickItem>[] =>
        quickPickItemsWithSeparators(
          filterQuickPickOptions(
            query,
            opts.options,
            opts.canSelectMany === true ? undefined : opts.sortOptions,
          ),
          (option) => itemByOption.get(option),
        );

      const visibleQuickPickItems = (
        items: readonly QuickPickItemOrSeparator<ServiceQuickPickItem>[],
      ): readonly ServiceQuickPickItem[] => items.filter(isQuickPickItem);

      const selectedItemsForValues = (
        values: readonly string[],
        visibleItems: readonly ServiceQuickPickItem[],
      ): readonly ServiceQuickPickItem[] => {
        const visibleItemSet = new Set(visibleItems);
        return values
          .map((value) => itemByValue.get(value))
          .filter(
            (item): item is ServiceQuickPickItem => item !== undefined && visibleItemSet.has(item),
          );
      };

      const applyFilteredItems = (query: string): void => {
        const items = filteredItems(query);
        const visibleItems = visibleQuickPickItems(items);
        applyingFilteredItems = true;
        picker.items = items;
        if (picker.canSelectMany) {
          picker.activeItems = [];
          picker.selectedItems = selectedItemsForValues(previousSelectedValues, visibleItems);
          applyingFilteredItems = false;
          return;
        }
        const first = visibleItems[0];
        picker.activeItems = first === undefined ? [] : [first];
        applyingFilteredItems = false;
      };

      const finish = (result: string | readonly string[] | QuickPickValueResult | null): void => {
        if (settled) return;
        settled = true;
        for (const dispose of disposables) dispose();
        if (picker.visible) picker.hide();
        if (!picker.disposed) picker.dispose();
        resolve(result);
      };

      picker.title = opts.title;
      picker.placeholder = opts.placeholder ?? 'Search…';
      picker.emptyText = opts.emptyText ?? 'Nothing to choose from.';
      picker.canSelectMany = opts.canSelectMany === true;
      picker.ok = picker.canSelectMany ? 'default' : false;
      picker.okLabel = 'OK';

      disposables.push(
        picker.onDidChangeValue((value) => {
          applyFilteredItems(value);
        }),
        picker.onDidChangeSelection((items) => {
          if (opts.canSelectMany !== true || normalizingSelection || applyingFilteredItems) {
            return;
          }
          const nextValues = items.map((item) => item.value);
          const normalizedValues = updateQuickPickSelectedValues(
            previousSelectedValues,
            nextValues,
            opts.options,
            opts.normalizeSelectedValues,
          );
          previousSelectedValues = normalizedValues;
          const normalizedItems = normalizedValues
            .map((value) => itemByValue.get(value))
            .filter((item): item is ServiceQuickPickItem => item !== undefined);
          if (quickPickItemsEqual(items, normalizedItems)) return;
          normalizingSelection = true;
          picker.selectedItems = normalizedItems;
          normalizingSelection = false;
        }),
        picker.onDidAccept(() => {
          if (picker.canSelectMany) {
            finish(previousSelectedValues);
            return;
          }
          const active = picker.activeItems[0];
          if (active === undefined) return;
          finish(
            includeInputValue ? { value: active.value, inputValue: picker.value } : active.value,
          );
        }),
        picker.onDidHide(() => {
          finish(null);
        }),
      );

      applyFilteredItems(picker.value);
      picker.show();
    });
  }
}

/**
 * Browser quick input service boundary.
 *
 * The current implementation still renders through DialogHost, but callers now
 * depend on the quickinput platform service instead of dialog primitives. That
 * mirrors VS Code's `IQuickInputService` boundary and lets SCM/quick access move
 * toward raw quick pick lifecycles without touching each caller again.
 */
export const quickInputService: IQuickInputService = new BrowserQuickInputService();

export function pick(opts: QuickPickSingleOptions): Promise<string | null>;
export function pick(opts: QuickPickManyOptions): Promise<readonly string[] | null>;
export function pick(
  opts: QuickPickSingleOptions | QuickPickManyOptions,
): Promise<string | readonly string[] | null> {
  return opts.canSelectMany === true ? quickInputService.pick(opts) : quickInputService.pick(opts);
}

export function pickWithInputValue(
  opts: QuickPickSingleOptions,
): Promise<QuickPickValueResult | null> {
  return quickInputService.pickWithInputValue(opts);
}

function quickPickItemFromOption(option: QuickPickOption): ServiceQuickPickItem {
  return {
    id: option.value,
    label: option.label,
    value: option.value,
    option,
    ...(option.hint !== undefined && { description: option.hint }),
    ...(option.detail !== undefined && { detail: option.detail }),
    ...(option.alwaysShow !== undefined && { alwaysShow: option.alwaysShow }),
  };
}

function quickPickItemsEqual(
  a: readonly ServiceQuickPickItem[],
  b: readonly ServiceQuickPickItem[],
): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

import type {
  CancellationToken,
  IQuickAccessProvider,
  QuickAccessProviderDisposable,
  QuickAccessProviderRunOptions,
} from '../common/quickAccess.js';
import { QuickAccessCancellationTokenSource } from '../common/quickAccessModel.js';
import {
  type IKeyMods,
  type IQuickInputButton,
  type IQuickPick,
  type IQuickPickDidAcceptEvent,
  type IQuickPickItem,
  type IQuickPickSeparator,
  isKeyModified,
} from '../common/quickInput.js';

export enum TriggerAction {
  NO_ACTION = 0,
  CLOSE_PICKER = 1,
  REFRESH_PICKER = 2,
  REMOVE_ITEM = 3,
}

export interface PickerQuickAccessItem extends IQuickPickItem {
  accept?(keyMods: IKeyMods, event: IQuickPickDidAcceptEvent): void;
  attach?(keyMods: IKeyMods, event: IQuickPickDidAcceptEvent): void;
  trigger?(buttonIndex: number, keyMods: IKeyMods): TriggerAction | Promise<TriggerAction>;
}

export interface PickerQuickAccessSeparator extends IQuickPickSeparator {
  trigger?(buttonIndex: number, keyMods: IKeyMods): TriggerAction | Promise<TriggerAction>;
}

export interface PickerQuickAccessProviderOptions<T extends PickerQuickAccessItem> {
  readonly canAcceptInBackground?: boolean;
  readonly noResultsPick?: T | ((filter: string) => T);
  readonly shouldSkipTrimPickFilter?: boolean;
}

export type PickerQuickAccessPick<T extends PickerQuickAccessItem> = T | PickerQuickAccessSeparator;
export type PickerQuickAccessPicksWithActive<T extends PickerQuickAccessItem> = {
  readonly items: readonly PickerQuickAccessPick<T>[];
  readonly active?: T;
};
export type PickerQuickAccessPicks<T extends PickerQuickAccessItem> =
  | readonly PickerQuickAccessPick<T>[]
  | PickerQuickAccessPicksWithActive<T>;
export type PickerQuickAccessFastAndSlowPicks<T extends PickerQuickAccessItem> = {
  readonly picks: PickerQuickAccessPicks<T>;
  readonly additionalPicks: Promise<PickerQuickAccessPicks<T>>;
  readonly mergeDelay?: number;
};

export class PickerQuickAccessDisposableStore implements QuickAccessProviderDisposable {
  private readonly disposables: QuickAccessProviderDisposable[] = [];
  private disposed = false;

  add<T extends QuickAccessProviderDisposable>(disposable: T): T {
    if (this.disposed) {
      disposable.dispose();
      return disposable;
    }
    this.disposables.push(disposable);
    return disposable;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
  }
}

export abstract class PickerQuickAccessProvider<T extends PickerQuickAccessItem>
  implements IQuickAccessProvider
{
  constructor(
    private readonly prefix: string,
    protected readonly options: PickerQuickAccessProviderOptions<T> = {},
  ) {}

  provide(
    picker: IQuickPick<T>,
    token: CancellationToken,
    runOptions?: QuickAccessProviderRunOptions,
  ): QuickAccessProviderDisposable {
    const disposables = new PickerQuickAccessDisposableStore();
    let picksCancellation: QuickAccessCancellationTokenSource | undefined;
    let picksDisposables: PickerQuickAccessDisposableStore | undefined;

    picker.canAcceptInBackground = this.options.canAcceptInBackground === true;
    picker.matchOnLabel = false;
    picker.matchOnDescription = false;
    picker.matchOnDetail = false;
    picker.sortByLabel = false;

    const updatePickerItems = async (): Promise<void> => {
      picksCancellation?.cancel();
      picksDisposables?.dispose();
      picker.busy = false;

      const queryDisposables = new PickerQuickAccessDisposableStore();
      picksDisposables = queryDisposables;
      const queryCancellation = new QuickAccessCancellationTokenSource();
      picksCancellation = queryCancellation;
      queryDisposables.add(toDisposable(() => queryCancellation.cancel()));
      queryDisposables.add(
        toDisposable(token.onCancellationRequested(() => queryCancellation.cancel())),
      );

      let filter = picker.filterValue(picker.value);
      if (filter === picker.value && filter.startsWith(this.prefix)) {
        filter = filter.slice(this.prefix.length);
      }
      if (this.options.shouldSkipTrimPickFilter !== true) filter = filter.trim();

      const picksToken = queryCancellation.token;
      const providedPicks = this.getPicks(filter, queryDisposables, picksToken, runOptions);
      await this.applyProvidedPicks(picker, filter, providedPicks, picksToken);
    };

    disposables.add(toDisposable(picker.onDidChangeValue(() => void updatePickerItems())));
    void updatePickerItems();

    disposables.add(
      toDisposable(
        picker.onDidAccept((event) => {
          const activeItem = picker.activeItems[0];
          if (runOptions?.handleAccept !== undefined) {
            if (!event.inBackground) picker.hide();
            if (activeItem !== undefined) {
              runOptions.handleAccept(activeItem, event.inBackground);
            }
            return;
          }

          const item = picker.selectedItems[0] ?? activeItem;
          if (item === undefined) return;
          if (isKeyModified(picker.keyMods) && item.attach !== undefined) {
            item.attach(picker.keyMods, event);
            return;
          }
          if (!event.inBackground) picker.hide();
          item.accept?.(picker.keyMods, event);
        }),
      ),
    );

    disposables.add(
      toDisposable(
        picker.onDidTriggerItemButton(({ button, item }) => {
          void this.triggerButton(picker, token, updatePickerItems, button, item);
        }),
      ),
    );
    disposables.add(
      toDisposable(
        picker.onDidTriggerSeparatorButton(({ button, separator }) => {
          void this.triggerButton(
            picker,
            token,
            updatePickerItems,
            button,
            separator as PickerQuickAccessSeparator,
          );
        }),
      ),
    );

    return {
      dispose: () => {
        picksCancellation?.cancel();
        picksDisposables?.dispose();
        disposables.dispose();
      },
    };
  }

  private async applyProvidedPicks(
    picker: IQuickPick<T>,
    filter: string,
    providedPicks:
      | PickerQuickAccessPicks<T>
      | Promise<PickerQuickAccessPicks<T> | PickerQuickAccessFastAndSlowPicks<T>>
      | PickerQuickAccessFastAndSlowPicks<T>
      | null,
    token: CancellationToken,
  ): Promise<void> {
    if (providedPicks === null || token.isCancellationRequested) return;

    if (isFastAndSlowPicks(providedPicks)) {
      await this.applyFastAndSlowPicks(picker, filter, providedPicks, token);
      return;
    }

    if (providedPicks instanceof Promise) {
      picker.busy = true;
      try {
        const awaitedPicks = await providedPicks;
        if (token.isCancellationRequested) return;
        await this.applyProvidedPicks(picker, filter, awaitedPicks, token);
      } finally {
        if (!token.isCancellationRequested) picker.busy = false;
      }
      return;
    }

    this.applyPicks(picker, filter, providedPicks);
  }

  private async applyFastAndSlowPicks(
    picker: IQuickPick<T>,
    filter: string,
    fastAndSlowPicks: PickerQuickAccessFastAndSlowPicks<T>,
    token: CancellationToken,
  ): Promise<void> {
    let fastApplied = false;
    let slowApplied = false;

    await Promise.all([
      (async () => {
        if (typeof fastAndSlowPicks.mergeDelay === 'number') {
          await delay(fastAndSlowPicks.mergeDelay);
          if (token.isCancellationRequested) return;
        }
        if (!slowApplied) {
          fastApplied = this.applyPicks(picker, filter, fastAndSlowPicks.picks, true);
        }
      })(),
      (async () => {
        picker.busy = true;
        try {
          const additionalPicks = await fastAndSlowPicks.additionalPicks;
          if (token.isCancellationRequested) return;
          if (!fastApplied) {
            this.applyPicks(picker, filter, additionalPicks);
            return;
          }
          const fast = picksItems(fastAndSlowPicks.picks);
          const slow = picksItems(additionalPicks);
          if (slow.length > 0) {
            this.applyPicks(picker, filter, [...fast, ...slow]);
          }
        } finally {
          slowApplied = true;
          if (!token.isCancellationRequested) picker.busy = false;
        }
      })(),
    ]);
  }

  private applyPicks(
    picker: IQuickPick<T>,
    filter: string,
    picks: PickerQuickAccessPicks<T>,
    skipEmpty = false,
  ): boolean {
    const normalized = normalizePicks(picks);
    let items = normalized.items;
    const activeItem = normalized.active;

    if (items.length === 0) {
      if (skipEmpty) return false;
      const noResultsPick = this.options.noResultsPick;
      if ((filter.length > 0 || picker.hideInput) && noResultsPick !== undefined) {
        items = [typeof noResultsPick === 'function' ? noResultsPick(filter) : noResultsPick];
      }
    }

    picker.items = items;
    if (activeItem !== undefined) picker.activeItems = [activeItem];
    return true;
  }

  private async triggerButton(
    picker: IQuickPick<T>,
    token: CancellationToken,
    refresh: () => Promise<void>,
    button: IQuickInputButton,
    item: T | PickerQuickAccessSeparator,
  ): Promise<void> {
    if (item.trigger === undefined) return;
    const buttonIndex = item.buttons?.indexOf(button) ?? -1;
    if (buttonIndex < 0) return;

    const result = item.trigger(buttonIndex, picker.keyMods);
    const action = result instanceof Promise ? await result : result;
    if (token.isCancellationRequested) return;

    if (action === TriggerAction.CLOSE_PICKER) {
      picker.hide();
    } else if (action === TriggerAction.REFRESH_PICKER) {
      await refresh();
    } else if (action === TriggerAction.REMOVE_ITEM) {
      const index = picker.items.indexOf(item);
      if (index < 0) return;
      const items = [...picker.items];
      const [removed] = items.splice(index, 1);
      const keepScrollPosition = picker.keepScrollPosition;
      picker.keepScrollPosition = true;
      picker.items = items;
      picker.activeItems = picker.activeItems.filter((activeItem) => activeItem !== removed);
      picker.keepScrollPosition = keepScrollPosition;
    }
  }

  protected abstract getPicks(
    filter: string,
    disposables: PickerQuickAccessDisposableStore,
    token: CancellationToken,
    runOptions?: QuickAccessProviderRunOptions,
  ):
    | PickerQuickAccessPicks<T>
    | Promise<PickerQuickAccessPicks<T> | PickerQuickAccessFastAndSlowPicks<T>>
    | PickerQuickAccessFastAndSlowPicks<T>
    | null;
}

function normalizePicks<T extends PickerQuickAccessItem>(
  picks: PickerQuickAccessPicks<T>,
): PickerQuickAccessPicksWithActive<T> {
  return isPicksArray(picks) ? { items: picks } : picks;
}

function isPicksArray<T extends PickerQuickAccessItem>(
  picks: PickerQuickAccessPicks<T>,
): picks is readonly PickerQuickAccessPick<T>[] {
  return Array.isArray(picks);
}

function picksItems<T extends PickerQuickAccessItem>(
  picks: PickerQuickAccessPicks<T>,
): readonly PickerQuickAccessPick<T>[] {
  return normalizePicks(picks).items;
}

function isFastAndSlowPicks<T extends PickerQuickAccessItem>(
  picks: unknown,
): picks is PickerQuickAccessFastAndSlowPicks<T> {
  const candidate = picks as PickerQuickAccessFastAndSlowPicks<T>;
  return candidate.picks !== undefined && candidate.additionalPicks instanceof Promise;
}

function toDisposable(dispose: () => void): QuickAccessProviderDisposable {
  return { dispose };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

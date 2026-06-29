import {
  type IQuickPick,
  type IQuickPickDidAcceptEvent,
  type IQuickPickItem,
  type IQuickPickItemButtonEvent,
  type IQuickPickSeparatorButtonEvent,
  type IQuickPickWillAcceptEvent,
  ItemActivation,
  NO_KEY_MODS,
  QuickPickFocus,
  type QuickPickItemOrSeparator,
  isQuickPickItem,
} from './quickInput.js';

export interface HeadlessQuickPickHooks<T extends IQuickPickItem> {
  readonly onShow: (picker: HeadlessQuickPick<T>) => void;
  readonly onHide: (picker: HeadlessQuickPick<T>) => void;
}

export class HeadlessQuickPick<T extends IQuickPickItem> implements IQuickPick<T> {
  private valueValue = '';
  private itemsValue: readonly QuickPickItemOrSeparator<T>[] = [];
  private activeItemsValue: readonly T[] = [];
  private selectedItemsValue: readonly T[] = [];
  private inputFocused = false;
  private readonly changeValueListeners = new Set<(value: string) => void>();
  private readonly changeActiveListeners = new Set<(items: readonly T[]) => void>();
  private readonly changeSelectionListeners = new Set<(items: readonly T[]) => void>();
  private readonly willAcceptListeners = new Set<(event: IQuickPickWillAcceptEvent) => void>();
  private readonly acceptListeners = new Set<(event: IQuickPickDidAcceptEvent) => void>();
  private readonly customListeners = new Set<() => void>();
  private readonly triggerItemButtonListeners = new Set<
    (event: IQuickPickItemButtonEvent<T>) => void
  >();
  private readonly triggerSeparatorButtonListeners = new Set<
    (event: IQuickPickSeparatorButtonEvent) => void
  >();
  private readonly hideListeners = new Set<() => void>();
  private readonly focusListeners = new Set<() => void>();

  filterValue = (value: string): string => value;
  ariaLabel?: string;
  placeholder?: string;
  prompt?: string;
  canSelectMany = false;
  canAcceptInBackground = false;
  ok: boolean | 'default' = false;
  okLabel?: string;
  customButton = false;
  customLabel?: string;
  customHover?: string;
  customButtonSecondary?: boolean;
  matchOnDescription = false;
  matchOnDetail = false;
  matchOnLabel = true;
  matchOnLabelMode: 'fuzzy' | 'contiguous' = 'fuzzy';
  sortByLabel = true;
  keepScrollPosition = false;
  quickNavigate?: { readonly keybindings: readonly unknown[] };
  itemActivation = ItemActivation.FIRST;
  readonly keyMods = NO_KEY_MODS;
  valueSelection?: readonly [number, number];
  validationMessage?: string;
  severity: 'ignore' | 'info' | 'warning' | 'error' = 'ignore';
  busy = false;
  enabled = true;
  contextKey?: string;
  ignoreFocusOut = false;
  hideInput = false;
  hideCountBadge = false;
  hideCheckAll = false;
  visible = false;
  disposed = false;

  constructor(private readonly hooks: HeadlessQuickPickHooks<T>) {}

  get value(): string {
    return this.valueValue;
  }

  set value(value: string) {
    this.assertNotDisposed();
    if (this.valueValue === value) return;
    this.valueValue = value;
    for (const listener of this.changeValueListeners) listener(value);
  }

  get items(): readonly QuickPickItemOrSeparator<T>[] {
    return this.itemsValue;
  }

  set items(items: readonly QuickPickItemOrSeparator<T>[]) {
    this.assertNotDisposed();
    this.itemsValue = items;
    this.activeItems = keepQuickPickItems(this.activeItemsValue, items);
    this.selectedItems = keepQuickPickItems(this.selectedItemsValue, items);
  }

  get activeItems(): readonly T[] {
    return this.activeItemsValue;
  }

  set activeItems(items: readonly T[]) {
    this.assertNotDisposed();
    const nextItems = keepQuickPickItems(items, this.itemsValue);
    if (quickPickItemsEqual(this.activeItemsValue, nextItems)) return;
    this.activeItemsValue = nextItems;
    for (const listener of this.changeActiveListeners) listener(nextItems);
  }

  get selectedItems(): readonly T[] {
    return this.selectedItemsValue;
  }

  set selectedItems(items: readonly T[]) {
    this.assertNotDisposed();
    const nextItems = keepQuickPickItems(items, this.itemsValue);
    if (quickPickItemsEqual(this.selectedItemsValue, nextItems)) return;
    this.selectedItemsValue = nextItems;
    for (const listener of this.changeSelectionListeners) listener(nextItems);
  }

  show(): void {
    this.assertNotDisposed();
    if (this.visible) return;
    this.visible = true;
    this.hooks.onShow(this);
  }

  hide(): void {
    this.assertNotDisposed();
    if (!this.visible) return;
    this.visible = false;
    this.inputFocused = false;
    this.hooks.onHide(this);
    for (const listener of this.hideListeners) listener();
  }

  focus(focus?: QuickPickFocus): void {
    this.assertNotDisposed();
    if (focus !== undefined) {
      const item = focusQuickPickItem(this.itemsValue, this.activeItemsValue[0], focus);
      if (item !== undefined) this.activeItems = [item];
      return;
    }
    this.focusOnInput();
  }

  focusOnInput(): void {
    this.assertNotDisposed();
    this.inputFocused = true;
    for (const listener of this.focusListeners) listener();
  }

  inputHasFocus(): boolean {
    this.assertNotDisposed();
    return this.inputFocused;
  }

  accept(inBackground = false): void {
    this.assertNotDisposed();
    let vetoed = false;
    const willAcceptEvent: IQuickPickWillAcceptEvent = {
      veto: () => {
        vetoed = true;
      },
    };
    for (const listener of this.willAcceptListeners) listener(willAcceptEvent);
    if (vetoed) return;
    const acceptEvent: IQuickPickDidAcceptEvent = { inBackground };
    for (const listener of this.acceptListeners) listener(acceptEvent);
  }

  dispose(): void {
    if (this.disposed) return;
    const wasVisible = this.visible;
    this.disposed = true;
    this.visible = false;
    this.changeValueListeners.clear();
    this.changeActiveListeners.clear();
    this.changeSelectionListeners.clear();
    this.willAcceptListeners.clear();
    this.acceptListeners.clear();
    this.customListeners.clear();
    this.triggerItemButtonListeners.clear();
    this.triggerSeparatorButtonListeners.clear();
    if (wasVisible) {
      this.hooks.onHide(this);
      for (const listener of this.hideListeners) listener();
    }
    this.hideListeners.clear();
    this.focusListeners.clear();
  }

  onDidChangeValue(listener: (value: string) => void): () => void {
    this.assertNotDisposed();
    this.changeValueListeners.add(listener);
    return () => {
      this.changeValueListeners.delete(listener);
    };
  }

  onWillAccept(listener: (event: IQuickPickWillAcceptEvent) => void): () => void {
    this.assertNotDisposed();
    this.willAcceptListeners.add(listener);
    return () => {
      this.willAcceptListeners.delete(listener);
    };
  }

  onDidAccept(listener: (event: IQuickPickDidAcceptEvent) => void): () => void {
    this.assertNotDisposed();
    this.acceptListeners.add(listener);
    return () => {
      this.acceptListeners.delete(listener);
    };
  }

  onDidChangeActive(listener: (items: readonly T[]) => void): () => void {
    this.assertNotDisposed();
    this.changeActiveListeners.add(listener);
    return () => {
      this.changeActiveListeners.delete(listener);
    };
  }

  onDidChangeSelection(listener: (items: readonly T[]) => void): () => void {
    this.assertNotDisposed();
    this.changeSelectionListeners.add(listener);
    return () => {
      this.changeSelectionListeners.delete(listener);
    };
  }

  onDidCustom(listener: () => void): () => void {
    this.assertNotDisposed();
    this.customListeners.add(listener);
    return () => {
      this.customListeners.delete(listener);
    };
  }

  onDidTriggerItemButton(listener: (event: IQuickPickItemButtonEvent<T>) => void): () => void {
    this.assertNotDisposed();
    this.triggerItemButtonListeners.add(listener);
    return () => {
      this.triggerItemButtonListeners.delete(listener);
    };
  }

  onDidTriggerSeparatorButton(
    listener: (event: IQuickPickSeparatorButtonEvent) => void,
  ): () => void {
    this.assertNotDisposed();
    this.triggerSeparatorButtonListeners.add(listener);
    return () => {
      this.triggerSeparatorButtonListeners.delete(listener);
    };
  }

  onDidHide(listener: () => void): () => void {
    this.assertNotDisposed();
    this.hideListeners.add(listener);
    return () => {
      this.hideListeners.delete(listener);
    };
  }

  onDidFocus(listener: () => void): () => void {
    this.assertNotDisposed();
    this.focusListeners.add(listener);
    return () => {
      this.focusListeners.delete(listener);
    };
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Quick pick is disposed');
    }
  }
}

function keepQuickPickItems<T extends IQuickPickItem>(
  selectedItems: readonly T[],
  items: readonly QuickPickItemOrSeparator<T>[],
): readonly T[] {
  const itemSet = new Set<QuickPickItemOrSeparator<T>>(items);
  return selectedItems.filter((item) => itemSet.has(item));
}

function quickPickItemsEqual<T extends IQuickPickItem>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function quickPickItemAtFocus<T extends IQuickPickItem>(
  items: readonly QuickPickItemOrSeparator<T>[],
  focus: ItemActivation,
): T | undefined {
  const pickableItems = pickableQuickPickItems(items);
  if (focus === ItemActivation.NONE) return undefined;
  if (focus === ItemActivation.SECOND) return pickableItems[1] ?? pickableItems[0];
  if (focus === ItemActivation.LAST) return pickableItems[pickableItems.length - 1];
  return pickableItems[0];
}

export function pickableQuickPickItems<T extends IQuickPickItem>(
  items: readonly QuickPickItemOrSeparator<T>[],
): readonly T[] {
  return items.filter((item): item is T => isQuickPickItem(item) && item.pickable !== false);
}

function focusQuickPickItem<T extends IQuickPickItem>(
  items: readonly QuickPickItemOrSeparator<T>[],
  current: T | undefined,
  focus: QuickPickFocus,
): T | undefined {
  if (focus === QuickPickFocus.First) return quickPickItemAtFocus(items, ItemActivation.FIRST);
  if (focus === QuickPickFocus.Second) return quickPickItemAtFocus(items, ItemActivation.SECOND);
  if (focus === QuickPickFocus.Last) return quickPickItemAtFocus(items, ItemActivation.LAST);
  if (focus === QuickPickFocus.NextSeparator) return focusRelativeSeparatorItem(items, current, 1);
  if (focus === QuickPickFocus.PreviousSeparator) {
    return focusRelativeSeparatorItem(items, current, -1);
  }
  const pickableItems = pickableQuickPickItems(items);
  if (pickableItems.length === 0) return undefined;
  const currentIndex = current === undefined ? -1 : pickableItems.indexOf(current);
  if (focus === QuickPickFocus.Previous || focus === QuickPickFocus.PreviousPage) {
    return pickableItems[
      currentIndex < 0
        ? pickableItems.length - 1
        : (currentIndex - 1 + pickableItems.length) % pickableItems.length
    ];
  }
  return pickableItems[
    currentIndex < 0 ? 0 : (currentIndex + 1 + pickableItems.length) % pickableItems.length
  ];
}

function focusRelativeSeparatorItem<T extends IQuickPickItem>(
  items: readonly QuickPickItemOrSeparator<T>[],
  current: T | undefined,
  direction: 1 | -1,
): T | undefined {
  const currentIndex = current === undefined ? -1 : items.indexOf(current);
  const startIndex = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index =
      direction > 0
        ? (startIndex + offset) % items.length
        : (startIndex - offset + items.length) % items.length;
    const item = items[index];
    if (item === undefined || isQuickPickItem(item)) continue;
    const pickable = firstPickableAfterSeparator(items, index);
    if (pickable !== undefined) return pickable;
  }
  return undefined;
}

function firstPickableAfterSeparator<T extends IQuickPickItem>(
  items: readonly QuickPickItemOrSeparator<T>[],
  separatorIndex: number,
): T | undefined {
  for (let index = separatorIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) return undefined;
    if (!isQuickPickItem(item)) return undefined;
    if (item.pickable !== false) return item;
  }
  return undefined;
}

import type { CreateQuickPickOptions, IQuickPick, IQuickPickItem } from '../common/quickInput.js';

/**
 * Headless quick input controller.
 *
 * VS Code keeps quick input lifecycle state in `QuickInputController`, with
 * `QuickInputService` delegating raw picker commands to it. This controller is
 * the renderer-agnostic equivalent for our current React host.
 */
export class QuickInputController {
  private activeQuickPick: HeadlessQuickPick<IQuickPickItem> | undefined;

  createQuickPick<T extends IQuickPickItem>(_options: CreateQuickPickOptions = {}): IQuickPick<T> {
    return new HeadlessQuickPick<T>({
      onShow: (picker) => {
        this.activeQuickPick = picker as unknown as HeadlessQuickPick<IQuickPickItem>;
      },
      onHide: (picker) => {
        if (this.activeQuickPick === (picker as unknown as HeadlessQuickPick<IQuickPickItem>)) {
          this.activeQuickPick = undefined;
        }
      },
    });
  }

  focus(): void {
    this.activeQuickPick?.focus();
  }

  navigate(next: boolean): void {
    const picker = this.activeQuickPick;
    if (picker === undefined || picker.items.length === 0) return;
    const active = picker.activeItems[0];
    const currentIndex = active === undefined ? -1 : picker.items.indexOf(active);
    const nextIndex =
      currentIndex < 0
        ? next
          ? 0
          : picker.items.length - 1
        : (currentIndex + (next ? 1 : -1) + picker.items.length) % picker.items.length;
    const nextItem = picker.items[nextIndex];
    picker.activeItems = nextItem === undefined ? [] : [nextItem];
  }

  accept(): void {
    this.activeQuickPick?.accept();
  }

  cancel(): void {
    this.activeQuickPick?.hide();
  }
}

class HeadlessQuickPick<T extends IQuickPickItem> implements IQuickPick<T> {
  private valueValue = '';
  private itemsValue: readonly T[] = [];
  private activeItemsValue: readonly T[] = [];
  private selectedItemsValue: readonly T[] = [];
  private readonly changeValueListeners = new Set<(value: string) => void>();
  private readonly changeActiveListeners = new Set<(items: readonly T[]) => void>();
  private readonly changeSelectionListeners = new Set<(items: readonly T[]) => void>();
  private readonly acceptListeners = new Set<() => void>();
  private readonly hideListeners = new Set<() => void>();
  private readonly focusListeners = new Set<() => void>();

  placeholder?: string;
  canSelectMany = false;
  busy = false;
  enabled = true;
  visible = false;
  disposed = false;

  constructor(
    private readonly hooks: {
      readonly onShow: (picker: HeadlessQuickPick<T>) => void;
      readonly onHide: (picker: HeadlessQuickPick<T>) => void;
    },
  ) {}

  get value(): string {
    return this.valueValue;
  }

  set value(value: string) {
    this.assertNotDisposed();
    if (this.valueValue === value) return;
    this.valueValue = value;
    for (const listener of this.changeValueListeners) listener(value);
  }

  get items(): readonly T[] {
    return this.itemsValue;
  }

  set items(items: readonly T[]) {
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
    this.hooks.onHide(this);
    for (const listener of this.hideListeners) listener();
  }

  focus(): void {
    this.assertNotDisposed();
    for (const listener of this.focusListeners) listener();
  }

  accept(): void {
    this.assertNotDisposed();
    for (const listener of this.acceptListeners) listener();
  }

  dispose(): void {
    if (this.disposed) return;
    const wasVisible = this.visible;
    this.disposed = true;
    this.visible = false;
    this.changeValueListeners.clear();
    this.changeActiveListeners.clear();
    this.changeSelectionListeners.clear();
    this.acceptListeners.clear();
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

  onDidAccept(listener: () => void): () => void {
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
  items: readonly T[],
): readonly T[] {
  const itemSet = new Set(items);
  return selectedItems.filter((item) => itemSet.has(item));
}

function quickPickItemsEqual<T extends IQuickPickItem>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

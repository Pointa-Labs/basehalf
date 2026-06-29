import type {
  CreateQuickPickOptions,
  IQuickPick,
  IQuickPickItem,
  QuickInputHostState,
  QuickInputHostStateListener,
} from '../common/quickInput.js';
import { HeadlessQuickPick, pickableQuickPickItems } from '../common/quickInputModel.js';

/**
 * Headless quick input controller.
 *
 * VS Code keeps quick input lifecycle state in `QuickInputController`, with
 * `QuickInputService` delegating raw picker commands to it. This controller is
 * the renderer-agnostic equivalent for our current React host.
 */
export class QuickInputController {
  private activeQuickPick: HeadlessQuickPick<IQuickPickItem> | undefined;
  private hostState: QuickInputHostState = { activeQuickPick: undefined };
  private readonly hostStateListeners = new Set<QuickInputHostStateListener>();

  getHostState(): QuickInputHostState {
    return this.hostState;
  }

  subscribe(listener: QuickInputHostStateListener): () => void {
    this.hostStateListeners.add(listener);
    return () => {
      this.hostStateListeners.delete(listener);
    };
  }

  createQuickPick<T extends IQuickPickItem>(_options: CreateQuickPickOptions = {}): IQuickPick<T> {
    const renderInHost = _options.renderInHost === true;
    return new HeadlessQuickPick<T>({
      onShow: (picker) => {
        this.activeQuickPick = picker as unknown as HeadlessQuickPick<IQuickPickItem>;
        if (renderInHost) {
          this.setActiveHostQuickPick(picker as unknown as IQuickPick<IQuickPickItem>);
        }
      },
      onHide: (picker) => {
        if (this.activeQuickPick === (picker as unknown as HeadlessQuickPick<IQuickPickItem>)) {
          this.activeQuickPick = undefined;
        }
        if (renderInHost && this.hostState.activeQuickPick === picker) {
          this.setActiveHostQuickPick(undefined);
        }
      },
    });
  }

  focus(): void {
    this.activeQuickPick?.focus();
  }

  navigate(next: boolean): void {
    const picker = this.activeQuickPick;
    if (picker === undefined) return;
    const items = pickableQuickPickItems(picker.items);
    if (items.length === 0) return;
    const active = picker.activeItems[0];
    const currentIndex = active === undefined ? -1 : items.indexOf(active);
    const nextIndex =
      currentIndex < 0
        ? next
          ? 0
          : items.length - 1
        : (currentIndex + (next ? 1 : -1) + items.length) % items.length;
    const nextItem = items[nextIndex];
    picker.activeItems = nextItem === undefined ? [] : [nextItem];
  }

  accept(): void {
    this.activeQuickPick?.accept();
  }

  cancel(): void {
    this.activeQuickPick?.hide();
  }

  private setActiveHostQuickPick(picker: IQuickPick<IQuickPickItem> | undefined): void {
    if (this.hostState.activeQuickPick === picker) return;
    this.hostState = { activeQuickPick: picker };
    for (const listener of this.hostStateListeners) listener();
  }
}

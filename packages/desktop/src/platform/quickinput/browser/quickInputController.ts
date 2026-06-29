import type { CreateQuickPickOptions, IQuickPick, IQuickPickItem } from '../common/quickInput.js';
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
}

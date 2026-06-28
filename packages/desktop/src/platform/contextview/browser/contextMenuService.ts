import { nativeHostService } from '../../native/browser/nativeHostService.js';
import {
  type ContextMenuItem,
  cleanContextMenuItems,
  hasContextMenuActions,
} from '../common/contextMenu.js';
import { useContextMenuStore } from './contextMenuStore.js';
import type {
  ContextMenuCloseOptions,
  ContextMenuDelegate,
  IContextMenuService,
} from './contextView.js';

export type {
  ContextMenuAnchor,
  ContextMenuCloseOptions,
  ContextMenuDelegate,
  IContextMenuService,
} from './contextView.js';
export { useContextMenuStore } from './contextMenuStore.js';

class BrowserContextMenuService implements IContextMenuService {
  showContextMenu(delegate: ContextMenuDelegate): void {
    const items = cleanContextMenuItems(delegate.getActions());
    if (!hasContextMenuActions(items)) return;

    if (typeof window !== 'undefined') nativeHostService.suppressNextNativeContextMenu();

    const anchor = delegate.getAnchor();
    useContextMenuStore.getState().show({
      x: anchor.x,
      y: anchor.y,
      items,
      returnFocusElement: delegate.getReturnFocusElement?.() ?? activeHTMLElement(),
      onHide: delegate.onHide ?? null,
    });
  }

  closeContextMenu(options?: ContextMenuCloseOptions): void {
    const closed = useContextMenuStore.getState().close();
    if (closed === null) return;

    closed.onHide?.(options?.didCancel ?? true);
    if (options?.restoreFocus === true) focusElementSafely(closed.returnFocusElement);
  }
}

export const contextMenuService: IContextMenuService = new BrowserContextMenuService();

export function openContextMenu(
  x: number,
  y: number,
  items: readonly ContextMenuItem[],
  returnFocusElement?: HTMLElement | null,
): void {
  contextMenuService.showContextMenu({
    getAnchor: () => ({ x, y }),
    getActions: () => items,
    getReturnFocusElement: () => returnFocusElement ?? activeHTMLElement(),
  });
}

function activeHTMLElement(): HTMLElement | null {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

function focusElementSafely(element: HTMLElement | null | undefined): void {
  if (typeof HTMLElement === 'undefined') return;
  if (!(element instanceof HTMLElement) || !element.isConnected) return;
  element.focus({ preventScroll: true });
}

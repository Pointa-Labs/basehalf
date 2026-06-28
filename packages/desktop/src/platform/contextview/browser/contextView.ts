import type { ContextMenuItem } from '../common/contextMenu.js';

export interface ContextMenuAnchor {
  readonly x: number;
  readonly y: number;
}

export type ContextMenuHideHandler = (didCancel: boolean) => void;

export interface ContextMenuDelegate {
  getAnchor(): ContextMenuAnchor;
  getActions(): readonly ContextMenuItem[];
  getReturnFocusElement?(): HTMLElement | null;
  onHide?: ContextMenuHideHandler;
}

export interface ContextMenuCloseOptions {
  readonly didCancel?: boolean;
  readonly restoreFocus?: boolean;
}

export interface IContextMenuService {
  showContextMenu(delegate: ContextMenuDelegate): void;
  closeContextMenu(options?: ContextMenuCloseOptions): void;
}

import { create } from 'zustand';
import type { ContextMenuItem } from '../common/contextMenu.js';
import type { ContextMenuHideHandler } from './contextView.js';

export interface ContextMenuState {
  readonly open: boolean;
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly returnFocusElement: HTMLElement | null;
  readonly onHide: ContextMenuHideHandler | null;
}

export interface OpenContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly returnFocusElement: HTMLElement | null;
  readonly onHide: ContextMenuHideHandler | null;
}

export interface ClosedContextMenuState {
  readonly returnFocusElement: HTMLElement | null;
  readonly onHide: ContextMenuHideHandler | null;
}

export interface ContextMenuStore extends ContextMenuState {
  readonly show: (state: OpenContextMenuState) => void;
  readonly close: () => ClosedContextMenuState | null;
}

export const useContextMenuStore = create<ContextMenuStore>((set, get) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  returnFocusElement: null,
  onHide: null,
  show: (state) =>
    set({
      open: true,
      x: state.x,
      y: state.y,
      items: state.items,
      returnFocusElement: state.returnFocusElement,
      onHide: state.onHide,
    }),
  close: () => {
    const current = get();
    if (!current.open) return null;
    set({ open: false, items: [], returnFocusElement: null, onHide: null });
    return {
      returnFocusElement: current.returnFocusElement,
      onHide: current.onHide,
    };
  },
}));

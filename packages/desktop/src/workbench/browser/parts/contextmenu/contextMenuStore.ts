/**
 * Global context-menu store — the engine behind every right-click menu.
 *
 * Mirrors the Dialog store (workbench/browser/parts/dialogs): state lives in Zustand so
 * any surface (sidebar, canvas, cards, terminal) can pop a menu from its
 * `onContextMenu` handler without prop-drilling, and a single <ContextMenuHost/>
 * at the Workbench root renders it. Point-anchored (cursor x/y), not element-anchored
 * like usePopover — a right-click has no trigger button to measure against.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { activeHTMLElement } from '../../ui/focus.js';

/** A clickable row. `run` fires on click (the host closes the menu first). */
export interface ContextMenuAction {
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
  /** Destructive actions (Delete) render in the danger tone. */
  readonly danger?: boolean;
  /** Shown greyed + non-interactive (e.g. Paste with an empty clipboard). */
  readonly disabled?: boolean;
  /** Optional leading glyph; most items are label-only for now. */
  readonly icon?: ReactNode;
}

/** A 1px divider between groups of actions. */
export interface ContextMenuSeparator {
  readonly separator: true;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

export function isSeparator(item: ContextMenuItem): item is ContextMenuSeparator {
  return 'separator' in item;
}

interface ContextMenuStore {
  readonly open: boolean;
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly returnFocusElement: HTMLElement | null;
  /** Open at a cursor point. No-op (stays closed) if there are no actions —
   *  an empty menu should never flash. Leading/trailing/duplicate separators
   *  are trimmed so callers can compose item lists freely. */
  show: (
    x: number,
    y: number,
    items: readonly ContextMenuItem[],
    returnFocusElement?: HTMLElement | null,
  ) => void;
  close: () => void;
}

/** Drop leading/trailing separators and collapse consecutive ones, so building
 *  a menu by concatenating optional groups never produces dangling dividers. */
function cleanSeparators(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const item of items) {
    if (isSeparator(item)) {
      if (out.length === 0 || isSeparator(out[out.length - 1] as ContextMenuItem)) continue;
    }
    out.push(item);
  }
  while (out.length > 0 && isSeparator(out[out.length - 1] as ContextMenuItem)) out.pop();
  return out;
}

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  returnFocusElement: null,
  show: (x, y, items, returnFocusElement) => {
    const cleaned = cleanSeparators(items);
    if (cleaned.every(isSeparator)) return; // nothing actionable
    // Claim the native context menu for THIS gesture so the two never stack
    // (chiefly over the terminal, which Electron can report as editable). Guarded
    // for the node test env where there's no window/bridge.
    if (typeof window !== 'undefined') nativeHostService.suppressNextNativeContextMenu();
    set({
      open: true,
      x,
      y,
      items: cleaned,
      returnFocusElement: returnFocusElement ?? activeHTMLElement(),
    });
  },
  close: () => set({ open: false, items: [], returnFocusElement: null }),
}));

/** Imperative open — call straight from an `onContextMenu` handler:
 *  `openContextMenu(e.clientX, e.clientY, items)`. */
export function openContextMenu(
  x: number,
  y: number,
  items: readonly ContextMenuItem[],
  returnFocusElement?: HTMLElement | null,
): void {
  useContextMenuStore.getState().show(x, y, items, returnFocusElement);
}

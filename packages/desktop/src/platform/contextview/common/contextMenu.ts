export interface ContextMenuAction {
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly icon?: unknown;
}

export interface ContextMenuSeparator {
  readonly separator: true;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

export function isContextMenuSeparator(item: ContextMenuItem): item is ContextMenuSeparator {
  return 'separator' in item;
}

export function cleanContextMenuItems(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const item of items) {
    if (isContextMenuSeparator(item)) {
      const previous = out[out.length - 1];
      if (previous === undefined || isContextMenuSeparator(previous)) continue;
    }
    out.push(item);
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last === undefined || !isContextMenuSeparator(last)) break;
    out.pop();
  }
  return out;
}

export function hasContextMenuActions(items: readonly ContextMenuItem[]): boolean {
  return items.some((item) => !isContextMenuSeparator(item));
}

/**
 * Shared file context menu — the five basic ops (New File, New Folder, Rename,
 * Delete file, Delete folder), contextualized per surface.
 *
 * This is the "global menu + per-surface strategy" core: the sidebar tree and
 * the canvas (cards + background) all build their menu from HERE, passing a
 * small context (what was right-clicked, and where new items should land). Each
 * surface adds its own extras on top (the canvas none yet; the terminal has a
 * separate builder). The actions themselves go through the workspace store —
 * one door, with dialogs/inline-edit wired in.
 *
 * New/Rename use the create-then-inline-rename flow (VS Code-style): the entry
 * appears and immediately enters inline edit via `renamingPath`, so naming a
 * new file and renaming an existing one share ONE affordance.
 */

import { confirm } from '../../components/Dialog.js';
import type { ContextMenuItem } from '../../store/contextMenu.js';
import { useWorkspaceStore } from '../../store/workspace.js';

export interface EntryTarget {
  /** Workspace-relative POSIX path of the right-clicked file/folder. */
  readonly path: string;
  readonly kind: 'file' | 'folder';
}

export interface FileMenuContext {
  /** The right-clicked entry, or undefined for empty/background space. */
  readonly target?: EntryTarget;
  /** Where "New File"/"New Folder" land (workspace-relative; null = root). For a
   *  folder target this is the folder; for a file target, its parent; for
   *  background, the surface's current scope. */
  readonly newItemDir: string | null;
  /** Open a file / enter a folder. Omit to hide the "Open" item. */
  readonly onOpen?: (target: EntryTarget) => void;
  /** Whether to offer New File / New Folder (default true). The canvas CARD
   *  menus pass false: a card can target a folder NOT shown at the current scope,
   *  so the just-created entry would never render to be inline-named (a dead-end).
   *  On the canvas, New lives on the pane background (current scope) instead. */
  readonly includeCreate?: boolean;
}

const basenameOf = (rel: string): string => {
  const i = rel.lastIndexOf('/');
  return i === -1 ? rel : rel.slice(i + 1);
};

const DEFAULT_FILE = 'untitled.md';
const DEFAULT_FOLDER = 'untitled folder';

/** Create a new file/folder under `dir` (null = root) and drop into inline-rename.
 *  Shared by the context menus and the Explorer header's New File/Folder buttons. */
export async function createAndRename(kind: 'file' | 'folder', dir: string | null): Promise<void> {
  const base = kind === 'file' ? DEFAULT_FILE : DEFAULT_FOLDER;
  const rel = dir === null || dir === '' ? base : `${dir}/${base}`;
  const store = useWorkspaceStore.getState();
  const landed = kind === 'file' ? await store.createFile(rel) : await store.createFolder(rel);
  // Drop straight into inline-rename on the new entry: the new row/card surfaces
  // via the watcher, and beginRename arms its inline input so the user names it
  // in place instead of living with "untitled".
  if (landed !== null) store.beginRename(landed);
}

async function confirmAndDelete(target: EntryTarget): Promise<void> {
  const name = basenameOf(target.path);
  const ok = await confirm({
    title: `Delete "${name}"?`,
    body:
      target.kind === 'folder'
        ? 'The folder and everything in it moves to the Trash — you can restore it from there.'
        : 'The file moves to the Trash — you can restore it from there.',
    confirmText: 'Move to Trash',
    destructive: true,
  });
  if (ok) await useWorkspaceStore.getState().deleteEntry(target.path, target.kind);
}

/** Build the shared file menu from three groups — Open / Create / Edit — joined
 *  by a single separator between any two NON-EMPTY groups (so no leading, trailing,
 *  or doubled dividers regardless of which groups apply). New File/Folder always
 *  show unless suppressed; Open / Rename / Delete need a right-clicked entry. */
export function buildFileMenu(ctx: FileMenuContext): ContextMenuItem[] {
  const { target } = ctx;

  const openGroup: ContextMenuItem[] =
    target && ctx.onOpen
      ? [
          {
            id: 'open',
            label: target.kind === 'folder' ? 'Open Folder' : 'Open',
            run: () => ctx.onOpen?.(target),
          },
        ]
      : [];

  const createGroup: ContextMenuItem[] =
    ctx.includeCreate !== false
      ? [
          {
            id: 'new-file',
            label: 'New File',
            run: () => void createAndRename('file', ctx.newItemDir),
          },
          {
            id: 'new-folder',
            label: 'New Folder',
            run: () => void createAndRename('folder', ctx.newItemDir),
          },
        ]
      : [];

  const editGroup: ContextMenuItem[] = target
    ? [
        {
          id: 'rename',
          label: 'Rename',
          run: () => useWorkspaceStore.getState().beginRename(target.path),
        },
        { id: 'delete', label: 'Delete', danger: true, run: () => void confirmAndDelete(target) },
      ]
    : [];

  const items: ContextMenuItem[] = [];
  for (const group of [openGroup, createGroup, editGroup]) {
    if (group.length === 0) continue;
    if (items.length > 0) items.push({ separator: true });
    items.push(...group);
  }
  return items;
}

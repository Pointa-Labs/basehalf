import type { WorkspaceListFilesEntry } from '../../../../platform/workspaces/common/workspaces.js';

// SR-v0 §4.5 default blacklist for the NavTree. Hide tooling cruft +
// our own .bh/ control dir. Plain dotfiles (.env, .gitignore) stay visible.
const HIDDEN_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.bh',
  '.DS_Store',
  '.idea',
  '.vscode',
  '.turbo',
  '.next',
  '.svelte-kit',
  'node_modules',
  'dist',
  'build',
  'out',
  '__pycache__',
]);

export const ROW_HEIGHT = 22; // matches the editor's compact tree-row height

export const isVisibleNavEntry = (entry: WorkspaceListFilesEntry): boolean =>
  !HIDDEN_NAMES.has(entry.name);

// Same ordering workspace.listFiles returns (dirs first, then name), so an
// optimistic rename re-sorts the row to the position the watcher reload will
// place it — no jump when the reload lands.
export const sortNavEntries = (
  entries: readonly WorkspaceListFilesEntry[],
): WorkspaceListFilesEntry[] =>
  [...entries].sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
  );

export const joinNavPath = (parent: string, name: string): string =>
  parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`;

export const relativeToNavRoot = (root: string, abs: string): string => {
  const trimmedRoot = root.endsWith('/') ? root : `${root}/`;
  return abs.startsWith(trimmedRoot) ? abs.slice(trimmedRoot.length) : abs;
};

/** Root-level agent-protocol pointer files (setup installs them). The sidebar
 *  is the truthful filesystem view, so they stay visible — but dimmed and
 *  labeled, so a user understands what they are at a glance. */
export const isAgentHintFile = (depth: number, entry: WorkspaceListFilesEntry): boolean =>
  depth === 0 &&
  entry.type === 'file' &&
  (entry.name === 'CLAUDE.md' || entry.name === 'AGENTS.md');

export const parentRelPath = (rel: string): string => {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
};

export const parentAbsPath = (rootPath: string, rel: string): string => {
  const parentRel = parentRelPath(rel);
  return parentRel === '' ? rootPath : joinNavPath(rootPath, parentRel);
};

export const renameTargetForBasename = (rel: string, name: string): string | null => {
  const trimmed = name.trim();
  // Basename-only: a typed path separator (or '.'/'..') would silently move the
  // entry into another folder rather than retitle it in place — reject it.
  if (
    trimmed.length === 0 ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed === '.' ||
    trimmed === '..'
  )
    return null;
  const dir = parentRelPath(rel);
  return dir === '' ? trimmed : `${dir}/${trimmed}`;
};

export const newItemDirForEntry = ({
  rel,
  parentRel,
  isDir,
}: {
  rel: string;
  parentRel: string;
  isDir: boolean;
}): string | null => (isDir ? rel : parentRel === '' ? null : parentRel);

export interface VisibleNavTreeItem {
  readonly rel: string;
  readonly kind: 'file' | 'folder';
  readonly depth: number;
  readonly isExpanded: boolean;
}

export type NavTreeKeyboardIntent =
  | { readonly type: 'none' }
  | { readonly type: 'focus'; readonly rel: string }
  | { readonly type: 'open' }
  | { readonly type: 'expand' }
  | { readonly type: 'collapse' }
  | { readonly type: 'rename' }
  | { readonly type: 'delete' }
  | { readonly type: 'contextMenu' };

export interface NavTreeKeyStroke {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly isMac?: boolean;
}

const parentItem = (
  items: readonly VisibleNavTreeItem[],
  index: number,
): VisibleNavTreeItem | null => {
  const current = items[index];
  if (!current || current.depth === 0) return null;
  for (let i = index - 1; i >= 0; i--) {
    if ((items[i] as VisibleNavTreeItem).depth < current.depth) {
      return items[i] as VisibleNavTreeItem;
    }
  }
  return null;
};

/** VS Code-style tree keyboard policy for the file explorer. React owns the DOM
 * focus mechanics; this pure helper owns the key-to-intent decisions. */
export function navTreeKeyboardIntent(
  items: readonly VisibleNavTreeItem[],
  focusedRel: string | null,
  keyStroke: NavTreeKeyStroke,
): NavTreeKeyboardIntent {
  if (items.length === 0) return { type: 'none' };
  const first = items[0];
  if (first === undefined) return { type: 'none' };
  const focusedIndex = Math.max(
    0,
    focusedRel === null ? 0 : items.findIndex((item) => item.rel === focusedRel),
  );
  const current = items[focusedIndex] ?? first;

  switch (keyStroke.key) {
    case 'ArrowDown': {
      const next = items[Math.min(items.length - 1, focusedIndex + 1)];
      return next && next.rel !== current.rel ? { type: 'focus', rel: next.rel } : { type: 'none' };
    }
    case 'ArrowUp': {
      const prev = items[Math.max(0, focusedIndex - 1)];
      return prev && prev.rel !== current.rel ? { type: 'focus', rel: prev.rel } : { type: 'none' };
    }
    case 'Home':
      return first.rel === current.rel ? { type: 'none' } : { type: 'focus', rel: first.rel };
    case 'End': {
      const last = items[items.length - 1] as VisibleNavTreeItem;
      return last.rel === current.rel ? { type: 'none' } : { type: 'focus', rel: last.rel };
    }
    case 'ArrowRight':
      if (current.kind !== 'folder') return { type: 'none' };
      if (!current.isExpanded) return { type: 'expand' };
      {
        const next = items[focusedIndex + 1];
        if (next !== undefined && next.depth > current.depth) {
          return { type: 'focus', rel: next.rel };
        }
      }
      return { type: 'none' };
    case 'ArrowLeft':
      if (current.kind === 'folder' && current.isExpanded) return { type: 'collapse' };
      {
        const parent = parentItem(items, focusedIndex);
        return parent ? { type: 'focus', rel: parent.rel } : { type: 'none' };
      }
    case 'Enter':
      return keyStroke.isMac ? { type: 'rename' } : { type: 'open' };
    case ' ':
    case 'Spacebar':
      return { type: 'open' };
    case 'F2':
      return { type: 'rename' };
    case 'Delete':
      return { type: 'delete' };
    case 'Backspace':
      return keyStroke.metaKey || keyStroke.ctrlKey ? { type: 'delete' } : { type: 'none' };
    case 'ContextMenu':
      return { type: 'contextMenu' };
    case 'F10':
      return keyStroke.shiftKey ? { type: 'contextMenu' } : { type: 'none' };
    default:
      return { type: 'none' };
  }
}

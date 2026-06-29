import type { WorkspaceListFilesEntry } from '../../../services/workspace/common/workspaceTypes.js';

// SR-v0 §4.5 default blacklist for the Explorer/NavTree. Hide tooling cruft +
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

export interface ExplorerTreeRow extends VisibleNavTreeItem {
  readonly entry: WorkspaceListFilesEntry;
  readonly absPath: string;
  readonly parentRel: string;
  readonly isSelected: boolean;
}

export function buildVisibleNavRows({
  childrenByPath,
  expanded,
  rootPath,
  currentPath,
  parentPath = rootPath,
  depth = 0,
}: {
  readonly childrenByPath: ReadonlyMap<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly rootPath: string;
  readonly currentPath: string | null;
  readonly parentPath?: string;
  readonly depth?: number;
}): ExplorerTreeRow[] {
  const entries = childrenByPath.get(parentPath);
  if (!entries) return [];
  return entries.filter(isVisibleNavEntry).flatMap((entry): ExplorerTreeRow[] => {
    const absPath = joinNavPath(parentPath, entry.name);
    const isExpanded = expanded.has(absPath);
    const isDir = entry.type === 'dir';
    const rel = relativeToNavRoot(rootPath, absPath);
    const parentRel = relativeToNavRoot(rootPath, parentPath);
    const row: ExplorerTreeRow = {
      entry,
      absPath,
      rel,
      parentRel,
      depth,
      kind: isDir ? 'folder' : 'file',
      isExpanded,
      isSelected: !isDir && currentPath === rel,
    };
    return isDir && isExpanded
      ? [
          row,
          ...buildVisibleNavRows({
            childrenByPath,
            expanded,
            rootPath,
            currentPath,
            parentPath: absPath,
            depth: depth + 1,
          }),
        ]
      : [row];
  });
}

export function removeNavEntryOptimistically({
  childrenByPath,
  expanded,
  rootPath,
  rel,
}: {
  readonly childrenByPath: ReadonlyMap<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly rootPath: string;
  readonly rel: string;
}): {
  readonly childrenByPath: Map<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: Set<string>;
} {
  const slash = rel.lastIndexOf('/');
  const name = slash === -1 ? rel : rel.slice(slash + 1);
  const parentAbs = parentAbsPath(rootPath, rel);
  const removedAbs = joinNavPath(rootPath, rel);
  const nextChildren = new Map(childrenByPath);
  const entries = nextChildren.get(parentAbs);
  if (entries) {
    nextChildren.set(
      parentAbs,
      entries.filter((entry) => entry.name !== name),
    );
  }
  for (const key of [...nextChildren.keys()]) {
    if (key === removedAbs || key.startsWith(`${removedAbs}/`)) nextChildren.delete(key);
  }
  const nextExpanded = new Set<string>();
  for (const path of expanded) {
    if (path === removedAbs || path.startsWith(`${removedAbs}/`)) continue;
    nextExpanded.add(path);
  }
  return { childrenByPath: nextChildren, expanded: nextExpanded };
}

const entryTypeForKind = (kind: 'file' | 'folder'): WorkspaceListFilesEntry['type'] =>
  kind === 'folder' ? 'dir' : 'file';

export function addNavEntryOptimistically({
  childrenByPath,
  expanded,
  rootPath,
  rel,
  kind,
}: {
  readonly childrenByPath: ReadonlyMap<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly rootPath: string;
  readonly rel: string;
  readonly kind: 'file' | 'folder';
}): {
  readonly childrenByPath: Map<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: Set<string>;
} {
  const slash = rel.lastIndexOf('/');
  const name = slash === -1 ? rel : rel.slice(slash + 1);
  const parentAbs = parentAbsPath(rootPath, rel);
  const nextChildren = new Map(childrenByPath);
  const entries = nextChildren.get(parentAbs);
  if (entries) {
    nextChildren.set(
      parentAbs,
      sortNavEntries([
        ...entries.filter((entry) => entry.name !== name),
        { name, type: entryTypeForKind(kind) },
      ]),
    );
  }
  return { childrenByPath: nextChildren, expanded: new Set(expanded) };
}

export function renameNavEntryOptimistically({
  childrenByPath,
  expanded,
  rootPath,
  from,
  to,
}: {
  readonly childrenByPath: ReadonlyMap<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly rootPath: string;
  readonly from: string;
  readonly to: string;
}): {
  readonly childrenByPath: Map<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: Set<string>;
} {
  const fromSlash = from.lastIndexOf('/');
  const oldName = fromSlash === -1 ? from : from.slice(fromSlash + 1);
  const toSlash = to.lastIndexOf('/');
  const newName = toSlash === -1 ? to : to.slice(toSlash + 1);
  const parentAbs = parentAbsPath(rootPath, from);
  const fromAbs = joinNavPath(rootPath, from);
  const toAbs = joinNavPath(rootPath, to);
  const nextChildren = new Map(childrenByPath);
  const entries = nextChildren.get(parentAbs);
  if (entries) {
    nextChildren.set(
      parentAbs,
      sortNavEntries(
        entries.map((entry) => (entry.name === oldName ? { ...entry, name: newName } : entry)),
      ),
    );
  }
  for (const [key, val] of [...nextChildren]) {
    if (key === fromAbs || key.startsWith(`${fromAbs}/`)) {
      nextChildren.delete(key);
      nextChildren.set(`${toAbs}${key.slice(fromAbs.length)}`, val);
    }
  }
  const nextExpanded = new Set<string>();
  for (const path of expanded) {
    nextExpanded.add(
      path === fromAbs || path.startsWith(`${fromAbs}/`)
        ? `${toAbs}${path.slice(fromAbs.length)}`
        : path,
    );
  }
  return { childrenByPath: nextChildren, expanded: nextExpanded };
}

export function moveNavEntryOptimistically({
  childrenByPath,
  expanded,
  rootPath,
  from,
  to,
  kind,
}: {
  readonly childrenByPath: ReadonlyMap<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly rootPath: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'file' | 'folder';
}): {
  readonly childrenByPath: Map<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: Set<string>;
} {
  if (parentRelPath(from) === parentRelPath(to)) {
    return renameNavEntryOptimistically({ childrenByPath, expanded, rootPath, from, to });
  }

  const fromSlash = from.lastIndexOf('/');
  const oldName = fromSlash === -1 ? from : from.slice(fromSlash + 1);
  const toSlash = to.lastIndexOf('/');
  const newName = toSlash === -1 ? to : to.slice(toSlash + 1);
  const fromParentAbs = parentAbsPath(rootPath, from);
  const toParentAbs = parentAbsPath(rootPath, to);
  const fromAbs = joinNavPath(rootPath, from);
  const toAbs = joinNavPath(rootPath, to);
  const nextChildren = new Map(childrenByPath);
  const fromEntries = nextChildren.get(fromParentAbs);
  const movedEntry =
    fromEntries?.find((entry) => entry.name === oldName) ??
    ({
      name: oldName,
      type: entryTypeForKind(kind),
    } satisfies WorkspaceListFilesEntry);

  if (fromEntries) {
    nextChildren.set(
      fromParentAbs,
      fromEntries.filter((entry) => entry.name !== oldName),
    );
  }

  const toEntries = nextChildren.get(toParentAbs);
  if (toEntries) {
    nextChildren.set(
      toParentAbs,
      sortNavEntries([
        ...toEntries.filter((entry) => entry.name !== newName),
        { ...movedEntry, name: newName },
      ]),
    );
  }

  for (const [key, val] of [...nextChildren]) {
    if (key === fromAbs || key.startsWith(`${fromAbs}/`)) {
      nextChildren.delete(key);
      nextChildren.set(`${toAbs}${key.slice(fromAbs.length)}`, val);
    }
  }

  const nextExpanded = new Set<string>();
  for (const path of expanded) {
    nextExpanded.add(
      path === fromAbs || path.startsWith(`${fromAbs}/`)
        ? `${toAbs}${path.slice(fromAbs.length)}`
        : path,
    );
  }
  return { childrenByPath: nextChildren, expanded: nextExpanded };
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

  if (keyStroke.isMac && keyStroke.metaKey && keyStroke.key === 'ArrowDown') {
    return { type: 'open' };
  }

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

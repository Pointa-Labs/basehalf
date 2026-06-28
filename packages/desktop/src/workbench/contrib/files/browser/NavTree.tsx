import {
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type { WorkspaceListFilesEntry } from '../../../../platform/workspaces/common/workspaces.js';
import { openContextMenu } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import { color, font, space } from '../../../browser/style/design.js';
import {
  subscribeEntryRemoved,
  subscribeEntryRenamed,
} from '../../../services/workspace/browser/workspaceFileEvents.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { ExplorerHeader } from './ExplorerHeader.js';
import { NavTreeRow } from './NavTreeRow.js';
import { buildFileMenu, confirmAndDelete, createAndRename } from './fileMenu.js';
import {
  ROW_HEIGHT,
  type VisibleNavTreeItem,
  isVisibleNavEntry,
  joinNavPath,
  navTreeKeyboardIntent,
  newItemDirForEntry,
  parentAbsPath,
  relativeToNavRoot,
  renameTargetForBasename,
  sortNavEntries,
} from './navTreeModel.js';

interface NavTreeProps {
  rootPath: string;
}

const isMac = nativeHostService.platform === 'darwin';

interface RenderNavRow extends VisibleNavTreeItem {
  readonly entry: WorkspaceListFilesEntry;
  readonly absPath: string;
  readonly parentRel: string;
  readonly isSelected: boolean;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
};

export const NavTree = ({ rootPath }: NavTreeProps): JSX.Element => {
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const workspaceName = useWorkspaceStore((s) => s.current);
  const currentFile = useWorkspaceStore((s) => s.currentFile);
  const renamingPath = useWorkspaceStore((s) => s.renamingPath);
  const endRename = useWorkspaceStore((s) => s.endRename);
  const renameEntry = useWorkspaceStore((s) => s.renameEntry);
  const currentPath = currentFile;
  const [childrenByPath, setChildrenByPath] = useState<
    Map<string, readonly WorkspaceListFilesEntry[]>
  >(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusedRel, setFocusedRel] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const childrenByPathRef = useRef(childrenByPath);
  const lastCurrentPathRef = useRef(currentPath);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  childrenByPathRef.current = childrenByPath;

  const loadChildren = useCallback(async (path: string): Promise<void> => {
    try {
      const result = await workspaceService.listFiles(path);
      setChildrenByPath((prev) => {
        const next = new Map(prev);
        next.set(path, result.entries);
        return next;
      });
      // A successful load clears any stale error from a prior failure, so an
      // old message can't linger across a recovered/refreshed tree.
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    setChildrenByPath(new Map());
    setExpanded(new Set());
    setFocusedRel(null);
    setError('');
    void loadChildren(rootPath);
  }, [rootPath, loadChildren]);

  // Subscribe to watcher events so files created/deleted externally show
  // up without a window reload. Only re-fetch parent directories we've
  // already loaded — unexpanded ones load lazily on click anyway.
  useEffect(() => {
    const refreshParentOf = (rel: string): void => {
      if (rel === '.bh' || rel.startsWith('.bh/')) return;
      const parentAbs = parentAbsPath(rootPath, rel);
      if (childrenByPathRef.current.has(parentAbs)) {
        void loadChildren(parentAbs);
      }
    };
    const unsub = fileEventService.onDidChangeFiles((event) => {
      if (event.type === 'rename') {
        // Refresh both ends — for same-dir renames this is the same dir
        // twice (cheap), for cross-dir moves it correctly refreshes both.
        refreshParentOf(event.fromRelPath);
        refreshParentOf(event.toRelPath);
        return;
      }
      refreshParentOf(event.relPath);
    });
    return unsub;
  }, [rootPath, loadChildren]);

  // Optimistic delete: drop the row immediately when an in-app delete succeeds,
  // instead of waiting for the watcher's unlink event to re-list the parent.
  useEffect(() => {
    return subscribeEntryRemoved((rel) => {
      const slash = rel.lastIndexOf('/');
      const name = slash === -1 ? rel : rel.slice(slash + 1);
      const parentAbs = parentAbsPath(rootPath, rel);
      const removedAbs = joinNavPath(rootPath, rel);
      setChildrenByPath((prev) => {
        const entries = prev.get(parentAbs);
        const next = new Map(prev);
        if (entries)
          next.set(
            parentAbs,
            entries.filter((e) => e.name !== name),
          );
        // Drop cached listings for a removed folder + its descendants.
        for (const key of [...next.keys()]) {
          if (key === removedAbs || key.startsWith(`${removedAbs}/`)) next.delete(key);
        }
        return next;
      });
      setExpanded((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          if (p === removedAbs || p.startsWith(`${removedAbs}/`)) continue;
          next.add(p);
        }
        return next.size === prev.size ? prev : next;
      });
    });
  }, [rootPath]);

  // Optimistic rename: rename the row in place (and remap any expanded/cached
  // descendants for a folder) the instant the rename succeeds, instead of waiting
  // for the watcher's rename event to re-list the parent.
  useEffect(() => {
    return subscribeEntryRenamed((from, to) => {
      const fromSlash = from.lastIndexOf('/');
      const oldName = fromSlash === -1 ? from : from.slice(fromSlash + 1);
      const toSlash = to.lastIndexOf('/');
      const newName = toSlash === -1 ? to : to.slice(toSlash + 1);
      const parentAbs = parentAbsPath(rootPath, from);
      const fromAbs = joinNavPath(rootPath, from);
      const toAbs = joinNavPath(rootPath, to);
      setChildrenByPath((prev) => {
        const next = new Map(prev);
        const entries = next.get(parentAbs);
        if (entries) {
          next.set(
            parentAbs,
            sortNavEntries(entries.map((e) => (e.name === oldName ? { ...e, name: newName } : e))),
          );
        }
        // Remap cached listings under a renamed FOLDER (fromAbs/* → toAbs/*).
        for (const [key, val] of [...next]) {
          if (key === fromAbs || key.startsWith(`${fromAbs}/`)) {
            next.delete(key);
            next.set(`${toAbs}${key.slice(fromAbs.length)}`, val);
          }
        }
        return next;
      });
      setExpanded((prev) => {
        let changed = false;
        const next = new Set<string>();
        for (const p of prev) {
          if (p === fromAbs || p.startsWith(`${fromAbs}/`)) {
            next.add(`${toAbs}${p.slice(fromAbs.length)}`);
            changed = true;
          } else {
            next.add(p);
          }
        }
        return changed ? next : prev;
      });
    });
  }, [rootPath]);

  const expandFolder = useCallback(
    (path: string): void => {
      setExpanded((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      if (!childrenByPathRef.current.has(path)) void loadChildren(path);
    },
    [loadChildren],
  );

  const collapseFolder = (path: string): void => {
    setExpanded((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  };

  const toggleExpand = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!childrenByPathRef.current.has(path)) void loadChildren(path);
      }
      return next;
    });
  };

  // Explorer-header actions (VS Code's title toolbar): refresh re-lists every
  // already-loaded directory; collapse-all clears the expanded set.
  const refreshTree = (): void => {
    for (const dir of childrenByPath.keys()) void loadChildren(dir);
    if (!childrenByPath.has(rootPath)) void loadChildren(rootPath);
  };
  const collapseAll = (): void => setExpanded(new Set());

  // When an entry enters inline-rename (a context-menu Rename, or a freshly
  // created file/folder being named), make sure its row is visible: expand +
  // load every ancestor folder so the row renders and shows the input. (A new
  // entry surfaces via the watcher's parent re-list, which only fires for
  // already-loaded dirs — so expanding the chain is what brings it on-screen.)
  useEffect(() => {
    if (renamingPath === null) return;
    const parts = renamingPath.split('/');
    parts.pop(); // drop the entry's own basename
    if (parts.length === 0) {
      // Root-level entry: there's no ancestor to expand, but a freshly-CREATED
      // root entry isn't in the cached root listing yet, so its row (and the
      // inline input) wouldn't render until the watcher's add event re-lists root.
      // Re-list now so the name field appears immediately.
      void loadChildren(rootPath);
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      let acc = '';
      for (const part of parts) {
        acc = acc === '' ? part : `${acc}/${part}`;
        const abs = joinNavPath(rootPath, acc);
        next.add(abs);
        if (!childrenByPathRef.current.has(abs)) void loadChildren(abs);
      }
      return next;
    });
  }, [renamingPath, rootPath, loadChildren]);

  const collectEntries = useCallback(
    (parentPath: string, depth: number): RenderNavRow[] => {
      const entries = childrenByPath.get(parentPath);
      if (!entries) return [];
      return entries.filter(isVisibleNavEntry).flatMap((entry): RenderNavRow[] => {
        const absPath = joinNavPath(parentPath, entry.name);
        const isExpanded = expanded.has(absPath);
        const isDir = entry.type === 'dir';
        const rel = relativeToNavRoot(rootPath, absPath);
        const isSelected = !isDir && currentPath === rel;
        const parentRel = relativeToNavRoot(rootPath, parentPath);
        const row: RenderNavRow = {
          entry,
          absPath,
          rel,
          parentRel,
          depth,
          kind: isDir ? 'folder' : 'file',
          isExpanded,
          isSelected,
        };
        if (isDir && isExpanded) return [row, ...collectEntries(absPath, depth + 1)];
        return [row];
      });
    },
    [childrenByPath, currentPath, expanded, rootPath],
  );

  const visibleRows = useMemo(() => collectEntries(rootPath, 0), [collectEntries, rootPath]);
  const visibleItems: VisibleNavTreeItem[] = visibleRows.map(
    ({ rel, kind, depth, isExpanded }) => ({
      rel,
      kind,
      depth,
      isExpanded,
    }),
  );

  useEffect(() => {
    const currentPathChanged = lastCurrentPathRef.current !== currentPath;
    lastCurrentPathRef.current = currentPath;
    setFocusedRel((prev) => {
      const currentVisible = currentPath
        ? visibleRows.some((row) => row.rel === currentPath)
        : false;
      if (currentPathChanged && currentPath && currentVisible) return currentPath;
      if (prev && visibleRows.some((row) => row.rel === prev)) return prev;
      if (currentPath && currentVisible) return currentPath;
      return visibleRows[0]?.rel ?? null;
    });
  }, [currentPath, visibleRows]);

  const focusRow = (rel: string): void => {
    setFocusedRel(rel);
    const focus = (): void => rowRefs.current.get(rel)?.focus();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focus);
    } else {
      setTimeout(focus, 0);
    }
  };

  const openRow = (row: RenderNavRow): void => {
    if (row.kind === 'folder') toggleExpand(row.absPath);
    else openInPanel(row.rel);
  };

  const openRowContextMenu = (row: RenderNavRow, x: number, y: number): void => {
    const isDir = row.kind === 'folder';
    openContextMenu(
      x,
      y,
      buildFileMenu({
        target: { path: row.rel, kind: row.kind },
        // New items land INSIDE a folder, or beside a file (its parent dir).
        newItemDir: newItemDirForEntry({ rel: row.rel, parentRel: row.parentRel, isDir }),
        onOpen: (t) => (t.kind === 'folder' ? expandFolder(row.absPath) : openInPanel(t.path)),
      }),
    );
  };

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (isEditableTarget(e.target)) return;
    const intent = navTreeKeyboardIntent(visibleItems, focusedRel, {
      key: e.key,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      isMac,
    });
    if (intent.type === 'none') return;
    e.preventDefault();
    e.stopPropagation();

    if (intent.type === 'focus') {
      focusRow(intent.rel);
      return;
    }

    const currentRow = visibleRows.find((row) => row.rel === focusedRel) ?? visibleRows[0] ?? null;
    if (!currentRow) return;

    switch (intent.type) {
      case 'open':
        openRow(currentRow);
        return;
      case 'expand':
        expandFolder(currentRow.absPath);
        return;
      case 'collapse':
        collapseFolder(currentRow.absPath);
        return;
      case 'rename':
        endRename();
        useWorkspaceStore.getState().beginRename(currentRow.rel);
        return;
      case 'delete':
        void confirmAndDelete({ path: currentRow.rel, kind: currentRow.kind });
        return;
      case 'contextMenu': {
        const el = rowRefs.current.get(currentRow.rel);
        const rect = el?.getBoundingClientRect();
        openRowContextMenu(
          currentRow,
          rect ? rect.left + 24 : 0,
          rect ? rect.top + ROW_HEIGHT / 2 : 0,
        );
        return;
      }
    }
  };

  const renderRow = (row: RenderNavRow, index: number): JSX.Element => {
    const isDir = row.kind === 'folder';
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation(); // don't also fire the container's background menu
      setFocusedRel(row.rel);
      openRowContextMenu(row, e.clientX, e.clientY);
    };
    const onRenameCommit = (name: string): void => {
      endRename();
      const newRel = renameTargetForBasename(row.rel, name);
      if (newRel === null) return;
      void renameEntry(row.rel, newRel, row.kind);
    };
    return (
      <NavTreeRow
        key={row.absPath}
        rowRef={(el) => {
          if (el) rowRefs.current.set(row.rel, el);
          else rowRefs.current.delete(row.rel);
        }}
        entry={row.entry}
        rel={row.rel}
        depth={row.depth}
        isExpanded={row.isExpanded}
        isSelected={row.isSelected}
        isFocused={focusedRel === row.rel}
        tabIndex={focusedRel === row.rel || (focusedRel === null && index === 0) ? 0 : -1}
        // Single-click a file = open as a PREVIEW tab (italic, reuses the slot);
        // double-click PINS it (matches the file-explorer idiom). A folder click
        // toggles expansion.
        onClick={() => {
          setFocusedRel(row.rel);
          openRow(row);
        }}
        onKeyDown={onTreeKeyDown}
        onDoubleClick={isDir ? undefined : () => openInPanel(row.rel, { pinned: true })}
        onContextMenu={onContextMenu}
        onFocus={() => setFocusedRel(row.rel)}
        renaming={renamingPath === row.rel}
        onRenameCommit={onRenameCommit}
        onRenameCancel={endRename}
      />
    );
  };

  // Background right-click (empty tree space): New File / New Folder at the root.
  const onBackgroundContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, buildFileMenu({ newItemDir: null }));
  };

  // Surface load errors WITHOUT destroying the tree: a single failed subfolder
  // expansion shouldn't blank the whole sidebar (a dead-end). Show the message
  // above whatever did load; when the root itself failed, the tree is empty so
  // the message stands alone. (Cleared on the next successful load above.)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ExplorerHeader
        name={workspaceName ?? ''}
        title={rootPath}
        onNewFile={() => void createAndRename('file', null)}
        onNewFolder={() => void createAndRename('folder', null)}
        onRefresh={refreshTree}
        onCollapseAll={collapseAll}
      />
      <div
        role="tree"
        aria-label={workspaceName ? `${workspaceName} files` : 'Files'}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: `${space[1]}px 0`,
        }}
        onContextMenu={onBackgroundContextMenu}
      >
        {error && (
          <div
            style={{
              color: color.danger,
              padding: `${space[1.5]}px ${space[3]}px`,
              fontSize: font.size.caption,
            }}
          >
            {error}
          </div>
        )}
        {visibleRows.map(renderRow)}
      </div>
    </div>
  );
};

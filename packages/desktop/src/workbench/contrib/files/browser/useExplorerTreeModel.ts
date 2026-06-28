import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type { WorkspaceListFilesEntry } from '../../../../platform/workspaces/common/workspaces.js';
import {
  subscribeEntryRemoved,
  subscribeEntryRenamed,
} from '../../../services/workspace/browser/workspaceFileEvents.js';
import {
  type VisibleNavTreeItem,
  isVisibleNavEntry,
  joinNavPath,
  parentAbsPath,
  relativeToNavRoot,
  sortNavEntries,
} from './navTreeModel.js';

export interface ExplorerTreeRow extends VisibleNavTreeItem {
  readonly entry: WorkspaceListFilesEntry;
  readonly absPath: string;
  readonly parentRel: string;
  readonly isSelected: boolean;
}

export interface ExplorerTreeModel {
  readonly visibleRows: readonly ExplorerTreeRow[];
  readonly visibleItems: readonly VisibleNavTreeItem[];
  readonly focusedRel: string | null;
  readonly error: string;
  readonly setFocusedRel: (rel: string | null) => void;
  readonly expandFolder: (path: string) => void;
  readonly collapseFolder: (path: string) => void;
  readonly toggleExpand: (path: string) => void;
  readonly refreshTree: () => void;
  readonly collapseAll: () => void;
}

export function useExplorerTreeModel({
  rootPath,
  currentPath,
  renamingPath,
}: {
  readonly rootPath: string;
  readonly currentPath: string | null;
  readonly renamingPath: string | null;
}): ExplorerTreeModel {
  const [childrenByPath, setChildrenByPath] = useState<
    Map<string, readonly WorkspaceListFilesEntry[]>
  >(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusedRel, setFocusedRel] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const childrenByPathRef = useRef(childrenByPath);
  const lastCurrentPathRef = useRef(currentPath);
  childrenByPathRef.current = childrenByPath;

  const loadChildren = useCallback(async (path: string): Promise<void> => {
    try {
      const result = await workspaceService.listFiles(path);
      setChildrenByPath((prev) => {
        const next = new Map(prev);
        next.set(path, result.entries);
        return next;
      });
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

  useEffect(() => {
    const refreshParentOf = (rel: string): void => {
      if (rel === '.bh' || rel.startsWith('.bh/')) return;
      const parentAbs = parentAbsPath(rootPath, rel);
      if (childrenByPathRef.current.has(parentAbs)) {
        void loadChildren(parentAbs);
      }
    };
    return fileEventService.onDidChangeFiles((event) => {
      if (event.type === 'rename') {
        refreshParentOf(event.fromRelPath);
        refreshParentOf(event.toRelPath);
        return;
      }
      refreshParentOf(event.relPath);
    });
  }, [rootPath, loadChildren]);

  useEffect(() => {
    return subscribeEntryRemoved((rel) => {
      const slash = rel.lastIndexOf('/');
      const name = slash === -1 ? rel : rel.slice(slash + 1);
      const parentAbs = parentAbsPath(rootPath, rel);
      const removedAbs = joinNavPath(rootPath, rel);
      setChildrenByPath((prev) => {
        const entries = prev.get(parentAbs);
        const next = new Map(prev);
        if (entries) {
          next.set(
            parentAbs,
            entries.filter((e) => e.name !== name),
          );
        }
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

  const collapseFolder = useCallback((path: string): void => {
    setExpanded((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const toggleExpand = useCallback(
    (path: string): void => {
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
    },
    [loadChildren],
  );

  const refreshTree = useCallback((): void => {
    for (const dir of childrenByPath.keys()) void loadChildren(dir);
    if (!childrenByPath.has(rootPath)) void loadChildren(rootPath);
  }, [childrenByPath, rootPath, loadChildren]);

  const collapseAll = useCallback((): void => setExpanded(new Set()), []);

  useEffect(() => {
    if (renamingPath === null) return;
    const parts = renamingPath.split('/');
    parts.pop();
    if (parts.length === 0) {
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
    (parentPath: string, depth: number): ExplorerTreeRow[] => {
      const entries = childrenByPath.get(parentPath);
      if (!entries) return [];
      return entries.filter(isVisibleNavEntry).flatMap((entry): ExplorerTreeRow[] => {
        const absPath = joinNavPath(parentPath, entry.name);
        const isExpanded = expanded.has(absPath);
        const isDir = entry.type === 'dir';
        const rel = relativeToNavRoot(rootPath, absPath);
        const isSelected = !isDir && currentPath === rel;
        const parentRel = relativeToNavRoot(rootPath, parentPath);
        const row: ExplorerTreeRow = {
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
  const visibleItems = useMemo(
    () =>
      visibleRows.map(({ rel, kind, depth, isExpanded }) => ({
        rel,
        kind,
        depth,
        isExpanded,
      })),
    [visibleRows],
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

  return {
    visibleRows,
    visibleItems,
    focusedRel,
    error,
    setFocusedRel,
    expandFolder,
    collapseFolder,
    toggleExpand,
    refreshTree,
    collapseAll,
  };
}

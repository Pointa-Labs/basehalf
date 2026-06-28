import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type { WorkspaceListFilesEntry } from '../../../../platform/workspaces/common/workspaces.js';
import {
  subscribeEntryRemoved,
  subscribeEntryRenamed,
} from '../../../services/workspace/browser/workspaceFileEvents.js';
import {
  type ExplorerTreeRow,
  type VisibleNavTreeItem,
  buildVisibleNavRows,
  joinNavPath,
  parentAbsPath,
  removeNavEntryOptimistically,
  renameNavEntryOptimistically,
} from './navTreeModel.js';

export type { ExplorerTreeRow } from './navTreeModel.js';

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
      setChildrenByPath((prev) => {
        const next = removeNavEntryOptimistically({
          childrenByPath: prev,
          expanded,
          rootPath,
          rel,
        });
        return next.childrenByPath;
      });
      setExpanded((prev) => {
        const next = removeNavEntryOptimistically({
          childrenByPath: childrenByPathRef.current,
          expanded: prev,
          rootPath,
          rel,
        });
        return next.expanded.size === prev.size ? prev : next.expanded;
      });
    });
  }, [expanded, rootPath]);

  useEffect(() => {
    return subscribeEntryRenamed((from, to) => {
      setChildrenByPath((prev) => {
        const next = renameNavEntryOptimistically({
          childrenByPath: prev,
          expanded,
          rootPath,
          from,
          to,
        });
        return next.childrenByPath;
      });
      setExpanded((prev) => {
        const next = renameNavEntryOptimistically({
          childrenByPath: childrenByPathRef.current,
          expanded: prev,
          rootPath,
          from,
          to,
        });
        return next.expanded;
      });
    });
  }, [expanded, rootPath]);

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

  const visibleRows = useMemo(
    () => buildVisibleNavRows({ childrenByPath, expanded, rootPath, currentPath }),
    [childrenByPath, currentPath, expanded, rootPath],
  );
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceListFilesEntry } from '../../../services/workspace/common/workspaceTypes.js';
import {
  type ExplorerTreeRow,
  type VisibleNavTreeItem,
  buildVisibleNavRows,
  joinNavPath,
} from '../common/navTreeModel.js';
import { explorerService } from './explorerService.js';

export type { ExplorerTreeRow } from '../common/navTreeModel.js';

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

interface ExplorerTreeCache {
  readonly childrenByPath: Map<string, readonly WorkspaceListFilesEntry[]>;
  readonly expanded: Set<string>;
}

const emptyExplorerTreeCache = (): ExplorerTreeCache => ({
  childrenByPath: new Map(),
  expanded: new Set(),
});

export function useExplorerTreeModel({
  rootPath,
  currentPath,
  renamingPath,
}: {
  readonly rootPath: string;
  readonly currentPath: string | null;
  readonly renamingPath: string | null;
}): ExplorerTreeModel {
  const [treeCache, setTreeCache] = useState<ExplorerTreeCache>(() => emptyExplorerTreeCache());
  const [focusedRel, setFocusedRel] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const treeCacheRef = useRef(treeCache);
  const lastCurrentPathRef = useRef(currentPath);
  treeCacheRef.current = treeCache;

  const commitTreeCache = useCallback((next: ExplorerTreeCache): void => {
    treeCacheRef.current = next;
    setTreeCache(next);
  }, []);

  const updateTreeCache = useCallback(
    (updater: (prev: ExplorerTreeCache) => ExplorerTreeCache): void => {
      setTreeCache((prev) => {
        const next = updater(prev);
        treeCacheRef.current = next;
        return next;
      });
    },
    [],
  );

  const loadChildren = useCallback(
    async (path: string): Promise<void> => {
      try {
        const entries = await explorerService.resolveChildren(path);
        updateTreeCache((prev) => {
          const childrenByPath = new Map(prev.childrenByPath);
          childrenByPath.set(path, entries);
          return { childrenByPath, expanded: prev.expanded };
        });
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [updateTreeCache],
  );

  useEffect(() => {
    commitTreeCache(emptyExplorerTreeCache());
    setFocusedRel(null);
    setError('');
    void loadChildren(rootPath);
  }, [rootPath, loadChildren, commitTreeCache]);

  useEffect(() => {
    return explorerService.onDidChangeFiles((event) => {
      const currentCache = treeCacheRef.current;
      const mutation = explorerService.applyFileEvent(
        {
          childrenByPath: currentCache.childrenByPath,
          expanded: currentCache.expanded,
          rootPath,
        },
        event,
      );
      const nextCache = mutation ?? currentCache;
      if (mutation !== null) {
        commitTreeCache(mutation);
      }
      for (const dir of explorerService.affectedLoadedDirectories({
        rootPath,
        childrenByPath: nextCache.childrenByPath,
        event,
      })) {
        void loadChildren(dir);
      }
    });
  }, [rootPath, loadChildren, commitTreeCache]);

  useEffect(() => {
    return explorerService.onDidRunOperation((operation) => {
      const currentCache = treeCacheRef.current;
      const next = explorerService.applyFileOperation(
        {
          childrenByPath: currentCache.childrenByPath,
          expanded: currentCache.expanded,
          rootPath,
        },
        operation,
      );
      commitTreeCache(next);
    });
  }, [rootPath, commitTreeCache]);

  const expandFolder = useCallback(
    (path: string): void => {
      updateTreeCache((prev) => {
        if (prev.expanded.has(path)) return prev;
        const expanded = new Set(prev.expanded);
        expanded.add(path);
        return { childrenByPath: prev.childrenByPath, expanded };
      });
      if (!treeCacheRef.current.childrenByPath.has(path)) void loadChildren(path);
    },
    [loadChildren, updateTreeCache],
  );

  const collapseFolder = useCallback(
    (path: string): void => {
      updateTreeCache((prev) => {
        if (!prev.expanded.has(path)) return prev;
        const expanded = new Set(prev.expanded);
        expanded.delete(path);
        return { childrenByPath: prev.childrenByPath, expanded };
      });
    },
    [updateTreeCache],
  );

  const toggleExpand = useCallback(
    (path: string): void => {
      const shouldLoad =
        !treeCacheRef.current.expanded.has(path) && !treeCacheRef.current.childrenByPath.has(path);
      updateTreeCache((prev) => {
        const expanded = new Set(prev.expanded);
        if (expanded.has(path)) {
          expanded.delete(path);
        } else {
          expanded.add(path);
        }
        return { childrenByPath: prev.childrenByPath, expanded };
      });
      if (shouldLoad) void loadChildren(path);
    },
    [loadChildren, updateTreeCache],
  );

  const refreshTree = useCallback((): void => {
    for (const dir of treeCache.childrenByPath.keys()) void loadChildren(dir);
    if (!treeCache.childrenByPath.has(rootPath)) void loadChildren(rootPath);
  }, [treeCache, rootPath, loadChildren]);

  const collapseAll = useCallback(
    (): void =>
      updateTreeCache((prev) =>
        prev.expanded.size === 0
          ? prev
          : { childrenByPath: prev.childrenByPath, expanded: new Set() },
      ),
    [updateTreeCache],
  );

  useEffect(() => {
    if (renamingPath === null) return;
    const parts = renamingPath.split('/');
    parts.pop();
    if (parts.length === 0) {
      void loadChildren(rootPath);
      return;
    }
    const folderPaths: string[] = [];
    let acc = '';
    for (const part of parts) {
      acc = acc === '' ? part : `${acc}/${part}`;
      folderPaths.push(joinNavPath(rootPath, acc));
    }
    const missingFolders = folderPaths.filter(
      (abs) => !treeCacheRef.current.childrenByPath.has(abs),
    );
    updateTreeCache((prev) => {
      const expanded = new Set(prev.expanded);
      for (const abs of folderPaths) expanded.add(abs);
      return { childrenByPath: prev.childrenByPath, expanded };
    });
    for (const abs of missingFolders) void loadChildren(abs);
  }, [renamingPath, rootPath, loadChildren, updateTreeCache]);

  const visibleRows = useMemo(
    () =>
      buildVisibleNavRows({
        childrenByPath: treeCache.childrenByPath,
        expanded: treeCache.expanded,
        rootPath,
        currentPath,
      }),
    [treeCache, currentPath, rootPath],
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

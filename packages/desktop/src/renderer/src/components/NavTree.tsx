import type { WorkspaceListFilesEntry, WorkspaceListFilesResult } from '@basehalf/core';
import { type JSX, useCallback, useEffect, useState } from 'react';

interface NavTreeProps {
  rootPath: string;
}

// Plain path join — paths come from the OS already normalized; we only
// concat names that ctx.fs.readdir returned, so no traversal worries.
const joinPath = (parent: string, name: string): string =>
  parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`;

const rowBase = {
  width: '100%',
  textAlign: 'left' as const,
  border: 'none',
  background: 'transparent',
  padding: '2px 4px',
  fontSize: 12,
  fontFamily: 'system-ui, sans-serif',
  color: '#222',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

export const NavTree = ({ rootPath }: NavTreeProps): JSX.Element => {
  const [childrenByPath, setChildrenByPath] = useState<
    Map<string, readonly WorkspaceListFilesEntry[]>
  >(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>('');

  const loadChildren = useCallback(async (path: string): Promise<void> => {
    try {
      const result = (await window.bh.run('workspace.listFiles', {
        path,
      })) as WorkspaceListFilesResult;
      setChildrenByPath((prev) => {
        const next = new Map(prev);
        next.set(path, result.entries);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    setChildrenByPath(new Map());
    setExpanded(new Set());
    setError('');
    void loadChildren(rootPath);
  }, [rootPath, loadChildren]);

  const toggleExpand = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!childrenByPath.has(path)) void loadChildren(path);
      }
      return next;
    });
  };

  const renderEntries = (parentPath: string, depth: number): JSX.Element[] => {
    const entries = childrenByPath.get(parentPath);
    if (!entries) return [];
    return entries.flatMap((entry) => {
      const path = joinPath(parentPath, entry.name);
      const isExpanded = expanded.has(path);
      const indent = 8 + depth * 14;
      const row: JSX.Element =
        entry.type === 'dir' ? (
          <button
            key={path}
            type="button"
            onClick={() => toggleExpand(path)}
            style={{ ...rowBase, paddingLeft: indent, cursor: 'pointer' }}
          >
            <span style={{ width: 10, fontSize: 9, color: '#888' }}>{isExpanded ? '▼' : '▶'}</span>
            <span>{entry.name}</span>
          </button>
        ) : (
          <div
            key={path}
            style={{
              ...rowBase,
              paddingLeft: indent + 14,
              color: '#444',
            }}
          >
            <span>{entry.name}</span>
          </div>
        );

      if (entry.type === 'dir' && isExpanded) {
        return [row, ...renderEntries(path, depth + 1)];
      }
      return [row];
    });
  };

  if (error) {
    return <div style={{ color: '#a00', padding: 8, fontSize: 12 }}>{error}</div>;
  }
  return <div>{renderEntries(rootPath, 0)}</div>;
};

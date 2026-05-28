import type { WorkspaceListFilesEntry, WorkspaceListFilesResult } from '@basehalf/core';
import { type JSX, useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

interface NavTreeProps {
  rootPath: string;
}

// SR-v0 §4.5 default blacklist for the NavTree. Hide tooling cruft +
// our own .bh/ control dir. Plain dotfiles (.env, .gitignore) stay
// visible — users sometimes care about those. v0.x will move this to
// .bh/config.json so per-workspace overrides are possible.
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

const isVisible = (entry: WorkspaceListFilesEntry): boolean => !HIDDEN_NAMES.has(entry.name);

// Plain path join — paths come from the OS already normalized; we only
// concat names that ctx.fs.readdir returned, so no traversal worries.
const joinPath = (parent: string, name: string): string =>
  parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`;

// Strip the workspace root prefix to get a POSIX relative path for
// workspace.readFile etc.
const relativeTo = (root: string, abs: string): string => {
  const trimmedRoot = root.endsWith('/') ? root : `${root}/`;
  return abs.startsWith(trimmedRoot) ? abs.slice(trimmedRoot.length) : abs;
};

const ROW_HEIGHT = 24;

interface RowProps {
  depth: number;
  entry: WorkspaceListFilesEntry;
  isExpanded: boolean;
  isSelected: boolean;
  onClick: () => void;
}

const Row = ({ depth, entry, isExpanded, isSelected, onClick }: RowProps): JSX.Element => {
  const [hover, setHover] = useState(false);
  const isDir = entry.type === 'dir';
  const indent = 8 + depth * 14;
  const bg = isSelected ? '#e6f0fb' : hover ? '#f0f0f0' : 'transparent';
  const color = isSelected ? '#1a4d8f' : isDir ? '#222' : '#444';
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={entry.name}
      style={{
        width: '100%',
        textAlign: 'left',
        border: 'none',
        background: bg,
        padding: 0,
        paddingLeft: indent,
        paddingRight: 8,
        height: ROW_HEIGHT,
        fontSize: 12,
        fontFamily: 'system-ui, sans-serif',
        color,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer',
        fontWeight: isSelected ? 600 : 400,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 12,
          fontSize: 10,
          color: '#888',
          display: 'inline-flex',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isDir ? (isExpanded ? '▾' : '▸') : ''}
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.name}
      </span>
    </button>
  );
};

export const NavTree = ({ rootPath }: NavTreeProps): JSX.Element => {
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
  const currentFile = useWorkspaceStore((s) => s.currentFile);
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
    return entries.filter(isVisible).flatMap((entry) => {
      const path = joinPath(parentPath, entry.name);
      const isExpanded = expanded.has(path);
      const isDir = entry.type === 'dir';
      const rel = relativeTo(rootPath, path);
      const isSelected = !isDir && currentFile === rel;
      const row: JSX.Element = (
        <Row
          key={path}
          entry={entry}
          depth={depth}
          isExpanded={isExpanded}
          isSelected={isSelected}
          onClick={() => (isDir ? toggleExpand(path) : setCurrentFile(rel))}
        />
      );
      if (isDir && isExpanded) {
        return [row, ...renderEntries(path, depth + 1)];
      }
      return [row];
    });
  };

  if (error) {
    return <div style={{ color: '#a00', padding: 8, fontSize: 12 }}>{error}</div>;
  }
  return <div style={{ padding: '4px 0' }}>{renderEntries(rootPath, 0)}</div>;
};

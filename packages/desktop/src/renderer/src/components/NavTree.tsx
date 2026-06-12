import type { WorkspaceListFilesEntry, WorkspaceListFilesResult } from '@basehalf/core';
import { type CSSProperties, type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { panelTabFile } from '../lib/panelTab.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FileGlyph, badgeType } from './FileGlyph.js';

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

const joinPath = (parent: string, name: string): string =>
  parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`;

const relativeTo = (root: string, abs: string): string => {
  const trimmedRoot = root.endsWith('/') ? root : `${root}/`;
  return abs.startsWith(trimmedRoot) ? abs.slice(trimmedRoot.length) : abs;
};

const ROW_HEIGHT = 22; // matches the editor's compact tree-row height

interface RowProps {
  depth: number;
  entry: WorkspaceListFilesEntry;
  isExpanded: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
}

/** Root-level agent-protocol pointer files (setup installs them). The sidebar
 *  is the truthful filesystem view, so they stay visible — but dimmed and
 *  labeled, so a user who just opened a folder understands what they are at a
 *  glance. (The canvas — the user's content map — skips them entirely.) */
const isAgentHintFile = (depth: number, entry: WorkspaceListFilesEntry): boolean =>
  depth === 0 &&
  entry.type === 'file' &&
  (entry.name === 'CLAUDE.md' || entry.name === 'AGENTS.md');

const Row = ({
  depth,
  entry,
  isExpanded,
  isSelected,
  onClick,
  onDoubleClick,
}: RowProps): JSX.Element => {
  const [hover, setHover] = useState(false);
  const isDir = entry.type === 'dir';
  const indent = space[2] + depth * 14;
  const agentHint = isAgentHintFile(depth, entry);

  const bg = isSelected ? color.accentSofter : hover ? color.divider : 'transparent';
  const fg = isSelected
    ? color.accent
    : agentHint
      ? color.textGhost
      : isDir
        ? color.textPrimary
        : color.textSecondary;
  const weight = isSelected ? font.weight.medium : font.weight.regular;

  const style: CSSProperties = {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: bg,
    padding: 0,
    paddingLeft: indent,
    paddingRight: space[2],
    height: ROW_HEIGHT,
    fontSize: font.size.caption,
    fontFamily: font.sans,
    color: fg,
    display: 'flex',
    alignItems: 'center',
    gap: space[1],
    cursor: 'pointer',
    fontWeight: weight,
    transition: transition(['background', 'color']),
    position: 'relative',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={
        agentHint
          ? `${entry.name} — instructions AI agents read when working in this folder (installed by BaseHalf)`
          : entry.name
      }
      data-selected={isSelected ? 'true' : 'false'}
      className="bh-nav-row"
      style={style}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          color: color.textTertiary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isDir ? (
          <ChevronIcon open={isExpanded} />
        ) : (
          // File-type glyph so the tree shares the canvas's visual language
          // and is scannable at a glance (matches BadgeNode's identity pass).
          <FileGlyph
            type={badgeType(entry.name, false)}
            tone={isSelected ? color.accent : color.textTertiary}
            size={13}
          />
        )}
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
      {agentHint && (
        <span
          aria-hidden
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            fontSize: 9,
            fontWeight: font.weight.medium,
            letterSpacing: font.trackedCaps,
            color: color.textGhost,
            border: `1px solid ${color.border}`,
            borderRadius: radius.pill,
            padding: '0px 5px',
            lineHeight: '12px',
          }}
        >
          AI
        </span>
      )}
    </button>
  );
};

const ChevronIcon = ({ open }: { open: boolean }): JSX.Element => (
  <svg
    width={9}
    height={9}
    viewBox="0 0 9 9"
    aria-hidden
    style={{
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: transition(['transform']),
    }}
  >
    <path
      d="M3 2l2.5 2.5L3 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const NavTree = ({ rootPath }: NavTreeProps): JSX.Element => {
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const currentFile = useWorkspaceStore((s) => s.currentFile);
  const currentPath = currentFile === null ? null : panelTabFile(currentFile);
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
    setError('');
    void loadChildren(rootPath);
  }, [rootPath, loadChildren]);

  // Subscribe to watcher events so files created/deleted externally show
  // up without a window reload. Only re-fetch parent directories we've
  // already loaded — unexpanded ones load lazily on click anyway.
  const childrenByPathRef = useRef(childrenByPath);
  childrenByPathRef.current = childrenByPath;
  useEffect(() => {
    const refreshParentOf = (rel: string): void => {
      if (rel === '.bh' || rel.startsWith('.bh/')) return;
      const lastSlash = rel.lastIndexOf('/');
      const parentRel = lastSlash === -1 ? '' : rel.slice(0, lastSlash);
      const parentAbs = parentRel === '' ? rootPath : joinPath(rootPath, parentRel);
      if (childrenByPathRef.current.has(parentAbs)) {
        void loadChildren(parentAbs);
      }
    };
    const unsub = window.bh.onFileEvent((event) => {
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
      const isSelected = !isDir && currentPath === rel;
      const row: JSX.Element = (
        <Row
          key={path}
          entry={entry}
          depth={depth}
          isExpanded={isExpanded}
          isSelected={isSelected}
          // Single-click a file = open as a PREVIEW tab (italic, reuses the slot);
          // double-click PINS it (matches the file-explorer idiom). A folder click
          // toggles expansion.
          onClick={() => (isDir ? toggleExpand(path) : openInPanel(rel))}
          onDoubleClick={isDir ? undefined : () => openInPanel(rel, { pinned: true })}
        />
      );
      if (isDir && isExpanded) {
        return [row, ...renderEntries(path, depth + 1)];
      }
      return [row];
    });
  };

  // Surface load errors WITHOUT destroying the tree: a single failed subfolder
  // expansion shouldn't blank the whole sidebar (a dead-end). Show the message
  // above whatever did load; when the root itself failed, the tree is empty so
  // the message stands alone. (Cleared on the next successful load above.)
  return (
    <div style={{ padding: `${space[2]}px 0`, borderRadius: radius.sm }}>
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
      {renderEntries(rootPath, 0)}
    </div>
  );
};

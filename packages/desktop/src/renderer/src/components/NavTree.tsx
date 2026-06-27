import type { WorkspaceListFilesEntry, WorkspaceListFilesResult } from '@basehalf/core';
import {
  type CSSProperties,
  type JSX,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { subscribeEntryRemoved, subscribeEntryRenamed } from '../lib/fileEvents.js';
import { type GitDecoPalette, fileDecoration, statusTooltip } from '../lib/gitStatus.js';
import { buildFileMenu, createAndRename } from '../lib/menus/fileMenu.js';
import { openContextMenu } from '../store/contextMenu.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { InlineEditInput } from './primitives/InlineEditInput.js';

// File-tree git-status colors (VS Code conventions): added / untracked green,
// modified amber, deleted red, conflict red, renamed accent.
const GIT_PALETTE: GitDecoPalette = {
  added: color.success,
  modified: color.warning,
  deleted: color.danger,
  conflict: color.danger,
  renamed: color.accent,
  untracked: color.success,
};

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

// Same ordering workspace.listFiles returns (dirs first, then name), so an
// optimistic rename re-sorts the row to the position the watcher reload will
// place it — no jump when the reload lands.
const sortEntries = (entries: readonly WorkspaceListFilesEntry[]): WorkspaceListFilesEntry[] =>
  [...entries].sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
  );

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
  /** Workspace-relative POSIX path, for the git-status coloring lookup. */
  rel: string;
  isExpanded: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** When true, the name is replaced by an inline edit field (rename / name-new). */
  renaming?: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
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
  rel,
  isExpanded,
  isSelected,
  onClick,
  onDoubleClick,
  onContextMenu,
  renaming = false,
  onRenameCommit,
  onRenameCancel,
}: RowProps): JSX.Element => {
  const [hover, setHover] = useState(false);
  const isDir = entry.type === 'dir';
  const indent = space[2] + depth * 14;
  const agentHint = isAgentHintFile(depth, entry);
  // git status for this path (a file, or an untracked dir reported as "rel/").
  const direct = useGitStatusStore((s) => s.byPath.get(rel) ?? s.byPath.get(`${rel}/`));
  // A tracked folder with no direct entry inherits a propagated mark if a
  // descendant changed — so a collapsed folder with edits inside still reads.
  const folderAgg = useGitStatusStore((s) => (isDir ? s.folderStatus.get(rel) : undefined));
  const git = direct ?? folderAgg;
  const propagated = direct === undefined && folderAgg !== undefined;
  const deco = git ? fileDecoration(git, GIT_PALETTE) : null;

  const glyph = (
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
        <FileGlyph
          type={badgeType(entry.name, false)}
          tone={isSelected ? color.accent : color.textTertiary}
          size={13}
        />
      )}
    </span>
  );

  // Inline rename / name-a-new-entry: a non-button row (an <input> can't live
  // inside a <button>) laid out identically, reusing the shared commit machine.
  if (renaming) {
    return (
      <div
        className="bh-nav-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[1],
          height: ROW_HEIGHT,
          paddingLeft: indent,
          paddingRight: space[2],
          background: color.divider,
        }}
      >
        {glyph}
        <InlineEditInput
          initialValue={entry.name}
          onCommit={(name) => onRenameCommit?.(name)}
          onCancel={() => onRenameCancel?.()}
          ariaLabel="New name"
          testId="nav-rename-input"
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${color.accent}`,
            borderRadius: radius.sm,
            background: color.bg,
            color: color.textPrimary,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            padding: `0 ${space[1]}px`,
            height: ROW_HEIGHT - 4,
            outline: 'none',
          }}
        />
      </div>
    );
  }

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
      onContextMenu={onContextMenu}
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
      {/* Indent guides: a 1px vertical per ancestor depth (VS Code's tree guides),
          aligned under each ancestor's twisty. */}
      {Array.from({ length: depth }, (_, i) => space[2] + i * 14 + 7).map((x) => (
        <span
          key={x}
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: x,
            width: 1,
            background: color.border,
            pointerEvents: 'none',
          }}
        />
      ))}
      {/* File-type glyph so the tree shares the canvas's visual language and is
          scannable at a glance (matches BadgeNode's identity pass). */}
      {glyph}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(deco && !isSelected && { color: deco.color }),
          ...(deco?.strikeThrough && { textDecoration: 'line-through' }),
        }}
      >
        {entry.name}
      </span>
      {deco && git && (
        <span
          aria-hidden
          title={propagated ? '此文件夹包含改动' : statusTooltip(git)}
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            fontFamily: font.mono,
            fontSize: font.size.micro,
            fontWeight: font.weight.semibold,
            color: deco.color,
          }}
        >
          {/* A propagated folder shows a dot (a letter on a folder reads oddly). */}
          {propagated ? '●' : deco.letter}
        </span>
      )}
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

  // Optimistic delete: drop the row immediately when an in-app delete succeeds,
  // instead of waiting for the watcher's unlink event to re-list the parent.
  useEffect(() => {
    return subscribeEntryRemoved((rel) => {
      const slash = rel.lastIndexOf('/');
      const parentRel = slash === -1 ? '' : rel.slice(0, slash);
      const name = slash === -1 ? rel : rel.slice(slash + 1);
      const parentAbs = parentRel === '' ? rootPath : joinPath(rootPath, parentRel);
      const removedAbs = joinPath(rootPath, rel);
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
      const parentRel = fromSlash === -1 ? '' : from.slice(0, fromSlash);
      const toSlash = to.lastIndexOf('/');
      const newName = toSlash === -1 ? to : to.slice(toSlash + 1);
      const parentAbs = parentRel === '' ? rootPath : joinPath(rootPath, parentRel);
      const fromAbs = joinPath(rootPath, from);
      const toAbs = joinPath(rootPath, to);
      setChildrenByPath((prev) => {
        const next = new Map(prev);
        const entries = next.get(parentAbs);
        if (entries) {
          next.set(
            parentAbs,
            sortEntries(entries.map((e) => (e.name === oldName ? { ...e, name: newName } : e))),
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
        const abs = joinPath(rootPath, acc);
        next.add(abs);
        if (!childrenByPathRef.current.has(abs)) void loadChildren(abs);
      }
      return next;
    });
  }, [renamingPath, rootPath, loadChildren]);

  const renderEntries = (parentPath: string, depth: number): JSX.Element[] => {
    const entries = childrenByPath.get(parentPath);
    if (!entries) return [];
    return entries.filter(isVisible).flatMap((entry) => {
      const path = joinPath(parentPath, entry.name);
      const isExpanded = expanded.has(path);
      const isDir = entry.type === 'dir';
      const rel = relativeTo(rootPath, path);
      const isSelected = !isDir && currentPath === rel;
      const parentRel = relativeTo(rootPath, parentPath);
      const onContextMenu = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation(); // don't also fire the container's background menu
        openContextMenu(
          e.clientX,
          e.clientY,
          buildFileMenu({
            target: { path: rel, kind: isDir ? 'folder' : 'file' },
            // New items land INSIDE a folder, or beside a file (its parent dir).
            newItemDir: isDir ? rel : parentRel === '' ? null : parentRel,
            onOpen: (t) => (t.kind === 'folder' ? toggleExpand(path) : openInPanel(t.path)),
          }),
        );
      };
      const onRenameCommit = (name: string): void => {
        endRename();
        // Basename-only: a typed '/' (or '.'/'..') would silently move the entry
        // into another folder rather than retitle it in place — reject it.
        if (name.includes('/') || name === '.' || name === '..') return;
        const slash = rel.lastIndexOf('/');
        const dir = slash === -1 ? '' : rel.slice(0, slash);
        const newRel = dir === '' ? name : `${dir}/${name}`;
        void renameEntry(rel, newRel, isDir ? 'folder' : 'file');
      };
      const row: JSX.Element = (
        <Row
          key={path}
          entry={entry}
          rel={rel}
          depth={depth}
          isExpanded={isExpanded}
          isSelected={isSelected}
          // Single-click a file = open as a PREVIEW tab (italic, reuses the slot);
          // double-click PINS it (matches the file-explorer idiom). A folder click
          // toggles expansion.
          onClick={() => (isDir ? toggleExpand(path) : openInPanel(rel))}
          onDoubleClick={isDir ? undefined : () => openInPanel(rel, { pinned: true })}
          onContextMenu={onContextMenu}
          renaming={renamingPath === rel}
          onRenameCommit={onRenameCommit}
          onRenameCancel={endRename}
        />
      );
      if (isDir && isExpanded) {
        return [row, ...renderEntries(path, depth + 1)];
      }
      return [row];
    });
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
        {renderEntries(rootPath, 0)}
      </div>
    </div>
  );
};

// ── Explorer header (VS Code's view-title toolbar): folder name + hover actions ─
const ExplorerHeader = ({
  name,
  title,
  onNewFile,
  onNewFolder,
  onRefresh,
  onCollapseAll,
}: {
  name: string;
  title: string;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        height: 22,
        padding: `0 ${space[2]}px 0 ${space[4]}px`,
        userSelect: 'none',
      }}
    >
      <span
        title={title}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: font.sans,
          fontSize: font.size.micro,
          fontWeight: font.weight.semibold,
          letterSpacing: font.trackedCaps,
          textTransform: 'uppercase',
          color: color.textSecondary,
        }}
      >
        {name}
      </span>
      {/* VS Code reveals these on header hover/focus. */}
      <span
        style={{
          display: 'flex',
          gap: space[1],
          opacity: hover ? 1 : 0,
          transition: transition(['opacity']),
        }}
      >
        <HdrBtn title="新建文件" onClick={onNewFile} glyph="🗋" />
        <HdrBtn title="新建文件夹" onClick={onNewFolder} glyph="🗀" />
        <HdrBtn title="刷新" onClick={onRefresh} glyph="↻" />
        <HdrBtn title="全部折叠" onClick={onCollapseAll} glyph="⌄" />
      </span>
    </div>
  );
};

const HdrBtn = ({
  glyph,
  title,
  onClick,
}: {
  glyph: string;
  title: string;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    style={{
      width: 20,
      height: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      borderRadius: radius.sm,
      cursor: 'pointer',
      color: color.textTertiary,
      fontSize: font.size.caption,
      lineHeight: 1,
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.divider;
      e.currentTarget.style.color = color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = color.textTertiary;
    }}
  >
    {glyph}
  </button>
);

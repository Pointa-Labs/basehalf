/**
 * CommandPalette — Linear-style fuzzy launcher.
 *
 * Cmd/Ctrl+K opens; users type to filter across:
 *   - Workspaces (switch active workspace)
 *   - Saved views (switch active view; main-canvas option)
 *   - Files (open any file in the current workspace by basename)
 *   - Chrome actions (Add folder, New note)
 *   - Search (files whose CONTENT matches — full-text, async + debounced)
 *
 * The name/prompt matches above are instant + local; the Search section is
 * the retrieval leg that lets you find a note by a phrase you remember from
 * INSIDE it, not just its filename. So ⌘K is "find anything."
 *
 * Arrow keys navigate, Enter executes, Esc closes, click-outside
 * closes. The whole component is a modal backdrop + a centered card
 * with the same design tokens as the rest of the chrome (Dialog,
 * Select, etc.) so it doesn't read as a separate sub-product.
 */

import type { SearchQueryResult } from '@basehalf/core';
import { type CSSProperties, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import {
  createDemoAtDefault,
  promptForNewNote,
  promptForNewView,
  tildifyPath,
} from '../lib/actions.js';
import { recentFilesFor } from '../lib/recent-files.js';
import { useWorkspaceStore } from '../store/workspace.js';

interface CommandPaletteStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const usePaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function openCommandPalette(): void {
  usePaletteStore.getState().setOpen(true);
}

export function closeCommandPalette(): void {
  usePaletteStore.getState().setOpen(false);
}

interface Action {
  /** Stable id used as React key and for navigation focus. */
  id: string;
  /** Primary label shown in the row. */
  label: string;
  /** Optional secondary text shown on the right (path, count, etc.). */
  hint?: string;
  /** Short category prefix (Workspace, View, File, Action, Search) shown left. */
  category: 'Workspace' | 'View' | 'File' | 'Action' | 'Search';
  /** Optional dimmer second line under the label — used by Search rows to
   *  show the matching snippet so you can see WHY a file matched. */
  sub?: string;
  /** Optional keyboard shortcut hint (e.g. "⌘N") rendered as a small
   *  pill on the right so users discover the global shortcuts by
   *  browsing the palette. */
  shortcut?: string;
  /** Extra text the palette query matches against but doesn't display.
   *  Used to make files findable by their user-written prompt without
   *  cluttering the row visually. */
  searchAlso?: string;
  /** Runs when the user picks this action. The palette closes first. */
  run: () => void;
}

// Mac uses ⌘ / ⇧; everything else uses Ctrl / Shift to match what
// App.tsx actually listens for.
const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
const SHIFT = navigator.platform.includes('Mac') ? '⇧' : 'Shift+';

const backdropStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: color.backdrop,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 100,
  zIndex: 100,
  animation: `bh-fade-in ${motion.fast}`,
};

const cardStyle: CSSProperties = {
  background: color.surface,
  borderRadius: radius.xl,
  boxShadow: shadow.floating,
  width: 560,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 200px)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: font.sans,
  animation: `bh-dialog-in ${motion.normal}`,
};

const inputStyle: CSSProperties = {
  border: 'none',
  outline: 'none',
  padding: `${space[3]}px ${space[4]}px`,
  fontSize: font.size.body,
  fontFamily: font.sans,
  color: color.textPrimary,
  background: 'transparent',
  borderBottom: `1px solid ${color.divider}`,
};

const listStyle: CSSProperties = {
  overflowY: 'auto',
  flex: 1,
  padding: space[1],
};

const emptyStyle: CSSProperties = {
  padding: `${space[5]}px ${space[4]}px`,
  textAlign: 'center',
  color: color.textTertiary,
  fontSize: font.size.caption,
};

interface FileEntry {
  readonly file: string;
  /** The user-written description of what this file is for. The palette
   *  matches against this in addition to the path so users can find
   *  files by typing words from their own prompts. */
  readonly prompt?: string;
}

export const CommandPalette = (): JSX.Element | null => {
  const open = usePaletteStore((s) => s.open);
  const setOpen = usePaletteStore((s) => s.setOpen);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const views = useWorkspaceStore((s) => s.views);
  const use = useWorkspaceStore((s) => s.use);
  const setCurrentView = useWorkspaceStore((s) => s.setCurrentView);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);

  // Files in the current workspace — fetched lazily when the palette opens (so
  // we don't pay the cost on every render of the host App) AND whenever the
  // active workspace changes. Re-fetching on `current` is load-bearing: a
  // workspace switch is reachable WITH the palette still open (dropping a folder
  // onto the window bubbles to App's onDrop → workspace.use, and the palette
  // isn't closed), and without this the File rows would keep the previous
  // workspace's paths — clicking one would open a missing/wrong file in the now
  // -active workspace. `files` is cleared synchronously on the switch so no stale
  // row is even briefly clickable (mirrors the Search-row workspace gate below).
  const [files, setFiles] = useState<readonly FileEntry[]>([]);
  useEffect(() => {
    if (!open) return;
    setFiles([]);
    // No active workspace → no files to list (badge.list would have nothing to
    // resolve against). Referencing `current` here also makes it the explicit
    // re-fetch trigger it's meant to be.
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = (await window.bh.run('badge.list')) as {
          badges: { file: string; prompt?: string }[];
        };
        if (cancelled) return;
        setFiles(
          result.badges.map((b) => ({
            file: b.file,
            ...(b.prompt !== undefined && { prompt: b.prompt }),
          })),
        );
      } catch {
        // Don't block the palette on a transient core error — just show
        // workspaces / views / chrome actions until the user retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  const [query, setQuery] = useState('');
  // Debounced full-text content search. Fires only once the user pauses (180ms)
  // on a query of ≥2 chars in a real workspace — so we don't read every file's
  // bytes on each keystroke. Stale results are guarded by the `cancelled` flag
  // plus the `hitsQuery` gate where the rows are built.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (current === null || q.length < 2) {
      setContentHits([]);
      setHitsQuery('');
      setHitsWorkspace(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = (await window.bh.run('search.query', {
            query: q,
            maxFiles: 8,
            maxMatchesPerFile: 1,
          })) as SearchQueryResult;
          if (cancelled) return;
          setContentHits(res.hits);
          setHitsQuery(q);
          setHitsWorkspace(current);
        } catch {
          if (!cancelled) {
            setContentHits([]);
            setHitsQuery('');
            setHitsWorkspace(null);
          }
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, current]);
  // Content-search results (async, debounced). The hits belong to a specific
  // (workspace, query) pair: `hitsQuery` guards a slower search returning after
  // the user typed more, and `hitsWorkspace` guards reopening the palette in a
  // DIFFERENT workspace with the same query — without it, stale rows from the
  // previous workspace would show (and open a wrong/missing path) until the new
  // debounced search returns.
  const [contentHits, setContentHits] = useState<SearchQueryResult['hits']>([]);
  const [hitsQuery, setHitsQuery] = useState('');
  const [hitsWorkspace, setHitsWorkspace] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Whether the user is currently steering with the mouse. Linear /
  // VS Code-style palettes ignore hover-driven selection until the mouse
  // actually moves, so opening the palette while the pointer happens to
  // overlap a row doesn't yank selection away from row 0. Flipped true
  // by onMouseMove inside the card; flipped back to false on any nav
  // keystroke (and on each open).
  const [mouseActive, setMouseActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build the action list from current store state + fetched files.
  // Memoized on (workspaces, views, files, current) so typing doesn't
  // rebuild — only filtering changes per keystroke.
  const actions = useMemo<Action[]>(() => {
    const out: Action[] = [];

    // Workspaces — switch.
    for (const ws of workspaces) {
      if (ws.name === current) continue; // already active, skip
      out.push({
        id: `ws:${ws.name}`,
        label: ws.name,
        hint: tildifyPath(ws.path),
        category: 'Workspace',
        run: () => void use(ws.name),
      });
    }

    // Views — switch.
    if (current !== null) {
      out.push({
        id: 'view:__main__',
        label: 'Main canvas',
        category: 'View',
        run: () => {
          setCurrentView(null);
          setFolderScope(null);
        },
      });
      for (const v of views) {
        out.push({
          id: `view:${v.id}`,
          label: v.name,
          hint: `${v.members.length} badge${v.members.length === 1 ? '' : 's'}`,
          category: 'View',
          run: () => {
            setCurrentView(v.id);
            setFolderScope(null);
          },
        });
      }
    }

    // Files — open in preview. Sort by recency-then-alphabetical so the
    // file the user opened 30 seconds ago is the FIRST file row even
    // when their workspace has 100+ alphabetically-earlier files.
    const recent = current !== null ? recentFilesFor(current) : [];
    const recentRank = new Map<string, number>();
    recent.forEach((path, idx) => recentRank.set(path, idx));
    const sortedFiles = [...files].sort((a, b) => {
      const ra = recentRank.get(a.file);
      const rb = recentRank.get(b.file);
      if (ra !== undefined && rb !== undefined) return ra - rb; // both recent → by recency
      if (ra !== undefined) return -1; // a recent, b not → a first
      if (rb !== undefined) return 1; // b recent, a not → b first
      return a.file.localeCompare(b.file); // neither recent → alphabetical
    });
    for (const f of sortedFiles) {
      const basename = f.file.includes('/') ? (f.file.split('/').pop() ?? f.file) : f.file;
      out.push({
        id: `file:${f.file}`,
        label: basename,
        hint: f.file.includes('/') ? f.file : undefined,
        category: 'File',
        // Searchable-but-not-displayed: match the user's prompt for this
        // file so they can find it by typing words from their own
        // description. Empty when the user hasn't written a prompt yet.
        ...(f.prompt !== undefined && f.prompt.length > 0 && { searchAlso: f.prompt }),
        run: () => setCurrentFile(f.file),
      });
    }

    // Chrome actions — always available.
    out.push({
      id: 'action:add-folder',
      label: 'Add folder…',
      category: 'Action',
      run: () => void pickAndAdd(),
    });
    out.push({
      id: 'action:try-demo',
      label: 'Try a demo workspace…',
      hint: '~/BaseHalf-Demo',
      category: 'Action',
      run: () => void createDemoAtDefault(),
    });
    if (current !== null) {
      out.push({
        id: 'action:new-note',
        label: 'New note…',
        category: 'Action',
        shortcut: `${MOD}N`,
        run: () => void promptForNewNote(),
      });
      out.push({
        id: 'action:new-view',
        label: 'New view…',
        category: 'Action',
        shortcut: `${MOD}${SHIFT}N`,
        run: () => void promptForNewView(),
      });
    }

    return out;
  }, [
    workspaces,
    current,
    views,
    files,
    use,
    setCurrentView,
    setFolderScope,
    setCurrentFile,
    pickAndAdd,
  ]);

  // Filter actions by query (case-insensitive substring match on label,
  // hint, or category). Keeps it dead simple — no fuzzy distance yet.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const haystack =
        `${a.category} ${a.label} ${a.hint ?? ''} ${a.searchAlso ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [actions, query]);

  // Content matches → Search rows, appended below the instant name/prompt
  // matches. Gated on hitsQuery === current query so we never show snippets for
  // a stale query, and deduped against files already shown above (a file that
  // matched by NAME shouldn't appear twice).
  const contentActions = useMemo<Action[]>(() => {
    const q = query.trim();
    // Only show hits that belong to the CURRENT (workspace, query) pair.
    if (q.length < 2 || hitsQuery !== q || hitsWorkspace !== current) return [];
    const shownFiles = new Set(
      filtered.filter((a) => a.category === 'File').map((a) => a.id.slice('file:'.length)),
    );
    const out: Action[] = [];
    for (const hit of contentHits) {
      if (shownFiles.has(hit.file)) continue;
      const basename = hit.file.includes('/') ? (hit.file.split('/').pop() ?? hit.file) : hit.file;
      const snippet = hit.matches[0]?.text;
      out.push({
        id: `search:${hit.file}`,
        label: basename,
        category: 'Search',
        ...(hit.file.includes('/') && { hint: hit.file }),
        ...(snippet !== undefined && snippet.length > 0 && { sub: snippet }),
        run: () => setCurrentFile(hit.file),
      });
    }
    return out;
  }, [contentHits, hitsQuery, hitsWorkspace, current, query, filtered, setCurrentFile]);

  // The full navigable list: instant matches first, then content matches.
  const rows = useMemo(() => [...filtered, ...contentActions], [filtered, contentActions]);

  // Reset state each time we open. Also focus the input so the user
  // can type immediately.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
    setMouseActive(false);
    // Defer focus to next microtask so the input is mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Keep selectedIdx in bounds as the row list shrinks.
  useEffect(() => {
    if (selectedIdx >= rows.length) {
      setSelectedIdx(Math.max(0, rows.length - 1));
    }
  }, [rows, selectedIdx]);

  // Scroll the selected row into view on arrow-nav.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-bh-palette-idx="${selectedIdx}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedIdx]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMouseActive(false);
      setSelectedIdx((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMouseActive(false);
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = rows[selectedIdx];
      if (picked) {
        setOpen(false);
        // Run after close so the palette is gone before the action
        // takes the user somewhere (e.g. opens a dialog).
        queueMicrotask(picked.run);
      }
    } else if (e.key === 'Tab') {
      // Input-driven palette: arrows navigate the list, so Tab has no job
      // here — trap it so focus can't leak to the chrome behind the modal
      // backdrop (mirrors Dialog's trap intent). Home/End are deliberately
      // left to the search input for text-cursor movement.
      e.preventDefault();
    }
  };

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        style={cardStyle}
        onKeyDown={handleKeyDown}
        onMouseMove={() => {
          if (!mouseActive) setMouseActive(true);
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(0);
          }}
          placeholder="Switch workspace, open a file, run an action…"
          style={inputStyle}
          data-testid="command-palette-input"
        />
        <div ref={listRef} style={listStyle} role="listbox">
          {rows.length === 0 ? (
            <div style={emptyStyle}>No matches for "{query}"</div>
          ) : (
            rows.map((a, idx) => (
              <PaletteRow
                key={a.id}
                action={a}
                idx={idx}
                selected={idx === selectedIdx}
                onHover={() => {
                  if (mouseActive) setSelectedIdx(idx);
                }}
                onClick={() => {
                  setOpen(false);
                  queueMicrotask(a.run);
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const PaletteRow = ({
  action,
  idx,
  selected,
  onHover,
  onClick,
}: {
  action: Action;
  idx: number;
  selected: boolean;
  onHover: () => void;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    role="option"
    aria-selected={selected}
    data-bh-palette-idx={idx}
    onMouseEnter={onHover}
    onClick={onClick}
    style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      padding: `${space[1.5]}px ${space[2]}px`,
      background: selected ? color.accentSofter : 'transparent',
      border: 'none',
      borderRadius: radius.sm,
      cursor: 'pointer',
      textAlign: 'left',
      fontFamily: font.sans,
      fontSize: font.size.ui,
      color: color.textPrimary,
      transition: transition(['background']),
    }}
  >
    <span
      style={{
        fontSize: font.size.micro,
        color: color.textTertiary,
        letterSpacing: font.trackedCaps,
        textTransform: 'uppercase',
        fontWeight: font.weight.medium,
        minWidth: 72,
      }}
    >
      {action.category}
    </span>
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: selected ? color.accent : color.textPrimary,
          fontWeight: selected ? font.weight.medium : font.weight.regular,
        }}
      >
        {action.label}
      </span>
      {action.sub && (
        // Search rows: the matching snippet, so you can see WHY the file
        // matched. Mono because it's a slice of file content.
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: color.textTertiary,
            fontSize: font.size.micro,
            fontFamily: font.mono,
          }}
        >
          {action.sub}
        </span>
      )}
    </span>
    {action.hint && (
      <span
        style={{
          color: color.textTertiary,
          fontSize: font.size.caption,
          fontFamily:
            action.category === 'File' || action.category === 'Workspace' ? font.mono : font.sans,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 240,
          flexShrink: 0,
        }}
      >
        {action.hint}
      </span>
    )}
    {action.shortcut && (
      <span
        style={{
          color: color.textSecondary,
          fontSize: font.size.micro,
          fontFamily: font.sans,
          fontWeight: font.weight.medium,
          background: color.surfaceMuted,
          border: `1px solid ${color.divider}`,
          padding: '2px 6px',
          borderRadius: radius.sm,
          flexShrink: 0,
          letterSpacing: 0.3,
        }}
      >
        {action.shortcut}
      </span>
    )}
  </button>
);

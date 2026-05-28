/**
 * CommandPalette — Linear-style fuzzy launcher.
 *
 * Cmd/Ctrl+K opens; users type to filter across:
 *   - Workspaces (switch active workspace)
 *   - Saved views (switch active view; main-canvas option)
 *   - Files (open any file in the current workspace by basename)
 *   - Chrome actions (Add folder, New note)
 *
 * Arrow keys navigate, Enter executes, Esc closes, click-outside
 * closes. The whole component is a modal backdrop + a centered card
 * with the same design tokens as the rest of the chrome (Dialog,
 * Select, etc.) so it doesn't read as a separate sub-product.
 */

import { type CSSProperties, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import {
  createDemoAtDefault,
  promptForNewNote,
  promptForNewView,
  tildifyPath,
} from '../lib/actions.js';
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
  /** Short category prefix (Workspace, View, File, Action) shown left. */
  category: 'Workspace' | 'View' | 'File' | 'Action';
  /** Optional keyboard shortcut hint (e.g. "⌘N") rendered as a small
   *  pill on the right so users discover the global shortcuts by
   *  browsing the palette. */
  shortcut?: string;
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

  // Files in the current workspace — fetched lazily when the palette
  // opens so we don't pay the cost on every render of the host App.
  // Cached for the lifetime of the open session; closes & reopens
  // refresh in case the user added files via Finder in between.
  const [files, setFiles] = useState<readonly FileEntry[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = (await window.bh.run('badge.list')) as { badges: { file: string }[] };
        if (cancelled) return;
        setFiles(result.badges.map((b) => ({ file: b.file })));
      } catch {
        // Don't block the palette on a transient core error — just show
        // workspaces / views / chrome actions until the user retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
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

    // Files — open in preview.
    for (const f of files) {
      const basename = f.file.includes('/') ? (f.file.split('/').pop() ?? f.file) : f.file;
      out.push({
        id: `file:${f.file}`,
        label: basename,
        hint: f.file.includes('/') ? f.file : undefined,
        category: 'File',
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
      const haystack = `${a.category} ${a.label} ${a.hint ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [actions, query]);

  // Reset state each time we open. Also focus the input so the user
  // can type immediately.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
    // Defer focus to next microtask so the input is mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Keep selectedIdx in bounds as the filtered list shrinks.
  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered, selectedIdx]);

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
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = filtered[selectedIdx];
      if (picked) {
        setOpen(false);
        // Run after close so the palette is gone before the action
        // takes the user somewhere (e.g. opens a dialog).
        queueMicrotask(picked.run);
      }
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
      <div style={cardStyle} onKeyDown={handleKeyDown}>
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
          {filtered.length === 0 ? (
            <div style={emptyStyle}>No matches for "{query}"</div>
          ) : (
            filtered.map((a, idx) => (
              <PaletteRow
                key={a.id}
                action={a}
                idx={idx}
                selected={idx === selectedIdx}
                onHover={() => setSelectedIdx(idx)}
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
    <span
      style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: selected ? color.accent : color.textPrimary,
        fontWeight: selected ? font.weight.medium : font.weight.regular,
      }}
    >
      {action.label}
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

/**
 * CommandPalette — an editor-style fuzzy command launcher.
 *
 * Cmd/Ctrl+K opens; users type to filter across:
 *   - Workspaces (switch active workspace)
 *   - Files (open any file in the current workspace by basename / path / prompt)
 *   - Chrome actions (Add folder, New note)
 *   - Search (files whose CONTENT matches — full-text, async + debounced)
 *
 * Empty-state behavior mirrors editor quick-open (⌘P): opening the palette
 * does NOT dump the whole workspace — it shows only the few most-recently
 * opened files (an onboarding fallback when none exist). The full file set is
 * surfaced only once the user types, ranked by a real fuzzy score (see
 * fuzzyScore.ts) so the CLOSEST match floats to the top — `cmdpal` finds
 * `CommandPalette.tsx`, not just literal substring hits. The Search section is
 * the retrieval leg that lets you find a note by a phrase you remember from
 * INSIDE it, not just its filename. So ⌘K is "find anything."
 *
 * Arrow keys navigate, Enter executes, Esc closes, click-outside
 * closes. The whole component is a modal backdrop + a centered card
 * with the same design tokens as the rest of the chrome (Dialog,
 * Select, etc.) so it doesn't read as a separate sub-product.
 */

import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { openSettings } from '../../contrib/preferences/browser/Settings.js';
import { createBranchGitAdapter } from '../../contrib/scm/browser/branchGitAdapter.js';
import { checkoutBranchWithRecovery } from '../../contrib/scm/browser/branchQuickPickCommands.js';
import { gitScmService } from '../../contrib/scm/browser/gitScmService.js';
import { useGitStatusStore } from '../../contrib/scm/browser/gitStatusStore.js';
import { scmErrorMessage } from '../../contrib/scm/browser/scmCommandModel.js';
import { useScmViewStore } from '../../contrib/scm/browser/scmViewStore.js';
import type { GitRefInfo } from '../../contrib/scm/common/git.js';
import { useWorkspaceStore } from '../../services/workspace/browser/workspaceStore.js';
import { createDemoAtDefault, promptForNewNote, tildifyPath } from '../actions/workbenchActions.js';
import { useLayoutStore } from '../layout/layoutStore.js';
import { prompt } from '../parts/dialogs/Dialog.js';
import { toast } from '../parts/notifications/toastStore.js';
import { color, font, motion, radius, shadow, space } from '../style/design.js';
import { isImeComposing } from '../ui/imeGuard.js';
import { CommandPaletteRow } from './CommandPaletteRow.js';
import {
  useCommandPaletteContentSearch,
  useCommandPaletteFiles,
  useCommandPaletteGitState,
} from './commandPaletteData.js';
import {
  type CommandPaletteAction as Action,
  type IMatch,
  filterCommandPaletteActions,
  moveCommandPaletteSelection,
  reconcileCommandPaletteSelection,
} from './commandPaletteModel.js';
import {
  buildCommandPaletteActions,
  buildContentSearchActions,
  buildGitEntityActions,
  combineCommandPaletteRows,
} from './commandPaletteProviders.js';
import {
  closeCommandPalette,
  isCommandPaletteOpen,
  openCommandPalette,
  useCommandPaletteStore,
} from './commandPaletteStore.js';

export { closeCommandPalette, isCommandPaletteOpen, openCommandPalette };

// ── Git-mode helpers: drive the SCM view from a palette action ────────────────
/** Open the sidebar's Source Control view and expand the given section. */
function showSourceControl(section: 'changes' | 'graph'): void {
  useLayoutStore.getState().setSidebarOpen(true);
  useLayoutStore.getState().setSidebarView('scm');
  if (section === 'graph') useScmViewStore.getState().setGraphOpen(true);
  else useScmViewStore.getState().setChangesOpen(true);
}
/** Open SCM ▸ Graph and reveal a specific commit (⌘K "jump to commit"). */
function revealCommitInGraph(hash: string): void {
  useLayoutStore.getState().setSidebarOpen(true);
  useLayoutStore.getState().setSidebarView('scm');
  useScmViewStore.getState().revealCommit(hash);
}
/** Run a git mutation from the palette, then refresh the SCM status from disk. */
async function runGit(fn: () => Promise<unknown>): Promise<void> {
  await fn();
  await useGitStatusStore.getState().refresh();
}

// Workspace management (rename / remove) deliberately does NOT live here — those
// are rare, destructive ops, and the palette's job is the everyday loop (open a
// file). They live in the File menu (see workbenchActions.ts).

// Mac uses ⌘ / ⇧; everything else uses Ctrl / Shift to match what
// Workbench contributions actually listen for.
const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

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

const paletteListId = 'bh-command-palette-list';
const optionIdForIndex = (idx: number): string => `bh-command-palette-option-${idx}`;

export const CommandPalette = (): JSX.Element | null => {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const use = useWorkspaceStore((s) => s.use);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);

  const { files, filesWorkspace } = useCommandPaletteFiles(open, current);
  const [query, setQuery] = useState('');
  const { contentHits, hitsQuery, hitsWorkspace } = useCommandPaletteContentSearch(
    open,
    current,
    query,
  );
  const { gitRepo, gitBranches, gitCommits, gitWorkspace } = useCommandPaletteGitState(
    open,
    current,
  );
  const checkoutPaletteBranch = useCallback(
    (branch: GitRefInfo, refs: readonly GitRefInfo[]): void => {
      void checkoutBranchWithRecovery(createBranchGitAdapter(gitScmService), branch, refs, () =>
        useGitStatusStore.getState().refresh(),
      ).catch((err) => toast.error(scmErrorMessage(err)));
    },
    [],
  );

  const [selectedIdx, setSelectedIdx] = useState(0);
  // Whether the user is currently steering with the mouse. A good command
  // palette ignores hover-driven selection until the mouse actually moves,
  // so opening the palette while the pointer happens to
  // overlap a row doesn't yank selection away from row 0. Flipped true
  // by onMouseMove inside the card; flipped back to false on any nav
  // keystroke (and on each open).
  const [mouseActive, setMouseActive] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusElementRef = useRef<HTMLElement | null>(null);
  const selectedActionIdRef = useRef<string | null>(null);

  // Build the action list from current store state + fetched files.
  // Memoized on (workspaces, views, files, current) so typing doesn't
  // rebuild — only filtering changes per keystroke.
  const actions = useMemo<Action[]>(
    () =>
      buildCommandPaletteActions({
        workspaces,
        current,
        files,
        filesWorkspace,
        git: {
          repo: gitRepo,
          workspace: gitWorkspace,
          branches: gitBranches,
          commits: gitCommits,
        },
        modifierLabel: MOD,
        tildifyPath,
        useWorkspace: (name) => void use(name),
        openFile: openInPanel,
        pickAndAdd: () => void pickAndAdd(),
        createDemo: () => void createDemoAtDefault(),
        newNote: () => void useWorkspaceStore.getState().newNote(),
        promptForNewNote: () => void promptForNewNote(),
        openSettings,
        showSourceControl,
        openGitGraph: () => useWorkspaceStore.getState().openGitGraph(),
        promptCreateBranch: () =>
          prompt({
            title: 'Create Branch',
            label: 'Branch name',
            placeholder: 'feature/x',
          }),
        runGit: (fn) => void runGit(fn),
        gitService: gitScmService,
      }),
    [
      workspaces,
      current,
      files,
      filesWorkspace,
      use,
      openInPanel,
      pickAndAdd,
      gitRepo,
      gitWorkspace,
      gitBranches,
      gitCommits,
    ],
  );

  // The visible name/prompt rows + the highlight ranges for each row's label.
  // Two modes:
  //   - Empty query  → editor ⌘P quick-open: just the recent files (capped), so opening
  //                    the palette doesn't dump the whole tree. No workspace /
  //                    nothing-opened-yet falls back to the chrome actions so
  //                    the palette is never a dead end.
  //   - Typed query  → fuzzy-score every action against the query (label, path,
  //                    and the user's prompt), drop non-matches, rank by score
  //                    (best first), tie-break recent-then-alphabetical.
  // `matchMap` carries the label's matched-char ranges so the row can bold
  // exactly the characters that matched (only for fuzzy rows; content/Search
  // rows keep substring highlight).
  const { filtered, matchMap } = useMemo<{
    filtered: Action[];
    matchMap: Map<string, IMatch[]>;
  }>(() => filterCommandPaletteActions({ actions, query, current }), [actions, query, current]);

  // Content matches → Search rows, appended below the instant name/prompt
  // matches. Gated on hitsQuery === current query so we never show snippets for
  // a stale query, and deduped against files already shown above (a file that
  // matched by NAME shouldn't appear twice).
  const contentActions = useMemo<Action[]>(
    () =>
      buildContentSearchActions({
        contentHits,
        hitsQuery,
        hitsWorkspace,
        current,
        query,
        filtered,
        openFile: openInPanel,
      }),
    [contentHits, hitsQuery, hitsWorkspace, current, query, filtered, openInPanel],
  );

  // Git entities — branches (switch) + commits (jump to graph) matching the typed
  // query. Like content search, these are typed-only (an empty query shows the
  // quick-open recents, not every branch/commit) and workspace-guarded.
  const gitMatches = useMemo<Action[]>(
    () =>
      buildGitEntityActions({
        query,
        current,
        git: {
          repo: gitRepo,
          workspace: gitWorkspace,
          branches: gitBranches,
          commits: gitCommits,
        },
        gitService: gitScmService,
        runGit: (fn) => void runGit(fn),
        checkoutBranch: checkoutPaletteBranch,
        revealCommit: revealCommitInGraph,
      }),
    [query, current, gitRepo, gitWorkspace, gitBranches, gitCommits, checkoutPaletteBranch],
  );

  // The full navigable list: instant matches first, then content + git matches.
  const rows = useMemo(
    () => combineCommandPaletteRows(filtered, contentActions, gitMatches),
    [filtered, contentActions, gitMatches],
  );
  const activeOptionId =
    rows[selectedIdx] !== undefined ? optionIdForIndex(selectedIdx) : undefined;

  const restorePreviousFocus = useCallback(() => {
    const active = document.activeElement;
    const card = cardRef.current;
    const previous = previousFocusElementRef.current;
    previousFocusElementRef.current = null;
    if (!(active instanceof HTMLElement) || !card?.contains(active)) return;
    if (previous?.isConnected) {
      previous.focus({ preventScroll: true });
    }
  }, []);

  const closePalette = useCallback(() => {
    restorePreviousFocus();
    setOpen(false);
  }, [restorePreviousFocus, setOpen]);

  const runAndClose = useCallback(
    (action: Action) => {
      closePalette();
      // Run after close so the palette is gone before the action takes the user
      // somewhere else or opens a follow-up dialog.
      queueMicrotask(action.run);
    },
    [closePalette],
  );

  // Reset state each time we open. Also focus the input so the user
  // can type immediately.
  useEffect(() => {
    if (!open) return;
    previousFocusElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setSelectedIdx(0);
    selectedActionIdRef.current = null;
    setMouseActive(false);
    // Defer focus until the input is mounted.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Keep selectedIdx in bounds and preserve the selected row by id as async
  // result sources merge in.
  useEffect(() => {
    const nextIdx = reconcileCommandPaletteSelection(
      rows,
      selectedIdx,
      selectedActionIdRef.current,
    );
    if (nextIdx !== selectedIdx) {
      setSelectedIdx(nextIdx);
    }
    selectedActionIdRef.current = rows[nextIdx]?.id ?? null;
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
    // Mid-IME-composition, Enter confirms a candidate and Esc cancels it — don't
    // run a row or close the palette under the user's pinyin selection.
    if (isImeComposing(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMouseActive(false);
      setSelectedIdx((i) => {
        const nextIdx = moveCommandPaletteSelection(i, rows.length, 1);
        selectedActionIdRef.current = rows[nextIdx]?.id ?? null;
        return nextIdx;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMouseActive(false);
      setSelectedIdx((i) => {
        const nextIdx = moveCommandPaletteSelection(i, rows.length, -1);
        selectedActionIdRef.current = rows[nextIdx]?.id ?? null;
        return nextIdx;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = rows[selectedIdx];
      if (picked) {
        runAndClose(picked);
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
        if (e.target === e.currentTarget) closePalette();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        ref={cardRef}
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
            selectedActionIdRef.current = null;
            setSelectedIdx(0);
          }}
          placeholder="Switch workspace, open a file, run an action…"
          style={inputStyle}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={paletteListId}
          aria-expanded="true"
          aria-activedescendant={activeOptionId}
          aria-label="Command palette"
          data-testid="command-palette-input"
        />
        <div id={paletteListId} ref={listRef} style={listStyle} role="listbox" aria-label="Results">
          {rows.length === 0 ? (
            <div style={emptyStyle} role="status">
              No matches for "{query}"
            </div>
          ) : (
            rows.map((a, idx) => (
              <CommandPaletteRow
                key={a.id}
                id={optionIdForIndex(idx)}
                action={a}
                idx={idx}
                selected={idx === selectedIdx}
                query={query.trim()}
                labelMatches={matchMap.get(a.id)}
                onHover={() => {
                  if (mouseActive) {
                    selectedActionIdRef.current = a.id;
                    setSelectedIdx(idx);
                  }
                }}
                onClick={() => {
                  runAndClose(a);
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

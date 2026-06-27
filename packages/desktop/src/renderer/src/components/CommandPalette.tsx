/**
 * CommandPalette — an editor-style fuzzy command launcher.
 *
 * Cmd/Ctrl+K (or ⌘S) opens; users type to filter across:
 *   - Workspaces (switch active workspace)
 *   - Files (open any file in the current workspace by basename / path / prompt)
 *   - Chrome actions (Add folder, New note)
 *   - Search (files whose CONTENT matches — full-text, async + debounced)
 *
 * Empty-state behavior mirrors editor quick-open (⌘P): opening the palette
 * does NOT dump the whole workspace — it shows only the few most-recently
 * opened files (an onboarding fallback when none exist). The full file set is
 * surfaced only once the user types, ranked by a real fuzzy score (see
 * lib/fuzzyScore.ts) so the CLOSEST match floats to the top — `cmdpal` finds
 * `CommandPalette.tsx`, not just literal substring hits. The Search section is
 * the retrieval leg that lets you find a note by a phrase you remember from
 * INSIDE it, not just its filename. So ⌘K is "find anything."
 *
 * Arrow keys navigate, Enter executes, Esc closes, click-outside
 * closes. The whole component is a modal backdrop + a centered card
 * with the same design tokens as the rest of the chrome (Dialog,
 * Select, etc.) so it doesn't read as a separate sub-product.
 */

/** Empty-state quick-open shows at most this many recent files (⌘P pattern). */
const EMPTY_RECENT_CAP = 8;

import type {
  GitBranchesResult,
  GitLogResult,
  GitStatusResult,
  SearchQueryResult,
} from '@basehalf/core';
import { type CSSProperties, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { createDemoAtDefault, promptForNewNote, tildifyPath } from '../lib/actions.js';
import { type IMatch, createMatches, fuzzyMatch } from '../lib/fuzzyScore.js';
import { highlightSegments } from '../lib/highlight.js';
import { isImeComposing } from '../lib/imeGuard.js';
import { recentFilesFor } from '../lib/recent-files.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useLayoutStore } from '../store/layout.js';
import { useScmViewStore } from '../store/scmView.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { prompt } from './Dialog.js';
import { openSettings } from './Settings.js';

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

export function isCommandPaletteOpen(): boolean {
  return usePaletteStore.getState().open;
}

export function closeCommandPalette(): void {
  usePaletteStore.getState().setOpen(false);
}

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
async function runGit(name: string, args: Record<string, unknown> = {}): Promise<void> {
  await window.bh.run(name, args);
  await useGitStatusStore.getState().refresh();
}

// Workspace management (rename / remove) deliberately does NOT live here — those
// are rare, destructive ops, and the palette's job is the everyday loop (open a
// file). They live in the File menu (see lib/actions.ts).

interface Action {
  /** Stable id used as React key and for navigation focus. */
  id: string;
  /** Primary label shown in the row. */
  label: string;
  /** Optional secondary text shown on the right (path, count, etc.). */
  hint?: string;
  /** Short category prefix (Workspace, File, Action, Git, Search) shown left. */
  category: 'Workspace' | 'File' | 'Action' | 'Git' | 'Search';
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
  const use = useWorkspaceStore((s) => s.use);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);

  // Files in the current workspace — fetched lazily when the palette opens (so
  // we don't pay the cost on every render of the host App) AND whenever the
  // active workspace changes. Re-fetching on `current` is load-bearing: a
  // workspace switch is reachable WITH the palette still open (dropping a folder
  // onto the window bubbles to App's onDrop → workspace.use, and the palette
  // isn't closed). `files` carries the workspace it was fetched for; the File
  // rows are gated on `filesWorkspace === current` in the actions memo, exactly
  // like the Search rows — so a stale (previous-workspace) File row is never
  // rendered, not even for the single commit between `current` flipping and this
  // effect re-fetching. Clicking a File row could otherwise open a missing/wrong
  // path in the now-active workspace (the same class as the gated Search bug).
  const [files, setFiles] = useState<readonly FileEntry[]>([]);
  const [filesWorkspace, setFilesWorkspace] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setFilesWorkspace(null);
    // No active workspace → no files to list. Referencing `current` here also
    // makes it the explicit re-fetch trigger it's meant to be.
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        // The full file list comes from the FILESYSTEM (every supported file),
        // since badges are now a sparse overlay (only annotated files have one) —
        // badge.list alone would miss most files. We ALSO read the (sparse, cheap)
        // badge.list to overlay prompts, so search-by-prompt still works for the
        // files that have one.
        const [filesRes, badgesRes] = (await Promise.all([
          window.bh.run('workspace.listSupportedFiles', { folder: null }),
          window.bh.run('badge.list', {}),
        ])) as [{ files: string[] }, { badges: { path: string; description?: string }[] }];
        if (cancelled) return;
        const prompts = new Map(
          badgesRes.badges
            .filter((b) => b.description !== undefined)
            .map((b) => [b.path, b.description as string]),
        );
        setFiles(
          filesRes.files.map((file) => {
            const prompt = prompts.get(file);
            return prompt !== undefined ? { file, prompt } : { file };
          }),
        );
        setFilesWorkspace(current);
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
  // on a query of ≥3 chars in a real workspace — so we don't read every file's
  // bytes on each keystroke, and 1–2 char queries (which match nearly every
  // file) never flood the list with low-signal content rows. Name/path/prompt
  // fuzzy matching still fires from the first character. Stale results are
  // guarded by the `cancelled` flag plus the `hitsQuery` gate where the rows
  // are built.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (current === null || q.length < 3) {
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

  // Git state for the palette's Git mode — repo flag + branches + recent commits,
  // fetched once when the palette opens (and re-fetched on a workspace switch).
  // `gitWorkspace` guards rows from a previous workspace, like `filesWorkspace`.
  const [gitRepo, setGitRepo] = useState(false);
  const [gitBranches, setGitBranches] = useState<GitBranchesResult['branches']>([]);
  const [gitCommits, setGitCommits] = useState<GitLogResult['commits']>([]);
  const [gitWorkspace, setGitWorkspace] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setGitRepo(false);
    setGitBranches([]);
    setGitCommits([]);
    setGitWorkspace(null);
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = (await window.bh.run('git.status', {})) as GitStatusResult;
        if (cancelled) return;
        setGitRepo(status.isRepo);
        if (!status.isRepo) {
          setGitWorkspace(current);
          return;
        }
        const [branches, log] = (await Promise.all([
          window.bh.run('git.branches', {}),
          window.bh.run('git.log', { maxCount: 60 }),
        ])) as [GitBranchesResult, GitLogResult];
        if (cancelled) return;
        setGitBranches(branches.branches);
        setGitCommits(log.commits);
        setGitWorkspace(current);
      } catch {
        // A non-repo / transient git error just leaves the Git rows empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  // Whether the user is currently steering with the mouse. A good command
  // palette ignores hover-driven selection until the mouse actually moves,
  // so opening the palette while the pointer happens to
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

    // Files — open in preview. Only when `files` was fetched for the CURRENTLY
    // active workspace: on a workspace switch with the palette open, `current`
    // flips a commit before the re-fetch effect runs, and emitting rows from the
    // old workspace's `files` here would render stale paths that open the wrong
    // file. This synchronous (files,current) gate mirrors the Search-row gate.
    // Sort by recency-then-alphabetical so the file the user opened 30 seconds
    // ago is the FIRST file row even in a 100+-file workspace.
    if (filesWorkspace === current && current !== null) {
      const recent = recentFilesFor(current);
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
          run: () => openInPanel(f.file, { pinned: true }),
        });
      }
    }

    // Chrome actions — always available.
    out.push({
      id: 'action:add-folder',
      label: 'Add folder…',
      category: 'Action',
      run: () => void pickAndAdd(),
    });
    if (current === null) {
      // Welcome-only: once a real workspace is open, "try the demo" is
      // noise competing with the actual workflow actions.
      out.push({
        id: 'action:try-demo',
        label: 'Try a demo workspace…',
        hint: '~/BaseHalf-Demo',
        category: 'Action',
        run: () => void createDemoAtDefault(),
      });
    }
    if (current !== null) {
      // Primary "New note" is INSTANT — a real untitled-N.md opens for typing,
      // no filename dialog. The path-choosing dialog survives as the
      // secondary, for the "I know exactly where this goes" case.
      out.push({
        id: 'action:new-note',
        label: 'New note',
        category: 'Action',
        shortcut: `${MOD}N`,
        run: () => void useWorkspaceStore.getState().newNote(),
      });
      out.push({
        id: 'action:new-note-at-path',
        label: 'New note at path…',
        category: 'Action',
        run: () => void promptForNewNote(),
      });
    }
    out.push({
      id: 'action:settings',
      label: 'Settings…',
      category: 'Action',
      shortcut: `${MOD},`,
      run: openSettings,
    });

    // Git command actions — fuzzy-findable by "git", "branch", "push", … Gated on
    // a confirmed repo for the CURRENT workspace (else the rows would act on the
    // wrong/stale repo). A non-repo offers only Initialize.
    if (gitWorkspace === current && current !== null) {
      if (!gitRepo) {
        out.push({
          id: 'git:init',
          label: 'Git: Initialize Repository',
          category: 'Git',
          run: () => void runGit('git.init'),
        });
      } else {
        const G = (id: string, label: string, run: () => void): Action => ({
          id,
          label,
          category: 'Git',
          searchAlso: 'git',
          run,
        });
        out.push(
          G('git:create-branch', 'Git: Create Branch…', () => {
            // Electron has no window.prompt — use the app's custom prompt dialog.
            void prompt({ title: '新建分支', label: '分支名', placeholder: 'feature/x' }).then(
              (n) => {
                const name = n?.trim();
                if (name) void runGit('git.createBranch', { name });
              },
            );
          }),
          G('git:commit', 'Git: Commit…', () => showSourceControl('changes')),
          G('git:graph', 'Git: Show Commit Graph', () => showSourceControl('graph')),
          G('git:stage-all', 'Git: Stage All Changes', () => void runGit('git.stageAll')),
          G('git:unstage-all', 'Git: Unstage All Changes', () => void runGit('git.unstageAll')),
          G('git:stash', 'Git: Stash Changes', () => void runGit('git.stash')),
          G('git:stash-pop', 'Git: Pop Latest Stash', () => void runGit('git.stashPop')),
          G('git:amend', 'Git: Amend Last Commit…', () => showSourceControl('changes')),
          G('git:push', 'Git: Push', () => void runGit('git.push')),
          G('git:pull', 'Git: Pull', () => void runGit('git.pull')),
          G('git:fetch', 'Git: Fetch', () => void runGit('git.fetch')),
        );
      }
    }

    return out;
  }, [
    workspaces,
    current,
    files,
    filesWorkspace,
    use,
    openInPanel,
    pickAndAdd,
    gitRepo,
    gitWorkspace,
  ]);

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
  }>(() => {
    const q = query.trim();
    const fileId = (a: Action): string => a.id.slice('file:'.length);

    if (q.length === 0) {
      // No active workspace, or a workspace with no opened files yet → show the
      // workspace switches + chrome actions instead of an empty list.
      const fallback = (): Action[] => actions.filter((a) => a.category !== 'File');
      if (current === null) return { filtered: fallback(), matchMap: new Map() };
      const rank = new Map(recentFilesFor(current).map((p, i) => [p, i] as const));
      const recents = actions
        .filter((a) => a.category === 'File' && rank.has(fileId(a)))
        .sort((a, b) => (rank.get(fileId(a)) ?? 0) - (rank.get(fileId(b)) ?? 0))
        .slice(0, EMPTY_RECENT_CAP);
      const rows = recents.length > 0 ? recents : fallback();
      return { filtered: rows, matchMap: new Map() };
    }

    // Typed → score against label / path / prompt; keep the best, plus the
    // label's match ranges for highlighting. We DON'T score against category
    // (typing "file" shouldn't flood every file row).
    const matchMap = new Map<string, IMatch[]>();
    const scored: { action: Action; score: number }[] = [];
    for (const a of actions) {
      const labelScore = fuzzyMatch(q, a.label);
      // Prefer a label hit on ties — it's what the user reads first.
      let score = labelScore ? labelScore[0] + 1 : Number.NEGATIVE_INFINITY;
      for (const field of [a.hint, a.searchAlso]) {
        if (field === undefined || field.length === 0) continue;
        const s = fuzzyMatch(q, field);
        if (s && s[0] > score) score = s[0];
      }
      if (score === Number.NEGATIVE_INFINITY) continue; // matched nothing
      if (labelScore) matchMap.set(a.id, createMatches(labelScore));
      scored.push({ action: a, score });
    }

    const rank =
      current !== null
        ? new Map(recentFilesFor(current).map((p, i) => [p, i] as const))
        : new Map<string, number>();
    scored.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      const rx = x.action.category === 'File' ? rank.get(fileId(x.action)) : undefined;
      const ry = y.action.category === 'File' ? rank.get(fileId(y.action)) : undefined;
      if (rx !== undefined && ry !== undefined) return rx - ry;
      if (rx !== undefined) return -1;
      if (ry !== undefined) return 1;
      return x.action.label.localeCompare(y.action.label);
    });
    return { filtered: scored.map((s) => s.action), matchMap };
  }, [actions, query, current]);

  // Content matches → Search rows, appended below the instant name/prompt
  // matches. Gated on hitsQuery === current query so we never show snippets for
  // a stale query, and deduped against files already shown above (a file that
  // matched by NAME shouldn't appear twice).
  const contentActions = useMemo<Action[]>(() => {
    const q = query.trim();
    // Only show hits that belong to the CURRENT (workspace, query) pair.
    if (q.length < 3 || hitsQuery !== q || hitsWorkspace !== current) return [];
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
        // Open AT the match: pass the query so the MD editor jumps to + flashes
        // the passage instead of landing at the top.
        run: () => openInPanel(hit.file, { pinned: true, matchQuery: q }),
      });
    }
    return out;
  }, [contentHits, hitsQuery, hitsWorkspace, current, query, filtered, openInPanel]);

  // Git entities — branches (switch) + commits (jump to graph) matching the typed
  // query. Like content search, these are typed-only (an empty query shows the
  // quick-open recents, not every branch/commit) and workspace-guarded.
  const gitMatches = useMemo<Action[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0 || gitWorkspace !== current || !gitRepo) return [];
    const out: Action[] = [];
    for (const b of gitBranches) {
      if (!b.name.toLowerCase().includes(q)) continue;
      out.push({
        id: `git:branch:${b.name}`,
        label: b.name,
        category: 'Git',
        hint: b.current ? '当前分支' : '切换到此分支',
        searchAlso: 'branch 分支',
        run: () => {
          if (!b.current) void runGit('git.checkout', { branch: b.name });
        },
      });
      if (out.length >= 6) break;
    }
    let commitCount = 0;
    for (const c of gitCommits) {
      if (commitCount >= 8) break;
      if (!c.subject.toLowerCase().includes(q) && !c.shortHash.toLowerCase().includes(q)) continue;
      commitCount++;
      out.push({
        id: `git:commit:${c.hash}`,
        label: c.subject,
        hint: c.shortHash,
        category: 'Git',
        sub: c.author.name,
        searchAlso: `commit ${c.shortHash}`,
        run: () => revealCommitInGraph(c.hash),
      });
    }
    return out;
  }, [query, gitWorkspace, current, gitRepo, gitBranches, gitCommits]);

  // The full navigable list: instant matches first, then content + git matches.
  const rows = useMemo(
    () => [...filtered, ...contentActions, ...gitMatches],
    [filtered, contentActions, gitMatches],
  );

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
    // Mid-IME-composition, Enter confirms a candidate and Esc cancels it — don't
    // run a row or close the palette under the user's pinyin selection.
    if (isImeComposing(e)) return;
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
                query={query.trim()}
                labelMatches={matchMap.get(a.id)}
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

/**
 * Render `text` with runs matching `query` marked (accent + semibold), so a row
 * shows WHERE it matched — scannable in both the label and the content snippet.
 * `<mark>` (background neutralized) keeps the relevance semantics for AT.
 */
function renderHighlighted(text: string, query: string): JSX.Element {
  const segments = highlightSegments(text, query);
  // Key by each segment's character offset in the string — stable + unique, and
  // not the array index (so it survives the lint + any future re-split).
  let offset = 0;
  const nodes = segments.map((seg) => {
    const key = offset;
    offset += seg.text.length;
    return seg.match ? (
      <mark
        key={key}
        style={{
          background: 'transparent',
          color: color.accent,
          fontWeight: font.weight.semibold,
        }}
      >
        {seg.text}
      </mark>
    ) : (
      <span key={key}>{seg.text}</span>
    );
  });
  return <>{nodes}</>;
}

/**
 * Highlight the exact characters a fuzzy match landed on (`matches` are
 * char-offset ranges from createMatches), so a row shows WHERE the typed
 * characters hit — even when they're non-contiguous (`cmdpal` → **C**o**md**…).
 * Same accent + semibold mark as the substring path for visual consistency.
 */
function renderFuzzyHighlighted(text: string, matches: IMatch[]): JSX.Element {
  if (matches.length === 0) return <>{text}</>;
  const nodes: JSX.Element[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) nodes.push(<span key={pos}>{text.slice(pos, m.start)}</span>);
    nodes.push(
      <mark
        key={m.start}
        style={{ background: 'transparent', color: color.accent, fontWeight: font.weight.semibold }}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    pos = m.end;
  }
  if (pos < text.length) nodes.push(<span key={pos}>{text.slice(pos)}</span>);
  return <>{nodes}</>;
}

const PaletteRow = ({
  action,
  idx,
  selected,
  query,
  labelMatches,
  onHover,
  onClick,
}: {
  action: Action;
  idx: number;
  selected: boolean;
  query: string;
  /** Fuzzy-match ranges on the label (typed-query rows). Absent on empty-state
   *  and content/Search rows, which fall back to substring highlight. */
  labelMatches?: IMatch[];
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
        {labelMatches !== undefined
          ? renderFuzzyHighlighted(action.label, labelMatches)
          : renderHighlighted(action.label, query)}
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
          {renderHighlighted(action.sub, query)}
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

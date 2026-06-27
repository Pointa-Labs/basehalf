import type { GitStashEntry, GitStatusResult } from '@basehalf/core';
import { useCallback, useState } from 'react';
import type { GitGroups, GitRow } from '../../lib/gitStatus.js';
import { useScmViewStore } from '../../store/scmView.js';
import { toast } from '../../store/toast.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import { prompt } from '../Dialog.js';
import type { CommitActionOptions } from './types.js';

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface UseScmCommandsArgs {
  readonly status: GitStatusResult | null;
  readonly groups: GitGroups;
  readonly message: string;
  readonly setMessage: (message: string) => void;
  readonly hasStaged: boolean;
  readonly refresh: () => Promise<void> | void;
  readonly loadStashes: () => Promise<void> | void;
}

export interface ScmCommands {
  readonly busy: boolean;
  readonly error: string | null;
  readonly runAction: (name: string) => void;
  readonly initRepository: () => void;
  readonly openRow: (row: GitRow) => void;
  readonly stage: (paths: string[]) => Promise<void>;
  readonly unstage: (paths: string[]) => Promise<void>;
  readonly discard: (row: GitRow) => void;
  readonly discardMany: (rows: readonly GitRow[]) => void;
  readonly discardAll: () => void;
  readonly commit: (options?: CommitActionOptions) => void;
  readonly createBranchPrompt: () => void;
  readonly createPullRequest: () => void;
  readonly sync: () => void;
  readonly pullRebase: () => void;
  readonly pushForce: () => void;
  readonly undoLastCommit: () => void;
  readonly openFullGraph: () => void;
  readonly revealHead: () => void;
  readonly applyStash: (ref: GitStashEntry['ref']) => void;
  readonly popStash: (ref?: GitStashEntry['ref']) => void;
  readonly dropStash: (ref: GitStashEntry['ref']) => void;
}

export const useScmCommands = ({
  status,
  groups,
  message,
  setMessage,
  hasStaged,
  refresh,
  loadStashes,
}: UseScmCommandsArgs): ScmCommands => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const openGitDiff = useWorkspaceStore((s) => s.openGitDiff);
  const openMerge = useWorkspaceStore((s) => s.openMerge);

  // Run a git action, surface failures as a transient toast (VS Code-style), then
  // re-read status from disk truth. `error` is kept only for init/no-repo screens;
  // everyday action errors are toasts, not permanent panel chrome.
  const act = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      try {
        await fn();
        await refresh();
        await loadStashes();
      } catch (err) {
        const m = msg(err);
        setError(m);
        toast.error(m);
      } finally {
        setBusy(false);
      }
    },
    [refresh, loadStashes],
  );

  const runAction = useCallback(
    (name: string): void => void act(() => window.bh.run(name, {})),
    [act],
  );

  const initRepository = useCallback(
    (): void => void act(() => window.bh.run('git.init', {})),
    [act],
  );

  // Clicking a row: a conflict opens the 3-way merge editor (VS Code), an untracked
  // file (no baseline) opens directly, everything else opens its diff.
  const openRow = useCallback(
    (row: GitRow): void => {
      if (row.conflict) openMerge(row.path);
      else if (row.untracked) openInPanel(row.path);
      else openGitDiff(row.path, row.staged);
    },
    [openGitDiff, openInPanel, openMerge],
  );

  const stage = useCallback(
    (paths: string[]): Promise<void> => act(() => window.bh.run('git.stage', { paths })),
    [act],
  );

  const unstage = useCallback(
    (paths: string[]): Promise<void> => act(() => window.bh.run('git.unstage', { paths })),
    [act],
  );

  const discard = useCallback(
    (row: GitRow): void => {
      // Accurate, action-specific wording: an untracked file goes to the OS Trash
      // (recoverable); a tracked discard is a hard revert to HEAD (not recoverable).
      const warning = row.untracked
        ? `Move “${row.path}” to the Trash?\n\nIt’s untracked — recoverable from the Trash.`
        : `Discard changes in “${row.path}”?\n\nThis reverts to the last commit and can’t be undone.`;
      if (!window.confirm(warning)) return;
      void act(() => {
        if (!row.untracked) return window.bh.run('git.discard', { paths: [row.path] });
        // Untracked files/dirs aren't git's to restore — trash them. A dir arrives as
        // "dir/" (git collapses it); strip the slash + flag it a folder so its `.bh/`
        // mirror subtree gets purged too, not left dangling.
        const isDir = row.path.endsWith('/');
        return window.bh.run('workspace.deleteEntry', {
          path: isDir ? row.path.slice(0, -1) : row.path,
          kind: isDir ? 'folder' : 'file',
        });
      });
    },
    [act],
  );

  const discardMany = useCallback(
    (rows: readonly GitRow[]): void => {
      if (rows.length === 0) return;
      if (rows.length === 1) {
        discard(rows[0] as GitRow);
        return;
      }
      if (!window.confirm(`Discard ${rows.length} selected unstaged change(s)?`)) return;
      void act(async () => {
        const tracked = rows.filter((row) => !row.untracked).map((row) => row.path);
        if (tracked.length > 0) await window.bh.run('git.discard', { paths: tracked });
        for (const row of rows.filter((entry) => entry.untracked)) {
          const isDir = row.path.endsWith('/');
          await window.bh.run('workspace.deleteEntry', {
            path: isDir ? row.path.slice(0, -1) : row.path,
            kind: isDir ? 'folder' : 'file',
          });
        }
      });
    },
    [act, discard],
  );

  const discardAll = useCallback((): void => {
    if (groups.changes.length === 0) return;
    if (
      !window.confirm(
        `Discard all ${groups.changes.length} unstaged change(s)? This is IRREVERSIBLE.`,
      )
    ) {
      return;
    }
    void act(async () => {
      const tracked = groups.changes.filter((row) => !row.untracked).map((row) => row.path);
      if (tracked.length > 0) await window.bh.run('git.discard', { paths: tracked });
      for (const row of groups.changes.filter((entry) => entry.untracked)) {
        const isDir = row.path.endsWith('/');
        await window.bh.run('workspace.deleteEntry', {
          path: isDir ? row.path.slice(0, -1) : row.path,
          kind: isDir ? 'folder' : 'file',
        });
      }
    });
  }, [act, groups.changes]);

  // Commit, optionally followed by push or sync — the VS Code
  // "Commit & Push" / "Commit & Sync" split-button actions.
  const commit = useCallback(
    (options: CommitActionOptions = {}): void => {
      const trimmed = message.trim();
      if (trimmed === '') return;
      if (options.amend !== true && !hasStaged) return;
      void act(async () => {
        await window.bh.run('git.commit', { message: trimmed, amend: options.amend === true });
        setMessage('');
        if (options.after === 'push') await window.bh.run('git.push', {});
        else if (options.after === 'sync') await window.bh.run('git.sync', {});
      });
    },
    [act, hasStaged, message, setMessage],
  );

  const createBranchPrompt = useCallback(
    (): void =>
      void (async () => {
        // Electron has no window.prompt — use the app's custom prompt dialog.
        const name = (
          await prompt({ title: 'Create Branch', label: 'Branch name', placeholder: 'feature/x' })
        )?.trim();
        if (name) void act(() => window.bh.run('git.createBranch', { name }));
      })(),
    [act],
  );

  // Open GitHub's "create PR" page for the current branch. GitHub-specific
  // remote selection and URL shaping live in core's provider module.
  const createPullRequest = useCallback(
    (): void =>
      void (async () => {
        const branch = status?.branch;
        if (!branch) {
          toast.error('A current branch is required to create a pull request.');
          return;
        }
        try {
          const result = (await window.bh.run('github.createPullRequestUrl', { branch })) as {
            url: string | null;
          };
          if (result.url === null) {
            toast.error('No GitHub remote is configured.');
            return;
          }
          const res = await window.bh.openExternal(result.url);
          if (!res.ok) toast.error(res.error ?? 'Failed to open the browser.');
        } catch (err) {
          toast.error(msg(err));
        }
      })(),
    [status?.branch],
  );

  const sync = useCallback((): void => void act(() => window.bh.run('git.sync', {})), [act]);

  const pullRebase = useCallback(
    (): void => void act(() => window.bh.run('git.pull', { rebase: true })),
    [act],
  );

  const pushForce = useCallback(
    (): void => void act(() => window.bh.run('git.push', { force: true })),
    [act],
  );

  const undoLastCommit = useCallback(
    (): void => void act(() => window.bh.run('git.reset', { ref: 'HEAD~1', mode: 'soft' })),
    [act],
  );

  const openFullGraph = useCallback((): void => {
    useWorkspaceStore.getState().openGitGraph();
  }, []);

  // GRAPH header "Go to Current History Item" (VS Code) — reveal HEAD in the graph.
  const revealHead = useCallback(
    (): void =>
      void (async () => {
        try {
          const result = (await window.bh.run('git.log', { maxCount: 1 })) as {
            commits: { hash: string }[];
          };
          const head = result.commits[0]?.hash;
          if (head !== undefined) useScmViewStore.getState().revealCommit(head);
        } catch {
          /* no HEAD yet */
        }
      })(),
    [],
  );

  const applyStash = useCallback(
    (ref: GitStashEntry['ref']): void => void act(() => window.bh.run('git.stashApply', { ref })),
    [act],
  );

  const popStash = useCallback(
    (ref?: GitStashEntry['ref']): void =>
      void act(() => window.bh.run('git.stashPop', ref !== undefined ? { ref } : {})),
    [act],
  );

  const dropStash = useCallback(
    (ref: GitStashEntry['ref']): void => {
      if (window.confirm(`Delete stash ${ref}? This is IRREVERSIBLE.`)) {
        void act(() => window.bh.run('git.stashDrop', { ref }));
      }
    },
    [act],
  );

  return {
    busy,
    error,
    runAction,
    initRepository,
    openRow,
    stage,
    unstage,
    discard,
    discardMany,
    discardAll,
    commit,
    createBranchPrompt,
    createPullRequest,
    sync,
    pullRebase,
    pushForce,
    undoLastCommit,
    openFullGraph,
    revealHead,
    applyStash,
    popStash,
    dropStash,
  };
};

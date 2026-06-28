import { useCallback, useRef, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { confirm, pick, prompt } from '../../../browser/parts/dialogs/Dialog.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import {
  type GithubPullRequestService,
  githubPullRequestService,
} from '../../githubPullRequests/browser/githubPullRequestService.js';
import type { GitStashEntry, GitStatusResult } from '../common/git.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import type { GitGroups, GitRow } from './gitStatusModel.js';
import {
  type DiscardPlan,
  applyDiscardPlan,
  commitPlan,
  discardManyPrompt,
  discardPlan,
  discardRowPrompt,
  dropStashPrompt,
  runScmAction,
  scmErrorMessage,
} from './scmCommandModel.js';
import { useScmViewStore } from './scmViewStore.js';
import type { CommitActionOptions } from './types.js';

interface UseScmCommandsArgs {
  readonly status: GitStatusResult | null;
  readonly groups: GitGroups;
  readonly message: string;
  readonly setMessage: (message: string) => void;
  readonly hasStaged: boolean;
  readonly refresh: () => Promise<void> | void;
  readonly loadStashes: () => Promise<void> | void;
  readonly gitService?: GitScmService;
  readonly githubService?: GithubPullRequestService;
  readonly openExternal?: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface ScmCommands {
  readonly busy: boolean;
  readonly error: string | null;
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
  readonly pull: () => void;
  readonly push: () => void;
  readonly fetch: () => void;
  readonly stash: () => void;
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
  gitService: git = gitScmService,
  githubService = githubPullRequestService,
  openExternal = (url) => nativeHostService.openExternal(url),
}: UseScmCommandsArgs): ScmCommands => {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const openGitDiff = useWorkspaceStore((s) => s.openGitDiff);
  const openMerge = useWorkspaceStore((s) => s.openMerge);

  const setActionBusy = useCallback((next: boolean): void => {
    busyRef.current = next;
    setBusy(next);
  }, []);

  // Run a git action, surface failures as a transient toast (VS Code-style), then
  // re-read status from disk truth. `error` is kept only for init/no-repo screens;
  // everyday action errors are toasts, not permanent panel chrome.
  const act = useCallback(
    (fn: () => Promise<unknown>): Promise<void> => {
      if (busyRef.current) return Promise.resolve();
      return runScmAction(fn, {
        setBusy: setActionBusy,
        setError,
        refresh,
        loadStashes,
        toastError: toast.error,
      });
    },
    [refresh, loadStashes, setActionBusy],
  );

  const confirmDiscardPlan = useCallback(
    async (rows: readonly GitRow[]): Promise<DiscardPlan | null> => {
      const plan = discardPlan(rows);
      const tracked = plan.trackedPaths.length;
      const untracked = plan.untrackedEntries.length;

      if (tracked > 0 && untracked > 0) {
        const choice = await pick({
          title: 'Discard Selected Changes',
          placeholder: 'Choose what to discard',
          options: [
            {
              value: 'tracked',
              label: `Discard ${tracked} tracked change(s)`,
              detail: 'Revert tracked files to the last commit. Untracked files stay on disk.',
            },
            {
              value: 'all',
              label: `Discard all ${rows.length} selected change(s)`,
              detail: 'Revert tracked files and move untracked files or folders to the Trash.',
            },
          ],
        });
        if (choice === null) return null;
        if (choice === 'tracked') {
          const ok = await confirm({
            title: 'Discard Tracked Changes',
            body: discardManyPrompt({ trackedPaths: plan.trackedPaths, untrackedEntries: [] }),
            confirmText: 'Discard Changes',
            destructive: true,
          });
          return ok ? { trackedPaths: plan.trackedPaths, untrackedEntries: [] } : null;
        }
      }

      const ok = await confirm({
        title: tracked > 0 ? 'Discard Changes' : 'Move Files to Trash',
        body: discardManyPrompt(plan),
        confirmText:
          tracked > 0 && untracked > 0
            ? 'Discard All'
            : tracked > 0
              ? 'Discard Changes'
              : 'Move to Trash',
        destructive: true,
      });
      return ok ? plan : null;
    },
    [],
  );

  const actOnDiscardRows = useCallback(
    (rows: readonly GitRow[]): void =>
      void (async () => {
        const plan = await confirmDiscardPlan(rows);
        if (plan !== null) void act(() => applyDiscardPlan(plan, git));
      })(),
    [act, confirmDiscardPlan, git],
  );

  const actOnDiscardAll = useCallback(
    (): void =>
      void (async () => {
        const plan = await confirmDiscardPlan(groups.changes);
        if (plan !== null) void act(() => applyDiscardPlan(plan, git));
      })(),
    [act, confirmDiscardPlan, git, groups.changes],
  );

  const initRepository = useCallback((): void => void act(() => git.init()), [act, git]);

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
    (paths: string[]): Promise<void> => act(() => git.stage(paths)),
    [act, git],
  );

  const unstage = useCallback(
    (paths: string[]): Promise<void> => act(() => git.unstage(paths)),
    [act, git],
  );

  const discard = useCallback(
    (row: GitRow): void => {
      void (async () => {
        const ok = await confirm({
          title: row.untracked ? 'Move File to Trash' : 'Discard Changes',
          body: discardRowPrompt(row),
          confirmText: row.untracked ? 'Move to Trash' : 'Discard Changes',
          destructive: true,
        });
        if (ok) void act(() => applyDiscardPlan(discardPlan([row]), git));
      })();
    },
    [act, git],
  );

  const discardMany = useCallback(
    (rows: readonly GitRow[]): void => {
      if (rows.length === 0) return;
      if (rows.length === 1) {
        discard(rows[0] as GitRow);
        return;
      }
      actOnDiscardRows(rows);
    },
    [actOnDiscardRows, discard],
  );

  const discardAll = useCallback((): void => {
    if (groups.changes.length === 0) return;
    actOnDiscardAll();
  }, [actOnDiscardAll, groups.changes.length]);

  // Commit, optionally followed by push or sync — the VS Code
  // "Commit & Push" / "Commit & Sync" split-button actions.
  const commit = useCallback(
    (options: CommitActionOptions = {}): void => {
      const plan = commitPlan(message, options, hasStaged);
      if (plan === null) return;
      void act(async () => {
        await git.commit(plan.message, { amend: plan.amend });
        setMessage('');
        if (plan.after === 'push') await git.push();
        else if (plan.after === 'sync') await git.sync();
      });
    },
    [act, git, hasStaged, message, setMessage],
  );

  const createBranchPrompt = useCallback(
    (): void =>
      void (async () => {
        // Electron has no window.prompt — use the app's custom prompt dialog.
        const name = (
          await prompt({ title: 'Create Branch', label: 'Branch name', placeholder: 'feature/x' })
        )?.trim();
        if (name) void act(() => git.createBranch(name));
      })(),
    [act, git],
  );

  // Open GitHub's "create PR" page for the current branch. GitHub-specific
  // remote selection and URL shaping stay behind the GitHub provider service.
  const createPullRequest = useCallback(
    (): void =>
      void (async () => {
        const branch = status?.branch;
        if (!branch) {
          toast.error('A current branch is required to create a pull request.');
          return;
        }
        try {
          const url = await githubService.createPullRequestUrl(branch);
          if (url === null) {
            toast.error('No GitHub remote is configured.');
            return;
          }
          const res = await openExternal(url);
          if (!res.ok) toast.error(res.error ?? 'Failed to open the browser.');
        } catch (err) {
          toast.error(scmErrorMessage(err));
        }
      })(),
    [githubService, openExternal, status?.branch],
  );

  const hasUpstream =
    status !== null &&
    status.detached !== true &&
    status.branch !== null &&
    status.upstream !== null;
  const pullUnavailableMessage =
    'The current branch has no upstream branch. Use Publish Branch first.';

  const pull = useCallback((): void => {
    if (!hasUpstream) {
      toast.info(pullUnavailableMessage);
      return;
    }
    void act(() => git.pull());
  }, [act, git, hasUpstream]);

  const push = useCallback((): void => void act(() => git.push()), [act, git]);

  const fetch = useCallback((): void => void act(() => git.fetch()), [act, git]);

  const stash = useCallback((): void => void act(() => git.stash()), [act, git]);

  const sync = useCallback((): void => void act(() => git.sync()), [act, git]);

  const pullRebase = useCallback((): void => {
    if (!hasUpstream) {
      toast.info(pullUnavailableMessage);
      return;
    }
    void act(() => git.pull({ rebase: true }));
  }, [act, git, hasUpstream]);

  const pushForce = useCallback((): void => void act(() => git.push({ force: true })), [act, git]);

  const undoLastCommit = useCallback(
    (): void => void act(() => git.reset({ ref: 'HEAD~1', mode: 'soft' })),
    [act, git],
  );

  const openFullGraph = useCallback((): void => {
    useWorkspaceStore.getState().openGitGraph();
  }, []);

  // GRAPH header "Go to Current History Item" (VS Code) — reveal HEAD in the graph.
  const revealHead = useCallback(
    (): void =>
      void (async () => {
        try {
          const result = await git.log({ maxCount: 1 });
          const head = result.commits[0]?.hash;
          if (head !== undefined) useScmViewStore.getState().revealCommit(head);
        } catch {
          /* no HEAD yet */
        }
      })(),
    [git],
  );

  const applyStash = useCallback(
    (ref: GitStashEntry['ref']): void => void act(() => git.stashApply(ref)),
    [act, git],
  );

  const popStash = useCallback(
    (ref?: GitStashEntry['ref']): void => void act(() => git.stashPop(ref)),
    [act, git],
  );

  const dropStash = useCallback(
    (ref: GitStashEntry['ref']): void => {
      if (window.confirm(dropStashPrompt(ref))) {
        void act(() => git.stashDrop(ref));
      }
    },
    [act, git],
  );

  return {
    busy,
    error,
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
    pull,
    push,
    fetch,
    stash,
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

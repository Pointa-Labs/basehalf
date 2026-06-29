import { useCallback } from 'react';
import { confirm } from '../../../../platform/dialogs/browser/dialogService.js';
import { pick } from '../../../../platform/quickinput/browser/quickInputService.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import type { GitGroups, GitRow } from '../common/gitStatusModel.js';
import type { GitScmService } from './gitScmService.js';
import {
  type DiscardPlan,
  type ScmActionRunner,
  applyDiscardPlan,
  discardManyPrompt,
  discardPlan,
  discardRowPrompt,
} from './scmCommandModel.js';

export interface ScmResourceCommands {
  readonly initRepository: () => void;
  readonly openRow: (row: GitRow) => void;
  readonly stage: (paths: string[]) => Promise<void>;
  readonly unstage: (paths: string[]) => Promise<void>;
  readonly discard: (row: GitRow) => void;
  readonly discardMany: (rows: readonly GitRow[]) => void;
  readonly discardAll: () => void;
}

export function useScmResourceCommands({
  act,
  git,
  groups,
}: {
  readonly act: ScmActionRunner;
  readonly git: GitScmService;
  readonly groups: GitGroups;
}): ScmResourceCommands {
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const openGitDiff = useWorkspaceStore((s) => s.openGitDiff);
  const openMerge = useWorkspaceStore((s) => s.openMerge);

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

  // Clicking a row: a conflict opens the 3-way merge editor (VS Code), an
  // untracked file opens directly, everything else opens its diff.
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

  return {
    initRepository,
    openRow,
    stage,
    unstage,
    discard,
    discardMany,
    discardAll,
  };
}

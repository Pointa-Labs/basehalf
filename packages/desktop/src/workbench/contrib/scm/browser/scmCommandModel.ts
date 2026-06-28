import type { GitStashEntry } from '../common/git.js';
import { type GitScmService, entryKindForGitPath } from './gitScmService.js';
import type { GitRow } from './gitStatusModel.js';
import type { CommitActionOptions } from './types.js';

type MaybePromise = Promise<void> | void;

export interface ScmActionEffects {
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (message: string) => void;
  readonly toastError: (message: string) => void;
  readonly refresh: () => MaybePromise;
  readonly loadStashes: () => MaybePromise;
}

export interface DiscardPlan {
  readonly trackedPaths: readonly string[];
  readonly untrackedEntries: readonly { path: string; kind: 'file' | 'folder' }[];
}

export interface CommitPlan {
  readonly message: string;
  readonly amend: boolean;
  readonly after?: CommitActionOptions['after'];
}

export const scmErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export async function runScmAction(
  action: () => Promise<unknown>,
  effects: ScmActionEffects,
): Promise<void> {
  effects.setBusy(true);
  try {
    await action();
    await effects.refresh();
    await effects.loadStashes();
  } catch (err) {
    const message = scmErrorMessage(err);
    await effects.refresh();
    await effects.loadStashes();
    effects.setError(message);
    effects.toastError(message);
  } finally {
    effects.setBusy(false);
  }
}

export function discardRowPrompt(row: GitRow): string {
  return row.untracked
    ? `Move “${row.path}” to the Trash?\n\nIt’s untracked — recoverable from the Trash.`
    : `Discard changes in “${row.path}”?\n\nThis reverts to the last commit and can’t be undone.`;
}

export function discardManyPrompt(plan: DiscardPlan): string {
  const tracked = plan.trackedPaths.length;
  const untracked = plan.untrackedEntries.length;
  const parts: string[] = [];
  if (tracked > 0) {
    parts.push(
      `This will permanently discard changes in ${tracked} tracked file(s). Tracked changes cannot be undone.`,
    );
  }
  if (untracked > 0) {
    parts.push(`This will move ${untracked} untracked file/folder(s) to the Trash.`);
  }
  return parts.join('\n\n');
}

export function discardAllPrompt(count: number): string {
  return `Discard all ${count} unstaged change(s)? This is IRREVERSIBLE.`;
}

export function dropStashPrompt(ref: GitStashEntry['ref']): string {
  return `Delete stash ${ref}? This is IRREVERSIBLE.`;
}

export function discardPlan(rows: readonly GitRow[]): DiscardPlan {
  const trackedPaths: string[] = [];
  const untrackedEntries: Array<{ path: string; kind: 'file' | 'folder' }> = [];
  for (const row of rows) {
    if (row.untracked) {
      untrackedEntries.push(entryKindForGitPath(row.path));
    } else {
      trackedPaths.push(row.path);
    }
  }
  return { trackedPaths, untrackedEntries };
}

export async function applyDiscardPlan(
  plan: DiscardPlan,
  git: Pick<GitScmService, 'discard' | 'deleteWorkspaceEntry'>,
): Promise<void> {
  if (plan.trackedPaths.length > 0) await git.discard(plan.trackedPaths);
  for (const entry of plan.untrackedEntries) {
    await git.deleteWorkspaceEntry(entry.path, entry.kind);
  }
}

export function commitPlan(
  message: string,
  options: CommitActionOptions,
  hasStaged: boolean,
): CommitPlan | null {
  const trimmed = message.trim();
  if (trimmed === '') return null;
  const amend = options.amend === true;
  if (!amend && !hasStaged) return null;
  return {
    message: trimmed,
    amend,
    ...(options.after !== undefined && { after: options.after }),
  };
}

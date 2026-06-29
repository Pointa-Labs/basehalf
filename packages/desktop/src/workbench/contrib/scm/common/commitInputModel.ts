import type { CommitActionOptions } from './commitTypes.js';

export const COMMIT_MESSAGE_HISTORY_LIMIT = 100;

export function commitInputPlaceholder(branch: string, commitKey: string): string {
  return branch !== ''
    ? `Message (${commitKey} to commit on "${branch}")`
    : `Message (${commitKey} to commit)`;
}

export function commitInputHeight(
  scrollHeight: number,
  minHeight: number,
  maxHeight: number,
): number {
  return Math.min(Math.max(scrollHeight, minHeight), maxHeight);
}

export function nextCommitHistoryState({
  cursor,
  direction,
  history,
}: {
  readonly cursor: number | null;
  readonly direction: 1 | -1;
  readonly history: readonly string[];
}): { readonly cursor: number | null; readonly message: string } | null {
  if (history.length === 0) return null;
  const end = history.length;
  const current = cursor ?? end;
  const index = Math.max(0, Math.min(end, current + direction));
  return {
    cursor: index === end ? null : index,
    message: index === end ? '' : (history[index] ?? ''),
  };
}

export function recordCommitMessage(
  history: readonly string[],
  message: string,
): readonly string[] {
  const trimmed = message.trim();
  if (trimmed === '') return history;
  return [...history.filter((entry) => entry !== trimmed), trimmed].slice(
    -COMMIT_MESSAGE_HISTORY_LIMIT,
  );
}

export function validateCommitInput(
  message: string,
  options: CommitActionOptions,
  hasStaged: boolean,
): string | null {
  if (message.trim() === '') return 'Please provide a commit message.';
  if (options.amend !== true && !hasStaged) return 'There are no staged changes to commit.';
  return null;
}

import type { CommitActionOptions } from './commitTypes.js';

export interface CommitPlan {
  readonly message: string;
  readonly amend: boolean;
  readonly after?: CommitActionOptions['after'];
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

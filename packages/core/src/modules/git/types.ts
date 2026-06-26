// Public arg/result types for the `git.*` commands. The desktop SCM panel
// narrows window.bh.run results against these.

/**
 * One changed path from `git status`. `x` is the INDEX (staged) status char and
 * `y` the WORK-TREE status char — the porcelain v1 XY pair (`' '` = unchanged on
 * that side). A file can be non-empty on BOTH (e.g. x='M', y='M' → staged AND
 * unstaged edits), so the panel splits it into the Staged and Changes groups.
 * `orig` is the source path for a rename/copy.
 */
export interface GitFileStatus {
  readonly path: string;
  readonly x: string;
  readonly y: string;
  readonly orig?: string;
}

export interface GitStatusResult {
  /** False when the workspace folder isn't inside a git repo (panel → "Initialize"). */
  readonly isRepo: boolean;
  /** Current branch, or null when detached HEAD / no commits yet. */
  readonly branch: string | null;
  readonly detached: boolean;
  /** Upstream ref (e.g. "origin/main"), or null when none / gone. */
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly files: readonly GitFileStatus[];
}

export interface GitPathsArgs {
  /** Workspace-relative POSIX paths (the status output paths). */
  readonly paths: readonly string[];
}

export interface GitCommitArgs {
  readonly message: string;
  /** Rewrite the previous commit instead of creating a new one. */
  readonly amend?: boolean;
}

export interface GitCommitResult {
  readonly committed: boolean;
}

export interface GitBranchInfo {
  readonly name: string;
  readonly current: boolean;
}

export interface GitBranchesResult {
  readonly branches: readonly GitBranchInfo[];
  readonly current: string | null;
}

export interface GitCheckoutArgs {
  readonly branch: string;
  /** Create the branch (git checkout -b) before switching to it. */
  readonly create?: boolean;
}

export interface GitDiffArgs {
  readonly path: string;
  /** Diff the staged version (index vs HEAD) instead of working-tree vs index. */
  readonly staged?: boolean;
}

export interface GitDiffResult {
  readonly diff: string;
}

export interface GitShowArgs {
  /** A git ref/treeish: "HEAD", a branch, a SHA, or ":" for the index. */
  readonly ref: string;
  readonly path: string;
}

export interface GitShowResult {
  /** The file's content at `ref`, or null when it doesn't exist there. */
  readonly content: string | null;
}

/** A remote/long operation (push/pull/fetch) — surfaces git's own output so the
 *  panel can show "Already up to date" etc. Throws (GitError) on failure. */
export interface GitRemoteResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitOkResult {
  readonly ok: boolean;
}

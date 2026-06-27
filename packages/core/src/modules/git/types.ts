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
  /** True for a remote-tracking branch (e.g. "origin/feat") when includeRemote. */
  readonly remote?: boolean;
}

export interface GitBranchesArgs {
  /** Also list remote-tracking branches (refs/remotes, minus each remote's HEAD). */
  readonly includeRemote?: boolean;
}

export interface GitBranchesResult {
  readonly branches: readonly GitBranchInfo[];
  readonly current: string | null;
}

export interface GitStashArgs {
  /** Optional stash message (`git stash push -m`). */
  readonly message?: string;
}

export interface GitStashResult {
  /** False when there was nothing to stash. */
  readonly stashed: boolean;
}

/** Target a specific stash entry (e.g. "stash@{1}"); omit for the latest. */
export interface GitStashRefArgs {
  readonly ref?: string;
}

export interface GitStashEntry {
  /** The stash ref, e.g. "stash@{0}". */
  readonly ref: string;
  readonly message: string;
  /** The stash commit's own SHA. */
  readonly hash: string;
  /** Parent SHAs; the first is the base commit the stash was taken from. */
  readonly parents: readonly string[];
  /** Committer date (ISO 8601). */
  readonly date: string;
  readonly authorName: string;
  readonly authorEmail: string;
}

export interface GitStashListResult {
  readonly entries: readonly GitStashEntry[];
}

export interface GitRevertArgs {
  /** The commit to revert (a SHA / "HEAD" / ref). */
  readonly ref: string;
}

export interface GitTagArgs {
  /** New tag name. */
  readonly name: string;
  /** Commit to tag (a SHA / ref); defaults to HEAD. */
  readonly ref?: string;
}

export interface GitTagDeleteArgs {
  readonly name: string;
}

export interface GitCherryPickArgs {
  /** The commit to cherry-pick onto the current branch. */
  readonly ref: string;
}

export interface GitCherryPickResult {
  readonly applied: boolean;
  /** True when it stopped on conflicts to resolve. */
  readonly conflicts: boolean;
}

export interface GitResetArgs {
  /** The commit to reset HEAD to (a SHA / ref). */
  readonly ref: string;
  /** `--soft` (keep index + tree), `--mixed` (default, keep tree), `--hard` (discard). */
  readonly mode?: 'soft' | 'mixed' | 'hard';
}

export interface GitRevertResult {
  readonly reverted: boolean;
  /** True when the revert stopped on conflicts to resolve. */
  readonly conflicts: boolean;
}

export interface GitPushArgs {
  /** Force-push with `--force-with-lease` (VS Code's "Push (Force)" — the safe
   *  variant that refuses to clobber unseen upstream commits). */
  readonly force?: boolean;
}

export interface GitPullArgs {
  /** `pull --rebase` instead of a merge pull (VS Code's "Pull (Rebase)"). */
  readonly rebase?: boolean;
}

export interface GitRemoteUrlArgs {
  /** Remote name; defaults to "origin". */
  readonly remote?: string;
}

export interface GitRemoteUrlResult {
  /** The remote's fetch URL, or null when the remote doesn't exist. */
  readonly url: string | null;
}

export interface GitConflictStagesArgs {
  readonly path: string;
}

/** The three merge stages of a conflicted file (git index stages 1/2/3). Any can
 *  be null — an add/add conflict has no base; a delete/modify lacks a side. The
 *  3-way merge editor shows ours ↔ theirs with base as the common ancestor. */
export interface GitConflictStagesResult {
  readonly base: string | null;
  readonly ours: string | null;
  readonly theirs: string | null;
}

export interface GitCheckoutArgs {
  readonly branch: string;
  /** Create the branch (git checkout -b) before switching to it. */
  readonly create?: boolean;
}

export interface GitCreateBranchArgs {
  /** New branch name (validated against git's refname rules before use). */
  readonly name: string;
  /** Start point (a ref/SHA); defaults to the current HEAD. */
  readonly ref?: string;
  /** Switch to the new branch after creating it (default true). */
  readonly checkout?: boolean;
}

export interface GitDeleteBranchArgs {
  readonly name: string;
  /** `-D` (force) instead of `-d` — delete even if not fully merged. */
  readonly force?: boolean;
}

export interface GitMergeArgs {
  /** Branch (or ref) to merge INTO the current branch. */
  readonly branch: string;
}

export interface GitMergeResult {
  /** True when the merge completed; false when it stopped on conflicts. */
  readonly merged: boolean;
  /** True when the merge left the work tree with conflict markers to resolve. */
  readonly conflicts: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRenameBranchArgs {
  /** Branch to rename; defaults to the current branch when omitted. */
  readonly from?: string;
  readonly to: string;
}

export interface GitDiffArgs {
  readonly path: string;
  /** Diff the staged version (index vs HEAD) instead of working-tree vs index. */
  readonly staged?: boolean;
}

export interface GitBlameArgs {
  readonly path: string;
  /** Blame at a ref (default: working tree). Empty/omitted = working tree. */
  readonly ref?: string;
}

/** Pickaxe search over history: find commits that added/removed an occurrence of
 *  `query` (git's `-S`). The "when did I write X" retrieval leg over git history. */
export interface GitSearchHistoryArgs {
  readonly query: string;
  readonly maxCount?: number;
  /** Scope to one file's history (optional). */
  readonly path?: string;
  readonly ignoreCase?: boolean;
}

/** One line's last-touching commit (from `git blame --line-porcelain`). An
 *  uncommitted line has an all-zero `sha` and author "Not Committed Yet". */
export interface GitBlameLine {
  /** 1-based final line number in the blamed file. */
  readonly line: number;
  readonly sha: string;
  readonly author: string;
  /** Author time in epoch SECONDS (UI formats it). */
  readonly authorTime: number;
  readonly summary: string;
}

export interface GitBlameResult {
  readonly lines: readonly GitBlameLine[];
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

/** A person (author or committer) on a commit. `date` is strict ISO 8601 (%aI/%cI). */
export interface GitPerson {
  readonly name: string;
  readonly email: string;
  readonly date: string;
}

/**
 * One commit from `git.log`. The history data layer feeding the commit graph,
 * the ⌘K Git mode (search commits), and per-file history. `parents` (empty for a
 * root commit, >1 for a merge) is what the graph's lane layout draws edges from.
 * `refs` are the branch/tag/remote names decorating this commit (HEAD's own arrow
 * is normalized into `head` + the pointed-at branch in `refs`).
 */
export interface GitCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: readonly string[];
  readonly author: GitPerson;
  readonly committer: GitPerson;
  readonly subject: string;
  readonly body: string;
  /** Branch + remote-tracking ref names decorating this commit (tags excluded). */
  readonly refs: readonly string[];
  /** Tag names on this commit (separated so a UI can style them distinctly). */
  readonly tags: readonly string[];
  /** True when HEAD points at this commit (directly or via its branch). */
  readonly head: boolean;
}

export interface GitLogArgs {
  /** Start ref (default "HEAD"). Ignored when `all` is set. */
  readonly ref?: string;
  /** `--max-count` cap (omit for no limit); the panel paginates with this + `skip`. */
  readonly maxCount?: number;
  /** `--skip` offset for pagination. */
  readonly skip?: number;
  /** Limit to one path's history (workspace-relative) — the per-file timeline. */
  readonly path?: string;
  /** `--all`: walk every ref's history (the whole DAG, for the graph). */
  readonly all?: boolean;
}

export interface GitLogResult {
  readonly commits: readonly GitCommit[];
}

export interface GitDiffRefArgs {
  /** Base ref. Omit to diff `to` against its first parent (`to^`). */
  readonly from?: string;
  /** Target ref (a SHA, branch, or "HEAD"). */
  readonly to: string;
  /** Limit the diff to one path (workspace-relative). */
  readonly path?: string;
}

/** One file changed by a commit (`git.commitFiles`). `status` is the porcelain
 *  letter (A/M/D/R/C/T); `orig` is the source path for a rename/copy. */
export interface GitCommitFile {
  readonly path: string;
  readonly status: string;
  readonly orig?: string;
}

export interface GitCommitFilesArgs {
  /** The commit to list (a SHA / "HEAD" / branch). */
  readonly ref: string;
}

export interface GitCommitFilesResult {
  readonly files: readonly GitCommitFile[];
}

export interface GitApplyArgs {
  /** A unified-diff patch (e.g. one hunk extracted from `git.diff`). */
  readonly patch: string;
  /** Apply to the index (`--cached`) — stage/unstage a hunk vs touch the work tree. */
  readonly cached?: boolean;
  /** Apply in reverse (`--reverse`) — unstage a hunk, or discard one from the tree. */
  readonly reverse?: boolean;
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

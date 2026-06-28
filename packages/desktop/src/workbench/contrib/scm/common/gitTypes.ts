// Desktop Git/SCM contract types. Browser/main callers depend on this common
// boundary, like VS Code's workbench/contrib/scm/common layer; concrete Git
// execution stays behind a main-process provider.
export interface GitRunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly acceptExitCodes?: readonly number[];
}

export interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type GitRunner = (args: readonly string[], opts: GitRunOptions) => Promise<GitRunResult>;

export interface GitFileStatus {
  readonly path: string;
  readonly x: string;
  readonly y: string;
  readonly orig?: string;
}

export interface GitStatusResult {
  readonly isRepo: boolean;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly files: readonly GitFileStatus[];
}

export interface GitPathsArgs {
  readonly paths: readonly string[];
}

export interface GitCommitArgs {
  readonly message: string;
  readonly amend?: boolean;
}

export interface GitCommitResult {
  readonly committed: boolean;
}

export interface GitBranchInfo {
  readonly name: string;
  readonly current: boolean;
  readonly remote?: boolean;
}

export interface GitBranchesArgs {
  readonly includeRemote?: boolean;
}

export interface GitBranchesResult {
  readonly branches: readonly GitBranchInfo[];
  readonly current: string | null;
}

export type GitRefType = 'head' | 'remoteHead' | 'tag';

export interface GitRefInfo {
  readonly id: string;
  readonly name: string;
  readonly type: GitRefType;
  readonly current: boolean;
  readonly remote?: string;
  readonly upstream?: string;
  readonly commit?: string;
}

export interface GitRefsArgs {
  readonly includeRemote?: boolean;
  readonly includeTags?: boolean;
}

export interface GitRefsResult {
  readonly refs: readonly GitRefInfo[];
  readonly current: string | null;
}

export interface GitRemoteInfo {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export interface GitRemotesResult {
  readonly remotes: readonly GitRemoteInfo[];
}

export interface GitStashArgs {
  readonly message?: string;
  readonly includeUntracked?: boolean;
}

export interface GitStashResult {
  readonly stashed: boolean;
}

export interface GitStashRefArgs {
  readonly ref?: string;
}

export interface GitStashEntry {
  readonly ref: string;
  readonly message: string;
  readonly hash: string;
  readonly parents: readonly string[];
  readonly date: string;
  readonly authorName: string;
  readonly authorEmail: string;
}

export interface GitStashListResult {
  readonly entries: readonly GitStashEntry[];
}

export interface GitRevertArgs {
  readonly ref: string;
}

export interface GitTagArgs {
  readonly name: string;
  readonly ref?: string;
}

export interface GitTagDeleteArgs {
  readonly name: string;
}

export interface GitCherryPickArgs {
  readonly ref: string;
}

export interface GitCherryPickResult {
  readonly applied: boolean;
  readonly conflicts: boolean;
}

export interface GitResetArgs {
  readonly ref: string;
  readonly mode?: 'soft' | 'mixed' | 'hard';
}

export interface GitRevertResult {
  readonly reverted: boolean;
  readonly conflicts: boolean;
}

export interface GitPushArgs {
  readonly force?: boolean;
}

export interface GitPullArgs {
  readonly rebase?: boolean;
}

export interface GitPublishArgs {
  readonly remote?: string;
}

export interface GitSyncArgs {
  readonly rebase?: boolean;
}

export interface GitRemoteUrlArgs {
  readonly remote?: string;
}

export interface GitRemoteUrlResult {
  readonly url: string | null;
}

export interface GitRebaseItem {
  readonly sha: string;
  readonly action: 'pick' | 'drop' | 'fixup' | 'reword';
  readonly message?: string;
}

export interface GitRebaseInteractiveArgs {
  readonly base: string;
  readonly items: readonly GitRebaseItem[];
}

export interface GitRebaseResult {
  readonly ok: boolean;
  readonly conflicts?: boolean;
}

export interface GitConflictStagesArgs {
  readonly path: string;
}

export interface GitConflictStagesResult {
  readonly base: string | null;
  readonly ours: string | null;
  readonly theirs: string | null;
}

export interface GitCheckoutArgs {
  readonly branch: string;
  readonly create?: boolean;
  readonly force?: boolean;
  readonly track?: boolean;
}

export interface GitCreateBranchArgs {
  readonly name: string;
  readonly ref?: string;
  readonly checkout?: boolean;
}

export interface GitDeleteBranchArgs {
  readonly name: string;
  readonly force?: boolean;
}

export interface GitMergeArgs {
  readonly branch: string;
}

export interface GitMergeResult {
  readonly merged: boolean;
  readonly conflicts: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRenameBranchArgs {
  readonly from?: string;
  readonly to: string;
}

export interface GitDiffArgs {
  readonly path: string;
  readonly staged?: boolean;
}

export interface GitBlameArgs {
  readonly path: string;
  readonly ref?: string;
}

export interface GitSearchHistoryArgs {
  readonly query: string;
  readonly maxCount?: number;
  readonly path?: string;
  readonly ignoreCase?: boolean;
}

export interface GitBlameLine {
  readonly line: number;
  readonly sha: string;
  readonly author: string;
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
  readonly ref: string;
  readonly path: string;
}

export interface GitShowResult {
  readonly content: string | null;
}

export interface GitPerson {
  readonly name: string;
  readonly email: string;
  readonly date: string;
}

export interface GitCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: readonly string[];
  readonly author: GitPerson;
  readonly committer: GitPerson;
  readonly subject: string;
  readonly body: string;
  readonly refs: readonly string[];
  readonly tags: readonly string[];
  readonly head: boolean;
}

export interface GitLogArgs {
  readonly ref?: string;
  readonly refNames?: readonly string[];
  readonly maxCount?: number;
  readonly maxParents?: number;
  readonly skip?: number;
  readonly path?: string;
  readonly all?: boolean;
}

export interface GitLogResult {
  readonly commits: readonly GitCommit[];
}

export interface GitMergeBaseArgs {
  readonly refs: readonly string[];
}

export interface GitMergeBaseResult {
  readonly ref: string | null;
}

export interface GitDiffRefArgs {
  readonly from?: string;
  readonly to: string;
  readonly path?: string;
}

export interface GitCommitFile {
  readonly path: string;
  readonly status: string;
  readonly orig?: string;
}

export interface GitCommitFilesArgs {
  readonly ref: string;
  readonly parent?: string;
}

export interface GitCommitFilesResult {
  readonly files: readonly GitCommitFile[];
}

export interface GitApplyArgs {
  readonly patch: string;
  readonly cached?: boolean;
  readonly reverse?: boolean;
}

export interface GitRemoteResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitOkResult {
  readonly ok: boolean;
}

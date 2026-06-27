/**
 * GitHub remote-provider types. The `github` module is the first concrete remote
 * provider (the planning doc's §6 RemoteProvider, GitHub flavour): it talks to the
 * GitHub REST API through the injected `ctx.http`, given a token the host supplies
 * from secure storage. Parsing/shaping lives here; the live calls in commands.ts.
 */

/** A repo coordinate parsed from a git remote URL. */
export interface GithubRepo {
  readonly owner: string;
  readonly repo: string;
}

export interface GithubRemoteRepository {
  readonly remoteName: string;
  readonly remoteUrl: string;
  readonly owner: string;
  readonly repo: string;
  readonly webUrl: string;
  readonly isReadOnly: boolean;
}

export interface GithubRepositoryResult {
  readonly repository: GithubRemoteRepository | null;
}

export interface GithubCreatePullRequestUrlArgs {
  readonly branch: string;
  /** Optional explicit remote URL. Omit to use the selected GitHub remote. */
  readonly remoteUrl?: string;
}

export interface GithubCreatePullRequestUrlResult {
  readonly url: string | null;
  readonly repository?: GithubRemoteRepository;
}

/** A pull request (subset of GitHub's /pulls item we surface). */
export interface GhPullRequest {
  readonly number: number;
  readonly title: string;
  /** The author's login (head.user / user.login). */
  readonly author: string;
  readonly state: string;
  readonly draft: boolean;
  /** The PR's source branch (head.ref) and target branch (base.ref). */
  readonly headRef: string;
  readonly baseRef: string;
  /** github.com web URL (html_url). */
  readonly url: string;
  readonly updatedAt: string;
}

/** One changed file in a PR (from /pulls/{n}/files). */
export interface GhPrFile {
  readonly filename: string;
  /** added / modified / removed / renamed. */
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  /** The unified-diff hunk text, when GitHub includes it (absent for binaries). */
  readonly patch?: string;
  /** Previous path for a rename. */
  readonly previousFilename?: string;
}

export interface GithubListPullRequestsArgs {
  /** The repo's git remote URL (https or scp-ssh). */
  readonly remoteUrl: string;
  /** open (default) / closed / all. */
  readonly state?: 'open' | 'closed' | 'all';
}

export interface GithubListPullRequestsResult {
  readonly pullRequests: readonly GhPullRequest[];
}

export interface GithubPullRequestFilesArgs {
  readonly remoteUrl: string;
  readonly number: number;
}

export interface GithubPullRequestFilesResult {
  readonly files: readonly GhPrFile[];
}

/** Submit a review on a PR (POST /pulls/{n}/reviews). REQUEST_CHANGES/COMMENT
 *  require a body; APPROVE may omit it. Needs a token with write access. */
export interface GithubReviewArgs {
  readonly remoteUrl: string;
  readonly number: number;
  readonly event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  readonly body?: string;
}

export interface GithubReviewResult {
  /** The created review's state (APPROVED / CHANGES_REQUESTED / COMMENTED). */
  readonly state: string;
  readonly url: string;
}

/** Verify + persist a token (GET /user). The token is stored via ctx.secrets and
 *  never returned to the renderer thereafter. */
export interface GithubSignInArgs {
  readonly token: string;
}

export interface GithubSignInResult {
  /** The authenticated login on success; null when the token is invalid. */
  readonly login: string | null;
}

/** The current sign-in state — reads the stored token, returns its login (no token). */
export interface GithubViewerResult {
  readonly login: string | null;
}

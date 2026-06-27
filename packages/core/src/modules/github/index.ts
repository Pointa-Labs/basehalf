import type { Core } from '../../kernel/index.js';
import * as github from './commands.js';

/**
 * The `github` module — the first remote-hosting provider (GitHub). Talks to the
 * GitHub REST API via the injected `ctx.http`; tokens live in `ctx.secrets` and
 * never cross into the renderer. It also owns GitHub-specific remote selection
 * and PR URL creation, so UI code consumes provider results instead of parsing
 * git remotes directly.
 */
export function registerGithubModule(core: Core): void {
  core.register('github.signIn', github.signIn);
  core.register('github.signOut', github.signOut);
  core.register('github.viewer', github.viewer);
  core.register('github.repository', github.repository);
  core.register('github.createPullRequestUrl', github.createPullRequestUrl);
  core.register('github.listPullRequests', github.listPullRequests);
  core.register('github.pullRequestFiles', github.pullRequestFiles);
  core.register('github.reviewPullRequest', github.reviewPullRequest);
}

export type * from './types.js';

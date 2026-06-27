import type { Core } from '../../kernel/index.js';
import * as github from './commands.js';

/**
 * The `github` module — the first remote-hosting provider (GitHub). Talks to the
 * GitHub REST API via the injected `ctx.http`; the token is passed per-call by the
 * host (read from OS-encrypted secure storage), never persisted here. Reads only
 * for now: `viewer` (token check), `listPullRequests`, `pullRequestFiles`.
 */
export function registerGithubModule(core: Core): void {
  core.register('github.signIn', github.signIn);
  core.register('github.signOut', github.signOut);
  core.register('github.viewer', github.viewer);
  core.register('github.listPullRequests', github.listPullRequests);
  core.register('github.pullRequestFiles', github.pullRequestFiles);
}

export type * from './types.js';

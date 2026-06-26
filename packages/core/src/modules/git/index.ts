import type { Core } from '../../kernel/index.js';
import * as git from './commands.js';

/**
 * The `git` module — Source Control over the system git binary (via the injected
 * `ctx.git`). Reads (`git.status`/`diff`/`show`/`branches`) return structured,
 * parsed results; writes (`stage`/`unstage`/`discard`/`commit`/`checkout`/`init`)
 * and remote ops (`push`/`pull`/`fetch`) are explicit user actions. The desktop
 * SCM panel drives all of this over IPC.
 */
export function registerGitModule(core: Core): void {
  core.register('git.status', git.status);
  core.register('git.stage', git.stage);
  core.register('git.unstage', git.unstage);
  core.register('git.stageAll', git.stageAll);
  core.register('git.unstageAll', git.unstageAll);
  core.register('git.discard', git.discard);
  core.register('git.commit', git.commit);
  core.register('git.push', git.push);
  core.register('git.pull', git.pull);
  core.register('git.fetch', git.fetch);
  core.register('git.branches', git.branches);
  core.register('git.checkout', git.checkout);
  core.register('git.init', git.init);
  core.register('git.diff', git.diff);
  core.register('git.show', git.show);
}

export type * from './types.js';

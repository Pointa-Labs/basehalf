import type { Core } from '../../kernel/index.js';
import * as git from './commands.js';

/**
 * The `git` module — Source Control over the system git binary (via the injected
 * `ctx.git`). Reads (`git.status`/`diff`/`diffRef`/`show`/`branches`/`log`) return
 * structured, parsed results; writes (`stage`/`unstage`/`discard`/`commit`/
 * `checkout`/`init`) and remote ops (`push`/`pull`/`fetch`) are explicit user
 * actions. The desktop SCM panel drives all of this over IPC.
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
  core.register('git.createBranch', git.createBranch);
  core.register('git.deleteBranch', git.deleteBranch);
  core.register('git.merge', git.merge);
  core.register('git.renameBranch', git.renameBranch);
  core.register('git.init', git.init);
  core.register('git.apply', git.apply);
  core.register('git.stash', git.stash);
  core.register('git.stashPop', git.stashPop);
  core.register('git.stashList', git.stashList);
  core.register('git.revert', git.revert);
  core.register('git.diff', git.diff);
  core.register('git.diffRef', git.diffRef);
  core.register('git.commitFiles', git.commitFiles);
  core.register('git.show', git.show);
  core.register('git.log', git.log);
}

export type * from './types.js';

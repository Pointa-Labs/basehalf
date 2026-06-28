import type { GitRunOptions, GitRunner } from '../common/git.js';

export interface GitCommandContext {
  readonly workspaceRoot: string | null;
  readonly git: GitRunner;
}

export function requireWorkspaceRoot(ctx: GitCommandContext): string {
  if (ctx.workspaceRoot === null) {
    throw new Error('No workspace bound to this Git operation.');
  }
  return ctx.workspaceRoot;
}

// Low-level Git execution boundary, mirroring VS Code's Git.exec(repository,args)
// split: command modules describe argv; this adapter supplies the repository cwd.
export function runGit(
  ctx: GitCommandContext,
  args: readonly string[],
  opts: Omit<GitRunOptions, 'cwd'> = {},
): ReturnType<GitRunner> {
  return ctx.git(args, { cwd: requireWorkspaceRoot(ctx), ...opts });
}

import { join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';
import type { SetupReport } from './types.js';

/**
 * `--setup` work, factored out so it stays testable in isolation.
 *
 * Non-destructive guarantees:
 *  - .gitignore: only appends `.bh/cache/` if the file exists and doesn't
 *    already mention .bh/cache/. The non-cache parts of `.bh/` (badges,
 *    views, index, focus.md, decisions) are kept in git so they travel
 *    with the folder (IR-v2-06). If no .gitignore (no git repo yet),
 *    reports `gitignoreAbsent: true` and skips.
 *  - CLAUDE.md: appends the workspace-hint section if not already present
 *    (detects both the current marker and the legacy `bh:recall-hint`
 *    marker so re-running `bh init` on older workspaces stays idempotent).
 *    Creates CLAUDE.md if missing.
 */

const CLAUDE_HINT_MARKER = '<!-- bh:workspace-hint -->';
const LEGACY_CLAUDE_HINT_MARKER = '<!-- bh:recall-hint -->';

const CLAUDE_HINT_SECTION = `
${CLAUDE_HINT_MARKER}
## BaseHalf workspace

This folder is registered as a BaseHalf workspace. BaseHalf stores its
metadata under \`.bh/\` (kept alongside your files so it travels with the
folder; only \`.bh/cache/\` is gitignored since it's rebuildable).

The desktop app (canvas + block editor + agent protocol) is in active
development. Once it ships, this hint will be replaced by a full agent
protocol guide. For now, the available \`bh\` operations are workspace
management — see \`bh workspace --help\`.
`;

export async function runSetup(fs: FsLike, workspaceRoot: string): Promise<SetupReport> {
  const report: SetupReport = {
    gitignoreUpdated: false,
    claudeMdUpdated: false,
    gitignoreSkipped: false,
    claudeMdSkipped: false,
    gitignoreAbsent: false,
  };

  return {
    ...report,
    ...(await updateGitignore(fs, workspaceRoot)),
    ...(await updateClaudeMd(fs, workspaceRoot)),
  };
}

async function updateGitignore(
  fs: FsLike,
  workspaceRoot: string,
): Promise<Pick<SetupReport, 'gitignoreUpdated' | 'gitignoreSkipped' | 'gitignoreAbsent'>> {
  const path = join(workspaceRoot, '.gitignore');
  const current = await fs.readFile(path);
  if (current === null) {
    return { gitignoreUpdated: false, gitignoreSkipped: false, gitignoreAbsent: true };
  }
  // Match `.bh/cache/` or `.bh/cache` on its own line (anchored), ignoring leading comments.
  // Note: a bare `.bh/` line (from older versions of `bh init`) is NOT treated as
  // already-ignored — the new model wants only `.bh/cache/` ignored, so users
  // upgrading should remove the bare `.bh/` line manually.
  const hasIgnore = current.split('\n').some((line) => /^\s*\.bh\/cache\/?\s*(#.*)?$/.test(line));
  if (hasIgnore) {
    return { gitignoreUpdated: false, gitignoreSkipped: true, gitignoreAbsent: false };
  }
  const trailingNewline = current.endsWith('\n') ? '' : '\n';
  await fs.writeFile(
    path,
    `${current}${trailingNewline}\n# BaseHalf derived cache (rebuildable; the rest of .bh/ stays in git)\n.bh/cache/\n`,
  );
  return { gitignoreUpdated: true, gitignoreSkipped: false, gitignoreAbsent: false };
}

async function updateClaudeMd(
  fs: FsLike,
  workspaceRoot: string,
): Promise<Pick<SetupReport, 'claudeMdUpdated' | 'claudeMdSkipped'>> {
  const path = join(workspaceRoot, 'CLAUDE.md');
  const current = await fs.readFile(path);
  if (current?.includes(CLAUDE_HINT_MARKER) || current?.includes(LEGACY_CLAUDE_HINT_MARKER)) {
    return { claudeMdUpdated: false, claudeMdSkipped: true };
  }
  const base = current ?? '# CLAUDE.md\n';
  const trailingNewline = base.endsWith('\n') ? '' : '\n';
  await fs.writeFile(path, `${base}${trailingNewline}${CLAUDE_HINT_SECTION}`);
  return { claudeMdUpdated: true, claudeMdSkipped: false };
}

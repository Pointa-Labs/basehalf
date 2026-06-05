import { join } from 'node:path';
import {
  type FsLike,
  assertReadContained,
  assertWriteContained,
  readMaybeNoFollow,
  writeMaybeNoFollow,
} from '../../kernel/index.js';
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

// A SHORT pointer, not a 60-line essay: the shorter the hint, the more reliably an
// agent reads it. It points at the live signal and the graph; usage/judgment beyond
// this is a versionable skill, not frozen prose baked into every workspace.
const CLAUDE_HINT_SECTION = `
${CLAUDE_HINT_MARKER}
## BaseHalf workspace

This folder is a BaseHalf workspace. **At the start of every turn, read
\`.bh/focus.md\`** — a self-contained turn brief the app keeps fresh (it never points
at a deleted file). It carries an optional \`intent:\` (what the user is doing this
turn) and an \`active:\` list of the files they're focused on, each with its
\`prompt:\` (what they want you to know) and \`refs:\` (which files connect, and why).
One read gives you the user's curated attention — grep can't recover those
human-written notes.

Need more than the brief? The full graph is under \`.bh/\`:
\`.bh/badges/<rel-path>.json\` is any file's backpack (prompt + references), and
\`.bh/index/inbound.json\` is who points AT a file. Follow these on your own budget.

MD is the truth; \`.bh/\` is derived — edit user files with your own tools,
never \`.bh/*\` (the app and \`bh\` CLI own it; \`.bh/cache/\` is rebuildable and
gitignored). \`bh\` CLI reads accept \`--json\`.
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
  const lexical = join(workspaceRoot, '.gitignore');
  // runSetup writes two USER files (.gitignore, CLAUDE.md) — bh's only other
  // write path besides the editor. A workspace "you drop in" can ship a
  // planted `.gitignore`/`CLAUDE.md` SYMLINK whose innocuous name escapes
  // assertWorkspaceRelative but whose target is outside the root (e.g.
  // ~/.ssh/authorized_keys, a launch agent). Route read+write through the
  // realpath guards so node:fs never follows it; refuse (skip the step)
  // rather than clobber/plant outside.
  try {
    const current = await readMaybeNoFollow(
      fs,
      await assertReadContained(fs, workspaceRoot, lexical),
    );
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
    await writeMaybeNoFollow(
      fs,
      await assertWriteContained(fs, workspaceRoot, lexical),
      `${current}${trailingNewline}\n# BaseHalf derived cache (rebuildable; the rest of .bh/ stays in git)\n.bh/cache/\n`,
    );
    return { gitignoreUpdated: true, gitignoreSkipped: false, gitignoreAbsent: false };
  } catch (err) {
    if (err instanceof Error && err.name === 'PathEscape') {
      return { gitignoreUpdated: false, gitignoreSkipped: true, gitignoreAbsent: false };
    }
    throw err;
  }
}

async function updateClaudeMd(
  fs: FsLike,
  workspaceRoot: string,
): Promise<Pick<SetupReport, 'claudeMdUpdated' | 'claudeMdSkipped'>> {
  const lexical = join(workspaceRoot, 'CLAUDE.md');
  try {
    const current = await readMaybeNoFollow(
      fs,
      await assertReadContained(fs, workspaceRoot, lexical),
    );
    if (current?.includes(CLAUDE_HINT_MARKER) || current?.includes(LEGACY_CLAUDE_HINT_MARKER)) {
      return { claudeMdUpdated: false, claudeMdSkipped: true };
    }
    const base = current ?? '# CLAUDE.md\n';
    const trailingNewline = base.endsWith('\n') ? '' : '\n';
    await writeMaybeNoFollow(
      fs,
      await assertWriteContained(fs, workspaceRoot, lexical),
      `${base}${trailingNewline}${CLAUDE_HINT_SECTION}`,
    );
    return { claudeMdUpdated: true, claudeMdSkipped: false };
  } catch (err) {
    if (err instanceof Error && err.name === 'PathEscape') {
      return { claudeMdUpdated: false, claudeMdSkipped: true };
    }
    throw err;
  }
}

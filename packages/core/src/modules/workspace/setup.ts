import { dirname, join } from 'node:path';
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
 *  - Agent hints: appends the same workspace-hint section to CLAUDE.md,
 *    AGENTS.md, and .github/copilot-instructions.md — the three filenames
 *    that, between them, the major coding agents read (Claude Code →
 *    CLAUDE.md; Codex/Aider/Zed/Warp/OpenCode/Cline/Cursor-fallback/… →
 *    AGENTS.md; in-IDE Copilot → .github/copilot-instructions.md). One
 *    curated brief, dropped where each agent already looks — no per-tool
 *    config, no MCP server required for the file-reading path. Each file is
 *    guarded by a marker so re-running `bh init` is idempotent (CLAUDE.md
 *    also detects the legacy `bh:recall-hint` marker). Files are created if
 *    missing; existing content is preserved (the hint is appended).
 */

const HINT_MARKER = '<!-- bh:workspace-hint -->';
const LEGACY_CLAUDE_HINT_MARKER = '<!-- bh:recall-hint -->';

// A SHORT pointer, not a 60-line essay: the shorter the hint, the more reliably an
// agent reads it. It points at the live signal and the graph, and offers BOTH ways
// in — read the `.bh/` files directly (any agent), or drive the `bh` CLI (agents
// with a shell) — so it lands whether or not the agent can run commands. Usage
// beyond this is a versionable skill, not frozen prose baked into every workspace.
const HINT_BODY = `## BaseHalf workspace

This folder is a BaseHalf workspace. **At the start of every turn, read
\`.bh/focus.md\`** — a self-contained turn brief the app keeps fresh (it never points
at a deleted file). It carries an optional \`intent:\` (what the user is doing this
turn) and an \`active:\` list of the files they're focused on, each with its
\`prompt:\` (what they want you to know) and \`refs:\` (which files connect, and why).
One read gives you the user's curated attention — grep can't recover those
human-written notes.

Need more than the brief? Read the graph under \`.bh/\` directly, or — if you have a
shell — drive the \`bh\` CLI (reads accept \`--json\`):
- \`.bh/badges/<rel-path>.json\` — any file's backpack (prompt + references); or \`bh badge get <path> --json\`
- \`.bh/index/inbound.json\` — who points AT a file; or \`bh inbound get <path> --json\`
- \`bh search <query> --json\` — full-text search across the workspace's text files

MD is the truth; \`.bh/\` is derived — edit user files with your own tools,
never \`.bh/*\` (the app and \`bh\` CLI own it; \`.bh/cache/\` is rebuildable and
gitignored).`;

// Prepended newline so appending to an existing file leaves a blank line before
// the marker; trailing newline so the file ends clean.
const HINT_SECTION = `\n${HINT_MARKER}\n${HINT_BODY}\n`;

/** One agent-hint file to install. Same body, three landing spots. */
interface HintTarget {
  /** Workspace-relative path (POSIX `/`; `join` localizes it). */
  readonly relPath: string;
  /** Content to start from when the file doesn't exist yet. */
  readonly emptyBase: string;
  /** An older marker that also counts as "already installed" (skip). */
  readonly legacyMarker?: string;
  /** Whether the parent dir may be missing and must be `mkdir`'d first
   *  (production `fs.writeFile` won't create `.github/`). */
  readonly needsParentDir?: boolean;
}

const CLAUDE_TARGET: HintTarget = {
  relPath: 'CLAUDE.md',
  emptyBase: '# CLAUDE.md\n',
  legacyMarker: LEGACY_CLAUDE_HINT_MARKER,
};
const AGENTS_TARGET: HintTarget = {
  relPath: 'AGENTS.md',
  emptyBase: '# AGENTS.md\n',
};
const COPILOT_TARGET: HintTarget = {
  relPath: '.github/copilot-instructions.md',
  emptyBase: '# Copilot instructions\n',
  needsParentDir: true,
};

export async function runSetup(fs: FsLike, workspaceRoot: string): Promise<SetupReport> {
  const gitignore = await updateGitignore(fs, workspaceRoot);
  const claude = await installHint(fs, workspaceRoot, CLAUDE_TARGET);
  const agents = await installHint(fs, workspaceRoot, AGENTS_TARGET);
  const copilot = await installHint(fs, workspaceRoot, COPILOT_TARGET);

  return {
    ...gitignore,
    claudeMdUpdated: claude.updated,
    claudeMdSkipped: claude.skipped,
    agentsMdUpdated: agents.updated,
    agentsMdSkipped: agents.skipped,
    copilotMdUpdated: copilot.updated,
    copilotMdSkipped: copilot.skipped,
  };
}

async function updateGitignore(
  fs: FsLike,
  workspaceRoot: string,
): Promise<Pick<SetupReport, 'gitignoreUpdated' | 'gitignoreSkipped' | 'gitignoreAbsent'>> {
  const lexical = join(workspaceRoot, '.gitignore');
  // runSetup writes USER files (.gitignore + the agent-hint files) — bh's only
  // other write path besides the editor. A workspace "you drop in" can ship a
  // planted SYMLINK whose innocuous name escapes assertWorkspaceRelative but
  // whose target is outside the root (e.g. ~/.ssh/authorized_keys, a launch
  // agent). Route read+write through the realpath guards so node:fs never
  // follows it; refuse (skip the step) rather than clobber/plant outside.
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

/**
 * Install the workspace hint into one target file (idempotent + non-destructive).
 * Skips if the marker (or the target's legacy marker) is already present; creates
 * the file from `emptyBase` when missing; appends otherwise. A symlinked target
 * (or symlinked parent dir) is refused via the realpath guards and reported as a
 * skip, never a clobber.
 */
async function installHint(
  fs: FsLike,
  workspaceRoot: string,
  target: HintTarget,
): Promise<{ updated: boolean; skipped: boolean }> {
  const lexical = join(workspaceRoot, target.relPath);
  try {
    const current = await readMaybeNoFollow(
      fs,
      await assertReadContained(fs, workspaceRoot, lexical),
    );
    if (
      current?.includes(HINT_MARKER) ||
      (target.legacyMarker !== undefined && current?.includes(target.legacyMarker))
    ) {
      return { updated: false, skipped: true };
    }
    const writeAbs = await assertWriteContained(fs, workspaceRoot, lexical);
    if (target.needsParentDir) {
      // assertWriteContained already proved the parent is contained and not a
      // symlink leaf, so mkdir-ing it can't escape the root. recursive → idempotent.
      await fs.mkdir(dirname(writeAbs), { recursive: true });
    }
    const base = current ?? target.emptyBase;
    const trailingNewline = base.endsWith('\n') ? '' : '\n';
    await writeMaybeNoFollow(fs, writeAbs, `${base}${trailingNewline}${HINT_SECTION}`);
    return { updated: true, skipped: false };
  } catch (err) {
    if (err instanceof Error && err.name === 'PathEscape') {
      return { updated: false, skipped: true };
    }
    throw err;
  }
}

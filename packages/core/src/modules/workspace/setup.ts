import { join } from 'node:path';
import {
  type FsLike,
  assertReadContained,
  assertWriteContained,
  toPosix,
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

const CLAUDE_HINT_SECTION = `
${CLAUDE_HINT_MARKER}
## BaseHalf workspace

This folder is a BaseHalf workspace. BaseHalf is a local-first canvas +
block editor; you (the AI agent) read its metadata under \`.bh/\` to
understand what the user is focused on and how their files relate, then
compose context from there.

### Start every turn here

Read \`.bh/focus.md\`. The desktop UI rewrites it as the user clicks badges,
and it is a **self-contained turn brief** — not just a list of paths. One
read gives you the user's curated meaning:

- \`intent:\` (optional) — what the user is trying to do this turn (carried
  from a focused task or a saved view's prompt).
- \`active:\` — the workspace-relative paths the user is focused on right
  now, and inlined under each: its \`prompt:\` (what the user wants you to
  know about that file) and its outbound \`refs:\` with notes (which files
  they've said go together, and why).

Because the prompts and reference-notes are inlined, focus.md is usually all
you need to know what to pay attention to — you do NOT have to open each
active file's badge JSON just to recover them.

### Go deeper when the brief isn't enough

\`.bh/\` holds the full graph behind focus.md. Reach for it to follow a
reference outward or pull in context the user connected from elsewhere:

- \`.bh/badges/<rel-path>.json\` (files) / \`.bh/badges/<rel-path>/.badge.json\`
  (folders) — the full "backpack" for ANY file, including ones not in
  \`active:\` that you reach by following a reference. Shape:

\`\`\`json
{
  "file": "intro.md",
  "kind": "file",
  "prompt": "What the user wants you to know about this file",
  "references": [
    { "to": "overview.md", "note": "why this one points at that one" }
  ]
}
\`\`\`

- \`.bh/index/inbound.json\` — who points AT a given file. Use it to surface
  related context the user has connected from elsewhere.

### Constraints

- **MD is the truth.** User content lives in \`.md\` and other source
  files. \`.bh/\` is derived metadata only. Edit user files with your own
  tools; never edit \`.bh/*.json\` directly — the desktop app and \`bh\`
  CLI own that surface.
- **\`.bh/cache/\` is rebuildable** and gitignored. Don't read or write to
  it.
- \`bh\` CLI reads accept \`--json\` for stable output (\`bh --help\`).
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
  const lexical = toPosix(join(workspaceRoot, '.gitignore'));
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
  const lexical = toPosix(join(workspaceRoot, 'CLAUDE.md'));
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

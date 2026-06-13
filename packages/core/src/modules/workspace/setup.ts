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
 *  - Agent hints: appends the same workspace-hint section to CLAUDE.md and
 *    AGENTS.md — the two filenames that, between them, today's coding agents
 *    read (Claude Code → CLAUDE.md, the only file it reliably reads as of
 *    mid-2026; Codex/Cursor/Windsurf/Cline/the Copilot coding agent/… →
 *    AGENTS.md). The old third target, .github/copilot-instructions.md, is
 *    no longer written: Copilot's agent reads AGENTS.md (and CLAUDE.md)
 *    natively now, and conjuring a hidden directory into the user's folder
 *    was the worst of the litter. Two root files is the honest minimum; the
 *    day Claude Code reads AGENTS.md natively, collapse to one. Each file is
 *    guarded by a marker so re-running `bh init` is idempotent (CLAUDE.md
 *    also detects the legacy `bh:recall-hint` marker). Files are created if
 *    missing; existing content is preserved (the hint is appended).
 */

const HINT_MARKER = '<!-- bh:workspace-hint -->';
// Closing marker (added 2026-06): lets `bh init` re-run UPGRADE the section in
// place (replace strictly between the open + close markers) instead of skipping
// every existing install forever. Legacy installs carry only the open marker
// (the section ran to EOF); we upgrade those too. See installHint.
const HINT_END_MARKER = '<!-- /bh:workspace-hint -->';
const LEGACY_CLAUDE_HINT_MARKER = '<!-- bh:recall-hint -->';

// A SHORT pointer, not a 60-line essay: the shorter the hint, the more reliably an
// agent reads it. It points at the live signal and the graph, and offers BOTH ways
// in — read the `.bh/` files directly (any agent), or drive the `bh` CLI (agents
// with a shell) — so it lands whether or not the agent can run commands. Usage
// beyond this is a versionable skill, not frozen prose baked into every workspace.
const HINT_BODY = `## BaseHalf workspace

> Added by [BaseHalf](https://github.com/Pointa-Labs/basehalf) when this folder
> was opened as a workspace — it tells AI coding agents where the user's
> curated context lives. Your own content above/below is untouched; delete
> this section if you don't want agents reading that context.

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
- \`bh search <query> --brief\` — assemble a paste-ready context brief from the matches (each hydrated with its prompt + reference notes)

If you have a shell, read the brief with \`bh focus brief\` instead of opening the
file: it returns the same content AND records that the brief was delivered, so the
app can tell the user their context reached you (a raw file read is invisible to it).

While working, if you discover a file relationship or a key fact that no badge
note records (e.g. "touching X breaks Y's test"), append one line to
\`.bh/cache/proposals.md\`: \`[file] -> [target or fact]: [reason]\`. The user
triages these into real notes.

MD is the truth; \`.bh/\` is derived — edit user files with your own tools,
never \`.bh/*\` (the app and \`bh\` CLI own it; the proposals file above is the
ONE exception). \`.bh/cache/\` is gitignored; it is rebuildable EXCEPT the
proposals file, which holds your observations.`;

// The marker-delimited block written into a target file. Open marker, body, close
// marker — the close marker is what lets a later `bh init` find and replace the
// section precisely. No surrounding newlines here; installHint owns the spacing.
const HINT_BLOCK = `${HINT_MARKER}\n${HINT_BODY}\n${HINT_END_MARKER}`;

/** One agent-hint file to install. Same body, two landing spots. */
interface HintTarget {
  /** Workspace-relative path (POSIX `/`; `join` localizes it). */
  readonly relPath: string;
  /** Content to start from when the file doesn't exist yet. */
  readonly emptyBase: string;
  /** An older marker that also counts as "already installed" (skip). */
  readonly legacyMarker?: string;
}

// When WE create the file, the heading explains what the file is — a user
// who finds it in their folder should understand it at a glance.
const CLAUDE_TARGET: HintTarget = {
  relPath: 'CLAUDE.md',
  emptyBase: '# CLAUDE.md\n\nInstructions AI coding agents read when working in this folder.\n',
  legacyMarker: LEGACY_CLAUDE_HINT_MARKER,
};
const AGENTS_TARGET: HintTarget = {
  relPath: 'AGENTS.md',
  emptyBase: '# AGENTS.md\n\nInstructions AI coding agents read when working in this folder.\n',
};

export async function runSetup(fs: FsLike, workspaceRoot: string): Promise<SetupReport> {
  const gitignore = await updateGitignore(fs, workspaceRoot);
  const claude = await installHint(fs, workspaceRoot, CLAUDE_TARGET);
  const agents = await installHint(fs, workspaceRoot, AGENTS_TARGET);

  return {
    ...gitignore,
    claudeMdUpdated: claude.updated,
    claudeMdSkipped: claude.skipped,
    agentsMdUpdated: agents.updated,
    agentsMdSkipped: agents.skipped,
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
 * Compute the new file content with the hint section installed or UPGRADED,
 * preserving every byte of the user's own content. Pure (no I/O) so it's unit
 * testable. Returns null when the content already matches (nothing to write).
 *
 * Cases, in order:
 *  - open + close markers present → replace strictly between them (the precise
 *    upgrade path; same body → null, so re-running `bh init` is idempotent).
 *  - open marker but NO close marker (a legacy install — the section was appended
 *    to EOF) → replace from the open marker to end of file. Content the user
 *    added AFTER the hint is the one edge this can't preserve; legacy installs
 *    appended the hint last, so in practice there's nothing after it.
 *  - a legacy recall marker (pre-pivot) and no current marker → same EOF replace.
 *  - no marker at all → append a fresh blank-line-separated block.
 */
function applyHint(current: string | null, target: HintTarget): string | null {
  if (current === null) {
    const base = target.emptyBase.endsWith('\n') ? target.emptyBase : `${target.emptyBase}\n`;
    return `${base}\n${HINT_BLOCK}\n`;
  }
  const openIdx = current.indexOf(HINT_MARKER);
  if (openIdx !== -1) {
    const endIdx = current.indexOf(HINT_END_MARKER, openIdx);
    if (endIdx !== -1) {
      const before = current.slice(0, openIdx);
      const after = current.slice(endIdx + HINT_END_MARKER.length);
      const next = `${before}${HINT_BLOCK}${after}`;
      return next === current ? null : next;
    }
    // Legacy: open marker, no close → the old section ran to EOF.
    const before = current.slice(0, openIdx).replace(/\n+$/, '');
    const next = `${before}\n\n${HINT_BLOCK}\n`;
    return next === current ? null : next;
  }
  const legacyMarker = target.legacyMarker;
  if (legacyMarker !== undefined) {
    const legacyIdx = current.indexOf(legacyMarker);
    if (legacyIdx !== -1) {
      const before = current.slice(0, legacyIdx).replace(/\n+$/, '');
      const next = `${before}\n\n${HINT_BLOCK}\n`;
      return next === current ? null : next;
    }
  }
  const base = current.replace(/\n+$/, '');
  return `${base}\n\n${HINT_BLOCK}\n`;
}

/**
 * Install OR upgrade the workspace hint in one target file (non-destructive +
 * idempotent). Creates the file from `emptyBase` when missing; replaces the
 * marker-delimited section in place when present (so a `bh init` re-run refreshes
 * an out-of-date hint instead of skipping forever); appends when absent. A
 * symlinked target (or symlinked parent dir) is refused via the realpath guards
 * and reported as a skip, never a clobber.
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
    const next = applyHint(current, target);
    if (next === null) return { updated: false, skipped: true };
    const writeAbs = await assertWriteContained(fs, workspaceRoot, lexical);
    await writeMaybeNoFollow(fs, writeAbs, next);
    return { updated: true, skipped: false };
  } catch (err) {
    if (err instanceof Error && err.name === 'PathEscape') {
      return { updated: false, skipped: true };
    }
    throw err;
  }
}

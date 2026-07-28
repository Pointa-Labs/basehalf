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
 * A tracked repository-level opt-out for folders that may be opened by a
 * BaseHalf development host but must not be initialized as product workspaces.
 */
export const BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER = '.basehalf-no-workspace-setup';

/**
 * `--setup` work, factored out so it stays testable in isolation.
 *
 * Non-destructive guarantees:
 *  - .gitignore: only appends `.bh/cache/` if the file exists and doesn't
 *    already mention .bh/cache/. The non-cache parts of `.bh/` (the `mirror/`
 *    tree + `current_focus.yaml`) are kept in git so they travel with the
 *    folder (IR-v2-06). If no .gitignore (no git repo yet),
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
 *  - Agent harness: writes BaseHalf-owned progressive-disclosure docs under
 *    `.bh/agent-harness/`. AGENTS.md / CLAUDE.md stay short and point agents
 *    to the harness index only when a BaseHalf-specific workflow needs deeper
 *    rules.
 */

const HINT_MARKER = '<!-- bh:workspace-hint -->';
// Closing marker (added 2026-06): lets `bh init` re-run UPGRADE the section in
// place (replace strictly between the open + close markers) instead of skipping
// every existing install forever. Legacy installs carry only the open marker
// (the section ran to EOF); we upgrade those too. See installHint.
const HINT_END_MARKER = '<!-- /bh:workspace-hint -->';
const LEGACY_CLAUDE_HINT_MARKER = '<!-- bh:recall-hint -->';
const AGENT_HARNESS_DIR = '.bh/agent-harness';
const AGENT_HARNESS_SCENARIOS_DIR = `${AGENT_HARNESS_DIR}/scenarios`;
const AGENT_HARNESS_INDEX_REL = `${AGENT_HARNESS_DIR}/index.md`;
// Marks a file as BaseHalf-managed. It pulls triple duty: (1) a visible
// "don't hand-edit, regenerated on update" banner; (2) the licence for the
// sync to OVERWRITE it to the current app version; (3) the signal that lets the
// cross-version sweep DELETE a file this version no longer ships WITHOUT ever
// touching a file the user dropped in alongside it — no sentinel → not ours.
// MARKER is the stable recognition token: the prune matches this PREFIX, never
// the whole line, so the human-readable tail can be reworded in a later version
// without orphaning files an earlier version already stamped.
const AGENT_HARNESS_MARKER = '<!-- bh:agent-harness managed';
const AGENT_HARNESS_SENTINEL = `${AGENT_HARNESS_MARKER} — regenerated on BaseHalf update; edits are overwritten -->`;

const managedDoc = (lines: readonly string[]): string =>
  `${AGENT_HARNESS_SENTINEL}\n\n${lines.join('\n')}\n`;

const AGENT_HARNESS_FILES = [
  {
    relPath: AGENT_HARNESS_INDEX_REL,
    content: managedDoc([
      '# BaseHalf Agent Harness',
      '',
      '> Generated and maintained by BaseHalf. These files are refreshed on each app',
      "> update, so hand-edits are overwritten — don't store your own notes here.",
      '',
      'This directory contains BaseHalf-specific operational contracts for coding',
      'agents. Treat this file as the scenario index. Load only the scenario that',
      "matches the user's request.",
      '',
      '## Scenarios',
      '',
      '- Editing or rewriting the focused file: [scenarios/open-file-editing.md](scenarios/open-file-editing.md)',
      '- Answering cursor, line, or viewport questions: [scenarios/focus-coordinates.md](scenarios/focus-coordinates.md)',
      '- Generating or updating .bh mirror files: [scenarios/bh-mirror-writing.md](scenarios/bh-mirror-writing.md)',
      '',
      '## Boundary',
      '',
      'AGENTS.md / CLAUDE.md hold the always-on rules. This harness holds detailed,',
      'task-specific rules that should be loaded only when relevant.',
    ]),
  },
  {
    relPath: `${AGENT_HARNESS_SCENARIOS_DIR}/open-file-editing.md`,
    content: managedDoc([
      '# Open File Editing',
      '',
      'Use this scenario when the user asks to clear, rewrite, replace, regenerate, or',
      'transform the currently focused file.',
      '',
      '## Contract',
      '',
      'Treat the focused file as an open editor buffer. Preserve the file node and edit',
      'its bytes in place.',
      '',
      '## Allowed',
      '',
      '- Patch or replace content at the same path.',
      '- Truncate and write the same path without unlinking it.',
      '- Use the path from .bh/current_focus.yaml when the user says "this page",',
      '  "here", or "the current document".',
      '',
      '## Forbidden',
      '',
      '- Delete the focused file and add a new file at the same path.',
      '- Rename the focused file away and recreate it.',
      '- Use a delete-and-add sequence to satisfy a clear/rewrite/regenerate request.',
      '',
      'BaseHalf watches open documents through filesystem events. A delete-and-add',
      'sequence makes the open editor observe an unlink event and can surface a',
      'deleted-file state to the user even if a same-path file appears right after it.',
    ]),
  },
  {
    relPath: `${AGENT_HARNESS_SCENARIOS_DIR}/focus-coordinates.md`,
    content: managedDoc([
      '# Focus Coordinates',
      '',
      'Use this scenario when the user asks where their cursor is, what line they are',
      'looking at, or what text is near the cursor.',
      '',
      '## Coordinate Types',
      '',
      '- cursor.line / cursor.column are 1-based positions in the Markdown source.',
      '- cursor.block and visible_blocks.start are rendered block ordinals.',
      '- The visual screen line is not currently represented; soft wrapping can make a',
      '  source line appear as multiple on-screen rows.',
      '',
      '## Contract',
      '',
      'Use line + column to inspect or edit source text. Use block / visible_blocks to',
      'describe where the user is in the rendered editor. Do not present a whole source',
      'line as "the line on your screen" when soft wrapping may be involved.',
    ]),
  },
  {
    relPath: `${AGENT_HARNESS_SCENARIOS_DIR}/bh-mirror-writing.md`,
    content: managedDoc([
      '# .bh Mirror Writing',
      '',
      'Use this scenario when the user explicitly asks you to generate or update .bh',
      'mirror files.',
      '',
      '## Contract',
      '',
      'User files are the source of truth. .bh files are derived BaseHalf state.',
      '',
      'Before modifying a .bh file, read the latest version from disk. Match the',
      'existing YAML shape. Do not write data that is derivable from paths, line',
      'numbers, or the reference graph. Never replace .bh/current_focus.yaml with a',
      'regular file; it must remain a symlink.',
    ]),
  },
] as const;
// A SHORT pointer, not an essay: the shorter the hint, the more reliably an agent
// reads it. It points at the live signal (current_focus) and the four-file mirror,
// so it lands for any agent that can read files. Usage beyond this is a versionable
// skill, not frozen prose baked into every workspace.
const HINT_BODY = `## BaseHalf workspace

> Added by [BaseHalf](https://github.com/Pointa-Labs/basehalf) when this folder
> was opened as a workspace — it tells AI coding agents what the user is looking
> at. Your own content above/below is untouched; delete this section if you don't
> want agents reading that context.

This folder is a BaseHalf workspace: BaseHalf mirrors what the user is currently
viewing into \`.bh/\` so you stay in sync with their attention.

**At the start of every turn, read \`.bh/current_focus.yaml\`** — a symlink to the
focus file of the node the user is looking at right now:
- \`kind: file\` → they're reading a file. Use the file's content together with its
  \`badge.yaml\`, plus \`visible_lines.start\` / \`visible_blocks.start\` and \`cursor\`. In
  \`cursor\`, \`line\`/\`column\` are 1-based positions in the .md SOURCE (use them to
  locate/edit) and \`line_precision\` says how exact \`line\` is (\`exact\` |
  \`block_start\` | \`estimated\`); \`block\` is the ordinal of the rendered block they're
  in — the "Nth block" they actually see. Blank lines, multi-line blocks, and
  soft-wrapped long lines mean a source line is **not** the user's on-screen line — so
  use \`block\`/\`visible_blocks\` to say where they are, and \`line\`+\`column\` to
  locate/edit; never hand the user a whole source line as "the line on your screen".
- \`kind: folder\` → they're on a folder's canvas. Use that folder's \`badge.yaml\`
  and \`canvas.yaml\`, plus \`viewport_center\` and \`zoom\`.

The \`.bh/mirror/\` tree holds up to four YAML files per node (sparse — only what's
been annotated):
- \`.bh/mirror/<path>/badge.yaml\` — a node's one-line \`description\`, outbound
  \`references\` (paths) and inbound \`referenced_by\` (paths).
- \`.bh/mirror/<folder>/canvas.yaml\` — a folder's canvas: child card positions and
  \`edges\` (connections with anchors + labels) between them.
- \`.bh/mirror/<path>/focus.yaml\` — a node's viewport (\`current_focus\` points at
  the live one).
- \`.bh/mirror/<file>/adhd.yaml\` — per-file reading aids: \`highlight_keywords\` and
  read line-ranges (\`read_paragraphs\`).

To answer or edit, start from the focused node, then follow its \`references\` /
\`referenced_by\` and the \`canvas.yaml\` structure for context. Only modify the
user's own files when they explicitly ask.

When asked, you can GENERATE or update these \`.bh/\` files from content (a
badge.yaml/canvas.yaml for a folder, an adhd.yaml for a file). Match the existing
YAML shape; read the latest version before editing so you don't overwrite what the
app or the user just wrote; don't store anything derivable from paths, line numbers,
or the reference graph. \`.bh/current_focus.yaml\` is a symlink — never replace it
with a regular file.

For BaseHalf-specific workflows, use \`${AGENT_HARNESS_INDEX_REL}\` as the
progressive-disclosure index. Load only the matching scenario, such as focused-file
rewrites, cursor/viewport questions, or \`.bh/\` mirror writes, when that behavior
matters.

The user's files are the source of truth; \`.bh/\` is derived. Edit user files with
your own tools; the app owns \`.bh/\`. \`.bh/cache/\` is gitignored and rebuildable;
the rest of \`.bh/\` stays in git so the map travels with the folder.`;

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
  if (await isSetupDisabled(fs, workspaceRoot)) {
    return {
      disabledByMarker: true,
      gitignoreUpdated: false,
      gitignoreSkipped: true,
      gitignoreAbsent: false,
      agentHarnessUpdated: false,
      agentHarnessSkipped: true,
      claudeMdUpdated: false,
      claudeMdSkipped: true,
      agentsMdUpdated: false,
      agentsMdSkipped: true,
    };
  }

  const gitignore = await updateGitignore(fs, workspaceRoot);
  const agentHarness = await installAgentHarness(fs, workspaceRoot);
  const claude = await installHint(fs, workspaceRoot, CLAUDE_TARGET);
  const agents = await installHint(fs, workspaceRoot, AGENTS_TARGET);

  return {
    disabledByMarker: false,
    ...gitignore,
    agentHarnessUpdated: agentHarness.updated,
    agentHarnessSkipped: agentHarness.skipped,
    claudeMdUpdated: claude.updated,
    claudeMdSkipped: claude.skipped,
    agentsMdUpdated: agents.updated,
    agentsMdSkipped: agents.skipped,
  };
}

async function isSetupDisabled(fs: FsLike, workspaceRoot: string): Promise<boolean> {
  const marker = join(workspaceRoot, BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER);
  // Presence alone is the contract. lstat avoids following a planted symlink;
  // its only effect is to suppress writes, so ambiguous marker nodes fail safe.
  const entry = fs.lstat ? await fs.lstat(marker) : await fs.stat(marker);
  return entry !== null;
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

async function installAgentHarness(
  fs: FsLike,
  workspaceRoot: string,
): Promise<{ updated: boolean; skipped: boolean }> {
  try {
    await assertWriteContained(fs, workspaceRoot, join(workspaceRoot, AGENT_HARNESS_DIR, '.keep'));
    await fs.mkdir(join(workspaceRoot, AGENT_HARNESS_DIR), { recursive: true });
    await assertWriteContained(
      fs,
      workspaceRoot,
      join(workspaceRoot, AGENT_HARNESS_SCENARIOS_DIR, '.keep'),
    );
    await fs.mkdir(join(workspaceRoot, AGENT_HARNESS_SCENARIOS_DIR), { recursive: true });
  } catch (err) {
    // A symlinked/escaping harness dir (or parent) is refused, not clobbered.
    if (err instanceof Error && err.name === 'PathEscape') return { updated: false, skipped: true };
    throw err;
  }

  let updated = false;
  // Per-file write loop. Each entry stands alone: one tampered leaf (a planted
  // symlink → PathEscape, or an odd directory-at-leaf → EISDIR) skips THAT file
  // only — it never short-circuits the rest of the manifest or the prune below.
  for (const file of AGENT_HARNESS_FILES) {
    if (await writeManagedFile(fs, workspaceRoot, file.relPath, file.content)) updated = true;
  }
  // Cross-version cleanup: a PRIOR app version may have installed a scenario
  // this version renamed or retired. The write loop above never removes, so
  // without this sweep that file lingers forever and an agent could load a
  // contract we've since dropped. Only sentinel-bearing files are eligible —
  // a user-authored file in the same dir is never ours to delete.
  const managed = new Set<string>(AGENT_HARNESS_FILES.map((f) => f.relPath));
  for (const dir of [AGENT_HARNESS_DIR, AGENT_HARNESS_SCENARIOS_DIR]) {
    if (await pruneOrphanHarnessFiles(fs, workspaceRoot, dir, managed)) updated = true;
  }
  return { updated, skipped: !updated };
}

/**
 * Write one managed harness file when its on-disk content differs. Returns true
 * if it wrote. The compare NORMALIZES CRLF→LF: these files travel in git, so a
 * checkout under `core.autocrlf` hands back `\r\n` that would otherwise never
 * equal the `\n` manifest — making every open rewrite them forever. Normalizing
 * lets a CRLF checkout converge to "skip". A leaf that is a symlink (PathEscape)
 * or a directory (EISDIR) is skipped — never our file to write — so one odd node
 * can't abort the whole install.
 */
async function writeManagedFile(
  fs: FsLike,
  workspaceRoot: string,
  relPath: string,
  content: string,
): Promise<boolean> {
  const lexical = join(workspaceRoot, relPath);
  try {
    const current = await readMaybeNoFollow(
      fs,
      await assertReadContained(fs, workspaceRoot, lexical),
    );
    if (current !== null && current.replace(/\r\n/g, '\n') === content) return false;
    await writeMaybeNoFollow(fs, await assertWriteContained(fs, workspaceRoot, lexical), content);
    return true;
  } catch (err) {
    if (err instanceof Error && (err.name === 'PathEscape' || errnoCode(err) === 'EISDIR')) {
      return false;
    }
    throw err;
  }
}

/**
 * Remove managed harness files in `dir` (one level, non-recursive) that the
 * current manifest no longer lists — the cross-version rename/retire path.
 * Returns true if anything was removed. A file is deleted only when it carries
 * the managed sentinel, so a user-authored file is left untouched; a planted
 * symlink is refused by the no-follow read (PathEscape) and skipped, never
 * unlinked. Best-effort: a per-entry filesystem error (a contained-escape, a
 * symlink cycle → ELOOP from stat, or a TOCTOU vanish/lock between readdir and
 * unlink → ENOENT/EPERM) skips that entry, it never aborts the sweep. A non-fs
 * (programmer) error still surfaces.
 */
async function pruneOrphanHarnessFiles(
  fs: FsLike,
  workspaceRoot: string,
  dir: string,
  managed: ReadonlySet<string>,
): Promise<boolean> {
  let removed = false;
  for (const name of await fs.readdir(join(workspaceRoot, dir))) {
    const rel = `${dir}/${name}`;
    if (managed.has(rel)) continue;
    const lexical = join(workspaceRoot, rel);
    try {
      // stat (follow) filters out subdirs (e.g. scenarios/ during the root sweep);
      // the read + unlink below are containment-guarded, so a symlink that stats
      // as a file is refused there, not acted on.
      const st = await fs.stat(lexical);
      if (!st?.isFile) continue;
      const current = await readMaybeNoFollow(
        fs,
        await assertReadContained(fs, workspaceRoot, lexical),
      );
      if (current === null || !current.startsWith(AGENT_HARNESS_MARKER)) continue;
      await fs.unlink(await assertWriteContained(fs, workspaceRoot, lexical));
      removed = true;
    } catch (err) {
      if (err instanceof Error && (err.name === 'PathEscape' || errnoCode(err) !== undefined)) {
        continue;
      }
      throw err;
    }
  }
  return removed;
}

/** The node:fs errno string (`ENOENT`, `ELOOP`, `EISDIR`, …) on an error, or
 *  undefined for a non-filesystem error. */
function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
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

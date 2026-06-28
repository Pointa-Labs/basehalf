import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, normalize, sep } from 'node:path';
import type { SetupReport } from '../common/workspaces.js';

const HINT_MARKER = '<!-- bh:workspace-hint -->';
const HINT_END_MARKER = '<!-- /bh:workspace-hint -->';
const LEGACY_CLAUDE_HINT_MARKER = '<!-- bh:recall-hint -->';
const AGENT_HARNESS_DIR = '.bh/agent-harness';
const AGENT_HARNESS_SCENARIOS_DIR = `${AGENT_HARNESS_DIR}/scenarios`;
const AGENT_HARNESS_INDEX_REL = `${AGENT_HARNESS_DIR}/index.md`;
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

const HINT_BLOCK = `${HINT_MARKER}\n${HINT_BODY}\n${HINT_END_MARKER}`;

interface HintTarget {
  readonly relPath: string;
  readonly emptyBase: string;
  readonly legacyMarker?: string;
}

const CLAUDE_TARGET: HintTarget = {
  relPath: 'CLAUDE.md',
  emptyBase: '# CLAUDE.md\n\nInstructions AI coding agents read when working in this folder.\n',
  legacyMarker: LEGACY_CLAUDE_HINT_MARKER,
};
const AGENTS_TARGET: HintTarget = {
  relPath: 'AGENTS.md',
  emptyBase: '# AGENTS.md\n\nInstructions AI coding agents read when working in this folder.\n',
};

export async function runWorkspaceSetup(workspaceRoot: string): Promise<SetupReport> {
  const gitignore = await updateGitignore(workspaceRoot);
  const agentHarness = await installAgentHarness(workspaceRoot);
  const claude = await installHint(workspaceRoot, CLAUDE_TARGET);
  const agents = await installHint(workspaceRoot, AGENTS_TARGET);

  return {
    ...gitignore,
    agentHarnessUpdated: agentHarness.updated,
    agentHarnessSkipped: agentHarness.skipped,
    claudeMdUpdated: claude.updated,
    claudeMdSkipped: claude.skipped,
    agentsMdUpdated: agents.updated,
    agentsMdSkipped: agents.skipped,
  };
}

async function updateGitignore(
  workspaceRoot: string,
): Promise<Pick<SetupReport, 'gitignoreUpdated' | 'gitignoreSkipped' | 'gitignoreAbsent'>> {
  const lexical = join(workspaceRoot, '.gitignore');
  try {
    const current = await readNoFollow(await assertReadContained(workspaceRoot, lexical));
    if (current === null) {
      return { gitignoreUpdated: false, gitignoreSkipped: false, gitignoreAbsent: true };
    }
    const hasIgnore = current.split('\n').some((line) => /^\s*\.bh\/cache\/?\s*(#.*)?$/.test(line));
    if (hasIgnore) {
      return { gitignoreUpdated: false, gitignoreSkipped: true, gitignoreAbsent: false };
    }
    const trailingNewline = current.endsWith('\n') ? '' : '\n';
    await writeNoFollow(
      await assertWriteContained(workspaceRoot, lexical),
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
  workspaceRoot: string,
): Promise<{ updated: boolean; skipped: boolean }> {
  try {
    await assertWriteContained(workspaceRoot, join(workspaceRoot, AGENT_HARNESS_DIR, '.keep'));
    await mkdir(join(workspaceRoot, AGENT_HARNESS_DIR), { recursive: true });
    await assertWriteContained(
      workspaceRoot,
      join(workspaceRoot, AGENT_HARNESS_SCENARIOS_DIR, '.keep'),
    );
    await mkdir(join(workspaceRoot, AGENT_HARNESS_SCENARIOS_DIR), { recursive: true });
  } catch (err) {
    if (err instanceof Error && err.name === 'PathEscape') return { updated: false, skipped: true };
    throw err;
  }

  let updated = false;
  for (const file of AGENT_HARNESS_FILES) {
    if (await writeManagedFile(workspaceRoot, file.relPath, file.content)) updated = true;
  }
  const managed = new Set<string>(AGENT_HARNESS_FILES.map((f) => f.relPath));
  for (const dir of [AGENT_HARNESS_DIR, AGENT_HARNESS_SCENARIOS_DIR]) {
    if (await pruneOrphanHarnessFiles(workspaceRoot, dir, managed)) updated = true;
  }
  return { updated, skipped: !updated };
}

async function writeManagedFile(
  workspaceRoot: string,
  relPath: string,
  content: string,
): Promise<boolean> {
  const lexical = join(workspaceRoot, relPath);
  try {
    const current = await readNoFollow(await assertReadContained(workspaceRoot, lexical));
    if (current !== null && current.replace(/\r\n/g, '\n') === content) return false;
    await writeNoFollow(await assertWriteContained(workspaceRoot, lexical), content);
    return true;
  } catch (err) {
    if (err instanceof Error && (err.name === 'PathEscape' || errnoCode(err) === 'EISDIR')) {
      return false;
    }
    throw err;
  }
}

async function pruneOrphanHarnessFiles(
  workspaceRoot: string,
  dir: string,
  managed: ReadonlySet<string>,
): Promise<boolean> {
  let removed = false;
  for (const name of await readdir(join(workspaceRoot, dir))) {
    const rel = `${dir}/${name}`;
    if (managed.has(rel)) continue;
    const lexical = join(workspaceRoot, rel);
    try {
      const st = await stat(lexical);
      if (!st.isFile()) continue;
      const current = await readNoFollow(await assertReadContained(workspaceRoot, lexical));
      if (current === null || !current.startsWith(AGENT_HARNESS_MARKER)) continue;
      await unlink(await assertWriteContained(workspaceRoot, lexical));
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

async function installHint(
  workspaceRoot: string,
  target: HintTarget,
): Promise<{ updated: boolean; skipped: boolean }> {
  const lexical = join(workspaceRoot, target.relPath);
  try {
    const current = await readNoFollow(await assertReadContained(workspaceRoot, lexical));
    const next = applyHint(current, target);
    if (next === null) return { updated: false, skipped: true };
    await writeNoFollow(await assertWriteContained(workspaceRoot, lexical), next);
    return { updated: true, skipped: false };
  } catch (err) {
    if (err instanceof Error && err.name === 'PathEscape') {
      return { updated: false, skipped: true };
    }
    throw err;
  }
}

class PathEscape extends Error {
  override readonly name = 'PathEscape';
  constructor(public readonly rel: string) {
    super(`Refusing to access a path outside the workspace: ${rel}`);
  }
}

async function canonicalize(p: string): Promise<string> {
  const norm = normalize(p);
  const suffix: string[] = [];
  let cur = norm;
  for (;;) {
    try {
      const real = await realpath(cur);
      return suffix.length > 0 ? join(real, ...suffix) : real;
    } catch (err) {
      if (!isENOENT(err)) throw new PathEscape(cur);
      const ls = await lstat(cur).catch((lstatErr: unknown) => {
        if (isENOENT(lstatErr)) return null;
        throw lstatErr;
      });
      if (ls?.isSymbolicLink()) throw new PathEscape(cur);
      const parent = dirname(cur);
      if (parent === cur) {
        return suffix.length > 0 ? join(cur, ...suffix) : cur;
      }
      suffix.unshift(basename(cur));
      cur = parent;
    }
  }
}

function isContained(realRoot: string, real: string): boolean {
  return real === realRoot || real.startsWith(realRoot + sep);
}

async function assertReadContained(root: string, lexicalPath: string): Promise<string> {
  const realRoot = await canonicalize(root);
  const real = await canonicalize(lexicalPath);
  if (!isContained(realRoot, real)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  return real;
}

async function assertWriteContained(root: string, lexicalPath: string): Promise<string> {
  const realRoot = await canonicalize(root);
  const realParent = await canonicalize(dirname(lexicalPath));
  if (!isContained(realRoot, realParent)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  const leaf = join(realParent, basename(lexicalPath));
  const ls = await lstat(leaf).catch((err: unknown) => {
    if (isENOENT(err)) return null;
    throw err;
  });
  if (ls?.isSymbolicLink()) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  return leaf;
}

async function readNoFollow(path: string): Promise<string | null> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (isENOENT(err)) return null;
    if (isELOOP(err)) throw new PathEscape(path);
    throw err;
  }
  try {
    return await fh.readFile('utf8');
  } finally {
    await fh.close();
  }
}

async function writeNoFollow(path: string, content: string): Promise<void> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o666,
    );
  } catch (err) {
    if (isELOOP(err)) throw new PathEscape(path);
    throw err;
  }
  try {
    await fh.writeFile(content, 'utf8');
  } finally {
    await fh.close();
  }
}

function relLabel(root: string, lexicalPath: string): string {
  const r = normalize(root);
  const p = normalize(lexicalPath);
  return p.startsWith(r + sep) ? p.slice(r.length + 1) : p;
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function isENOENT(err: unknown): boolean {
  return errnoCode(err) === 'ENOENT';
}

function isELOOP(err: unknown): boolean {
  const code = errnoCode(err);
  return code === 'ELOOP' || code === 'EMLINK';
}

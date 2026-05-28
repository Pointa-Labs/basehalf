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

This folder is a BaseHalf workspace. BaseHalf is a local-first canvas +
block editor; you (the AI agent) read its metadata under \`.bh/\` to
understand what the user is focused on and how their files relate, then
compose context from there.

### Start every turn here

Read \`.bh/focus.md\`. It is a small Markdown file with a YAML-style
\`active:\` list of workspace-relative paths the user is currently focused
on (the desktop UI updates it as the user clicks badges). Treat it as the
"what should I be paying attention to right now" signal.

### Per-file context (the "backpack")

For each file in \`active:\`, read its badge JSON:

- \`.bh/badges/<rel-path>.json\` for files
- \`.bh/badges/<rel-path>/.badge.json\` for folders

Badge shape:

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

Follow \`references\` to walk the neighborhood — the user has explicitly
said "these things go together."

### Reverse index + saved views

- \`.bh/index/inbound.json\` — who points AT a given file. Use to surface
  related context the user has connected from elsewhere.
- \`.bh/views/<id>.json\` — named cross-folder groupings. If the user
  mentions a view by name, read its members to scope your context.

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

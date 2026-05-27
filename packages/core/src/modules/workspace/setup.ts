import { join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';
import type { SetupReport } from './types.js';

/**
 * `--setup` work, factored out so it stays testable in isolation.
 *
 * Non-destructive guarantees:
 *  - .gitignore: only appends `.bh/` if the file exists and doesn't already mention .bh/.
 *    If no .gitignore (no git repo yet), reports `gitignoreAbsent: true` and skips.
 *  - CLAUDE.md: appends the recall hint section if not already present.
 *    Creates CLAUDE.md if missing.
 */

const CLAUDE_HINT_MARKER = '<!-- bh:recall-hint -->';

const CLAUDE_HINT_SECTION = `
${CLAUDE_HINT_MARKER}
## Using \`bh\` (BaseHalf)

Before answering non-trivial design / "why did we…" questions, run:

\`\`\`bash
bh decision recall --json
\`\`\`

Cite slugs + rationale + sources in your answer. If recall surfaces nothing
relevant, offer to record a new decision with \`bh decision add\`.
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
  // Match either `.bh/` or `.bh` on its own line (anchored), ignoring leading comments.
  const hasIgnore = current.split('\n').some((line) => /^\s*\.bh\/?\s*(#.*)?$/.test(line));
  if (hasIgnore) {
    return { gitignoreUpdated: false, gitignoreSkipped: true, gitignoreAbsent: false };
  }
  const trailingNewline = current.endsWith('\n') ? '' : '\n';
  await fs.writeFile(path, `${current}${trailingNewline}\n# BaseHalf derived cache\n.bh/\n`);
  return { gitignoreUpdated: true, gitignoreSkipped: false, gitignoreAbsent: false };
}

async function updateClaudeMd(
  fs: FsLike,
  workspaceRoot: string,
): Promise<Pick<SetupReport, 'claudeMdUpdated' | 'claudeMdSkipped'>> {
  const path = join(workspaceRoot, 'CLAUDE.md');
  const current = await fs.readFile(path);
  if (current?.includes(CLAUDE_HINT_MARKER)) {
    return { claudeMdUpdated: false, claudeMdSkipped: true };
  }
  const base = current ?? '# CLAUDE.md\n';
  const trailingNewline = base.endsWith('\n') ? '' : '\n';
  await fs.writeFile(path, `${base}${trailingNewline}${CLAUDE_HINT_SECTION}`);
  return { claudeMdUpdated: true, claudeMdSkipped: false };
}

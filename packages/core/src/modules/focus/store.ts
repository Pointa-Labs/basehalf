import { dirname, join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';

const FOCUS_FILE = '.bh/focus.md';

const TEMPLATE_FOOTER = `
# (Updated automatically by bh GUI. Agent should read this at every message.
# 'active' = files user is currently focused on; navigate their badges + references
# in .bh/badges/ and .bh/index/inbound.json to compose your context.)
`.trimStart();

export function focusPath(workspaceRoot: string): string {
  return join(workspaceRoot, FOCUS_FILE);
}

/**
 * focus.md is a line-delimited, human-readable Markdown surface (agents
 * read it directly). A path containing a newline or carriage return can't
 * round-trip through it: renderFocus would emit a multi-line list item and
 * parseFocus would read only the first line, silently truncating the path
 * and dropping the rest of the active list. Reject such paths at the write
 * choke point rather than corrupt the contract surface. (Newlines in
 * filenames are legal on POSIX but pathological; the desktop never produces
 * them — NavTree/Canvas use real workspace-relative paths.)
 */
export function assertFocusablePath(path: string): void {
  if (/[\r\n]/.test(path)) {
    throw new Error(
      `focus: path contains a newline, which focus.md cannot represent: ${JSON.stringify(path)}`,
    );
  }
}

export function renderFocus(active: readonly string[]): string {
  const lines: string[] = ['# bh focus', ''];
  lines.push('active:');
  if (active.length === 0) {
    lines.push('  (none)');
  } else {
    for (const f of active) {
      lines.push(`  - ${f}`);
    }
  }
  lines.push('');
  lines.push(TEMPLATE_FOOTER);
  return lines.join('\n');
}

/**
 * Parse the `active:` block out of focus.md. Tolerant: any line shaped
 * `  - <path>` directly under `active:` counts; `(none)` resolves to empty.
 * Anything else (comments, blanks, footer) is ignored.
 */
export function parseFocus(content: string): readonly string[] {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === 'active:');
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) break;
    if (trimmed === '(none)') return [];
    if (trimmed.startsWith('- ')) {
      out.push(trimmed.slice(2).trim());
    } else {
      // Encountered a non-list line — end of the active block.
      break;
    }
  }
  return out;
}

export async function readFocus(fs: FsLike, workspaceRoot: string): Promise<readonly string[]> {
  const raw = await fs.readFile(focusPath(workspaceRoot));
  if (raw === null) return [];
  return parseFocus(raw);
}

export async function writeFocus(
  fs: FsLike,
  workspaceRoot: string,
  active: readonly string[],
): Promise<void> {
  for (const p of active) assertFocusablePath(p);
  const path = focusPath(workspaceRoot);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, renderFocus(active));
}

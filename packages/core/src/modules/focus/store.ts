import { dirname, join } from 'node:path';
import {
  type FsLike,
  assertReadContained,
  assertWriteContained,
  readMaybeNoFollow,
  writeMaybeNoFollow,
} from '../../kernel/index.js';
import type { FocusItem, FocusSource } from './types.js';

const FOCUS_FILE = '.bh/focus.md';

const TEMPLATE_FOOTER = `
# (Updated automatically by bh GUI. Agent should read this at every message.
# 'active' = files the user is focused on, with their prompts + reference notes
# inlined above. Follow the refs deeper in .bh/badges/ + .bh/index/inbound.json
# on your own budget if you need more.)
`.trimStart();

// Collapse to a single line so inlined prompts / notes can never inject a
// blank line or a `- ` that parseFocus would mistake for an active item.
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

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

/**
 * Render focus.md as a self-contained TURN BRIEF, not a bare path list. Each
 * active file carries its prompt + outbound reference-notes inlined, and an
 * optional `intent:` block carries the view prompt / task. The agent reads
 * the human's curated *meaning* in one pass; it can still follow refs deeper
 * on its own budget. Accepts plain strings too (treated as path-only items)
 * so callers that don't assemble a brief stay simple.
 */
export function renderFocus(
  active: readonly (FocusItem | string)[],
  intent?: string,
  source?: FocusSource,
  droppedCount = 0,
): string {
  const items: FocusItem[] = active.map((a) => (typeof a === 'string' ? { file: a } : a));
  const lines: string[] = ['# bh focus', ''];

  const trimmedIntent = intent ? oneLine(intent) : '';
  if (trimmedIntent) {
    lines.push(`intent: ${trimmedIntent}`);
    lines.push('');
  }

  lines.push('active:');
  if (items.length === 0) {
    lines.push('  (none)');
    // A `#` comment (ignored by parseFocus) so an empty brief isn't a dead read:
    // tell the agent what to do instead of handing back a blank turn.
    lines.push('  # no files are focused this turn — ask the user to select files on the');
    lines.push('  # canvas, or run `bh search <query>` to find relevant notes yourself.');
  } else {
    for (const item of items) {
      lines.push(`  - ${item.file}`);
      const prompt = item.prompt ? oneLine(item.prompt) : '';
      if (prompt) lines.push(`      prompt: ${prompt}`);
      // Freshness calibration (D1): when the file changed AFTER the note was
      // written, say so with both dates — the agent decides how much to trust
      // the note; bh states facts, never judgments. Indent 6 keeps the line
      // invisible to parseFocus (sub-line) and to the preview's prompt/ref
      // regexes, while surviving briefForClipboard into pasted chats.
      if (prompt && item.promptStale) {
        const day = (iso: string): string => iso.slice(0, 10);
        lines.push(
          `      (note may be stale: written ${day(item.promptStale.notedAt)}, file changed ${day(item.promptStale.fileChangedAt)})`,
        );
      }
      const refs = (item.refs ?? []).filter((r) => r.to);
      if (refs.length > 0) {
        lines.push('      refs:');
        for (const r of refs) {
          const note = r.note ? oneLine(r.note) : '';
          lines.push(note ? `        -> ${r.to}  (note: ${note})` : `        -> ${r.to}`);
        }
      }
      // The other direction: who points AT this file, with the connection note.
      // Indent 6 keeps it invisible to parseFocus (a sub-line), like refs.
      const inbound = (item.inbound ?? []).filter((b) => b.from);
      if (inbound.length > 0) {
        lines.push('      referenced-by:');
        for (const b of inbound) {
          const note = b.note ? oneLine(b.note) : '';
          lines.push(note ? `        <- ${b.from}  (note: ${note})` : `        <- ${b.from}`);
        }
      }
    }
  }
  lines.push('');
  // Heal receipt: when the liveness invariant dropped now-missing/orphan files
  // from the brief, say so in a `#` comment (which the agent ignores for `active:`
  // parsing) so a silently-shrunk brief is never a mystery.
  if (droppedCount > 0) {
    lines.push(
      `# note: ${droppedCount} previously-focused file(s) were deleted and dropped from this brief.`,
    );
    lines.push('');
  }
  // bh-internal PROVENANCE (a `#` comment the agent ignores): which folder
  // sourced this focus, so editing that folder's prompt can refresh the
  // `intent:` by exact identity — never by guessing from members/text. Written
  // only when the intent is folder-DERIVED (no manual override).
  const sid = source ? oneLine(source.id) : '';
  if (sid) lines.push(`# source-folder: ${sid}`);
  lines.push(TEMPLATE_FOOTER);
  return lines.join('\n');
}

/**
 * Parse the `active:` block out of focus.md back into the path list (the
 * round-trippable state; the inlined prompts/refs are additive context for
 * the agent, not state bh round-trips). Any `  - <path>` directly under
 * `active:` counts; `(none)` resolves to empty. Inlined sub-lines
 * (`prompt:` / `refs:` / `-> …`) are indented DEEPER than the list items, so
 * we skip them and keep scanning; a non-list line at the list indent (or a
 * blank / comment) ends the block.
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
      continue;
    }
    // Not a list item. Inlined sub-lines sit at indent ≥6; a foreign line at
    // the list indent (≤4) or shallower means the active block has ended.
    const indent = line.length - line.trimStart().length;
    if (indent > 4) continue;
    break;
  }
  return out;
}

export async function readFocus(fs: FsLike, workspaceRoot: string): Promise<readonly string[]> {
  const raw = await readMaybeNoFollow(
    fs,
    await assertReadContained(fs, workspaceRoot, focusPath(workspaceRoot)),
  );
  if (raw === null) return [];
  return parseFocus(raw);
}

/**
 * Parse the optional `intent:` line (the turn intent / view prompt, written
 * above `active:` by renderFocus). Needed so a caller re-setting focus can
 * PRESERVE the intent instead of dropping it — focus.set with no intent omits
 * the block. Returns undefined when there's no intent.
 */
export function parseIntent(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === 'active:') break; // intent always precedes the active list
    const m = /^intent:\s?(.*)$/.exec(line);
    if (m?.[1] && m[1].trim() !== '') return m[1].trim();
  }
  return undefined;
}

/**
 * Parse the bh-internal `# source-folder: <path>` provenance comment (the folder
 * this focus was published from). Used so editing that folder's prompt can
 * refresh the brief's intent by exact identity. Returns undefined when absent (a
 * files-sourced focus, or a manual intent override).
 */
export function parseSource(content: string): FocusSource | undefined {
  for (const line of content.split(/\r?\n/)) {
    const m = /^#\s*source-folder:\s?(.*)$/.exec(line.trim());
    if (m?.[1] && m[1].trim() !== '') {
      return { kind: 'folder', id: m[1].trim() };
    }
  }
  return undefined;
}

/** Read focus.md as the active list + intent + source provenance, in one read. */
export async function readFocusBrief(
  fs: FsLike,
  workspaceRoot: string,
): Promise<{ active: readonly string[]; intent?: string; source?: FocusSource }> {
  const raw = await readMaybeNoFollow(
    fs,
    await assertReadContained(fs, workspaceRoot, focusPath(workspaceRoot)),
  );
  if (raw === null) return { active: [] };
  const intent = parseIntent(raw);
  const source = parseSource(raw);
  return {
    active: parseFocus(raw),
    ...(intent !== undefined && { intent }),
    ...(source !== undefined && { source }),
  };
}

export async function writeFocus(
  fs: FsLike,
  workspaceRoot: string,
  active: readonly (FocusItem | string)[],
  intent?: string,
  source?: FocusSource,
  droppedCount = 0,
): Promise<void> {
  for (const a of active) assertFocusablePath(typeof a === 'string' ? a : a.file);
  const path = await assertWriteContained(fs, workspaceRoot, focusPath(workspaceRoot));
  await fs.mkdir(dirname(path), { recursive: true });
  await writeMaybeNoFollow(fs, path, renderFocus(active, intent, source, droppedCount));
  // Any focus.md write CHANGES the brief → a served receipt (an agent pulled the
  // PREVIOUS brief) is now stale. Clear it at this single write choke point so
  // every writer (set/resync/toggle/folder/prune/clear) invalidates it uniformly
  // and "served Ns ago" never outlives the brief it referred to. Best-effort.
  await clearBriefServed(fs, workspaceRoot);
}

const SERVED_FILE = '.bh/cache/focus-served.json';

/** Path to the workspace-scoped brief-read receipt (in .bh/cache/, gitignored). */
function servedPath(workspaceRoot: string): string {
  return join(workspaceRoot, SERVED_FILE);
}

/**
 * Stamp "the brief was pulled by an agent" — written by focus.brief when an agent
 * PULLS it through the command interface (CLI `bh focus brief`, the desktop
 * Copy-brief hand-off, a future MCP get_brief). Honest semantics: it records a
 * genuine hand-off, NOT comprehension — and the in-app preview reads with
 * `{stamp:false}`, so merely PEEKING at the brief never counts as a delivery.
 * (A raw `.bh/focus.md` file read by an in-repo agent is unobservable by design —
 * D14 publish-not-inject — so this signal covers the command/copy path only.)
 * Cleared on every focus change (see clearBriefServed). Lives in .bh/cache/
 * (gitignored, rebuildable). Best-effort at the call site — a cache hiccup must
 * never fail a read.
 */
export async function stampBriefServed(fs: FsLike, workspaceRoot: string): Promise<void> {
  const path = await assertWriteContained(fs, workspaceRoot, servedPath(workspaceRoot));
  await fs.mkdir(dirname(path), { recursive: true });
  await writeMaybeNoFollow(fs, path, `${JSON.stringify({ servedAt: new Date().toISOString() })}\n`);
}

/**
 * Clear the served receipt — called on EVERY brief change (writeBrief), so
 * "served Ns ago" only ever reflects the CURRENT focus, never a stale set the
 * agent pulled before the user re-curated. Best-effort; unlink no-ops when the
 * receipt is absent. A cache hiccup must never fail a focus write.
 */
export async function clearBriefServed(fs: FsLike, workspaceRoot: string): Promise<void> {
  try {
    await fs.unlink(await assertWriteContained(fs, workspaceRoot, servedPath(workspaceRoot)));
  } catch {
    /* best-effort: the receipt is rebuildable + non-load-bearing */
  }
}

/** Read the last brief-served timestamp (ISO), or undefined if never served. */
export async function readBriefServedAt(
  fs: FsLike,
  workspaceRoot: string,
): Promise<string | undefined> {
  try {
    const raw = await readMaybeNoFollow(
      fs,
      await assertReadContained(fs, workspaceRoot, servedPath(workspaceRoot)),
    );
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as { servedAt?: unknown };
    return typeof parsed.servedAt === 'string' ? parsed.servedAt : undefined;
  } catch {
    // Rebuildable, non-load-bearing: a bad .bh/cache entry (escaping symlink,
    // unreadable/cyclic dir) must NEVER break focus.get — it's on the hot canvas
    // load/poll path. Any failure → "no receipt".
    return undefined;
  }
}

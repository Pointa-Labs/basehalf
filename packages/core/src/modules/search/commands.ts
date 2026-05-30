import { join } from 'node:path';
import type { Handler } from '../../kernel/index.js';
import type { SearchHit, SearchMatch, SearchQueryArgs, SearchQueryResult } from './types.js';

// Directories we never descend into. A superset of the renderer's NavTree
// HIDDEN_NAMES + the materialize SKIP_NAMES — `workspace.listFiles` is
// deliberately unopinionated about hidden files ("filtering is the renderer's
// job"), so search must prune tooling/cache dirs itself or it would match its
// OWN derived state under `.bh/` (badge JSON, focus.md) and treat `node_modules`
// as searchable content. Security containment is NOT this set's job — a
// symlink-escape is refused by listFiles' realpath guard regardless. (v0.x
// consolidates the three copies into `.bh/config.json`.)
const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.bh',
  '.DS_Store',
  '.idea',
  '.vscode',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'node_modules',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.pytest_cache',
  'target',
  'vendor',
]);

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_MATCHES_PER_FILE = 5;
// Per-file read budget (chars). Covers ~any hand-written note in full; a bigger
// file is searched up to here and flagged `truncated`. Bounds the work a single
// keystroke-driven search does so the palette stays responsive (the renderer
// also debounces). workspace.readFile turns this into a BOUNDED partial read,
// so even a multi-GB mis-placed file never lands in memory whole.
const PER_FILE_MAX_CHARS = 100_000;
// A single matching line is windowed to this many chars around the first match
// so a minified line (one 2 MB line) doesn't ship as a "snippet".
const SNIPPET_MAX_CHARS = 200;
// Hard ceiling on directories walked — a backstop against a pathological deep
// tree turning one search into an unbounded crawl. Far above any real workspace.
const MAX_DIRS = 5_000;

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/**
 * Window a matching line around the first occurrence of the needle, trimmed and
 * capped to SNIPPET_MAX_CHARS with leading/trailing ellipses when clipped. Keeps
 * the matched text visible even in a very long line without shipping the whole
 * line. `needleLower`/`lineLower` are the pre-lowercased forms (the caller
 * already has them, so we don't re-lowercase per line).
 */
function snippet(line: string, lineLower: string, needleLower: string): string {
  const trimmedStart = line.length - line.trimStart().length;
  const collapsed = line.trim();
  if (collapsed.length <= SNIPPET_MAX_CHARS) return collapsed;
  // Long line: center the window on the first match (relative to the trimmed
  // line, since that's what we return).
  const matchInLine = lineLower.indexOf(needleLower);
  const matchInTrimmed = Math.max(0, matchInLine - trimmedStart);
  const half = Math.floor((SNIPPET_MAX_CHARS - needleLower.length) / 2);
  let start = Math.max(0, matchInTrimmed - half);
  let end = Math.min(collapsed.length, start + SNIPPET_MAX_CHARS);
  // If clamping at the end pulled the window short, slide it left to fill.
  start = Math.max(0, end - SNIPPET_MAX_CHARS);
  end = Math.min(collapsed.length, start + SNIPPET_MAX_CHARS);
  const core = collapsed.slice(start, end);
  return `${start > 0 ? '…' : ''}${core}${end < collapsed.length ? '…' : ''}`;
}

/**
 * `search.query({ query })` — case-insensitive full-text search over the
 * current workspace's text files. Returns matching files with snippet lines.
 *
 * Drives enumeration through `workspace.listFiles` and reads through
 * `workspace.readFile` (both via ctx.run, never importing the workspace
 * module's internals) — so the realpath-containment, O_NOFOLLOW, capped-read
 * and binary-sniff hardening all apply for free. Binary files are skipped.
 */
export const query: Handler<SearchQueryArgs, SearchQueryResult> = async (args, ctx) => {
  const needle = (args.query ?? '').trim();
  if (needle.length === 0) return { query: '', hits: [] };
  const needleLower = needle.toLowerCase();

  const cur = (await ctx.run('workspace.current', {})) as {
    current: { path: string } | null;
  };
  if (!cur.current) throw new Error('No current workspace; call workspace.use first');
  const root = cur.current.path;

  const maxFiles = clampPositive(args.maxFiles, DEFAULT_MAX_FILES);
  const maxMatchesPerFile = clampPositive(args.maxMatchesPerFile, DEFAULT_MAX_MATCHES_PER_FILE);

  const hits: SearchHit[] = [];
  let truncated = false;
  let dirsWalked = 0;

  // Iterative DFS so a deep tree can't blow the call stack. Each frame carries
  // the absolute path (for listFiles) + the workspace-relative POSIX path (for
  // readFile and the result).
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }];
  outer: while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (++dirsWalked > MAX_DIRS) {
      truncated = true;
      break;
    }
    let listing: { entries: ReadonlyArray<{ name: string; type: 'file' | 'dir' }> };
    try {
      listing = (await ctx.run('workspace.listFiles', { path: frame.abs })) as typeof listing;
    } catch {
      // A directory that vanished / became unreachable mid-walk (or a
      // symlink-escape listFiles refuses) — skip it, don't abort the search.
      continue;
    }
    // Sort entries for a deterministic walk order (dirs and files interleaved
    // alphabetically); listFiles already sorts dirs-first, but we push dirs to a
    // LIFO stack so reverse them to keep alphabetical pop order.
    const dirs: (typeof frame)[] = [];
    for (const entry of listing.entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const childRel = frame.rel ? `${frame.rel}/${entry.name}` : entry.name;
      const childAbs = join(frame.abs, entry.name);
      if (entry.type === 'dir') {
        dirs.push({ abs: childAbs, rel: childRel });
        continue;
      }
      let file: { content: string; truncated?: boolean; binary?: boolean };
      try {
        file = (await ctx.run('workspace.readFile', {
          path: childRel,
          maxChars: PER_FILE_MAX_CHARS,
        })) as typeof file;
      } catch {
        continue; // unreadable file (vanished, refused) — skip
      }
      if (file.binary) continue;
      const contentLower = file.content.toLowerCase();
      if (!contentLower.includes(needleLower)) continue;

      const lines = file.content.split(/\r?\n/);
      const matches: SearchMatch[] = [];
      let total = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const lineLower = line.toLowerCase();
        if (!lineLower.includes(needleLower)) continue;
        total++;
        if (matches.length < maxMatchesPerFile) {
          matches.push({ line: i + 1, text: snippet(line, lineLower, needleLower) });
        }
      }
      // contentLower matched but no single line did → the needle straddled a
      // newline (a multi-line query). Skip rather than emit a hit with no
      // snippet; per-line is our snippet unit.
      if (total === 0) continue;

      hits.push({
        file: childRel,
        matches,
        total,
        ...(file.truncated && { truncated: true }),
      });
      if (hits.length >= maxFiles) {
        truncated = true;
        break outer;
      }
    }
    // Push dirs reversed so alphabetical-first pops first off the LIFO stack.
    for (let i = dirs.length - 1; i >= 0; i--) {
      const d = dirs[i];
      if (d) stack.push(d);
    }
  }

  hits.sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));

  return { query: needle, hits, ...(truncated && { truncated: true }) };
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [['search.query', query as unknown as Handler<never, unknown>]];
}

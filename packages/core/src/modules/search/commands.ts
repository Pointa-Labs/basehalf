import { join } from 'node:path';
import { type Handler, canonicalize, requireWorkspaceRoot } from '../../kernel/index.js';
import type {
  SearchBriefArgs,
  SearchBriefResult,
  SearchHit,
  SearchMatch,
  SearchQueryArgs,
  SearchQueryResult,
} from './types.js';

// Directories we never descend into. A superset of the renderer's NavTree
// HIDDEN_NAMES + the materialize SKIP_NAMES — `workspace.listFiles` is
// deliberately unopinionated about hidden files ("filtering is the renderer's
// job"), so search must prune tooling/cache dirs itself or it would match its
// OWN derived state under `.bh/` (the mirror YAML tree) and treat `node_modules`
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
// Hard ceiling on FILES read in one search. We scan the whole tree (not just
// the first `maxFiles` matches) so results can be RANKED before the cap — but a
// pathological flat dir of 1M files still needs a bound. Hitting it flags the
// result `truncated`. Far above any real workspace.
const MAX_FILES_SCANNED = 20_000;

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

// ── Matcher — substring / whole-word / regex, case-(in)sensitive ──────────────
// VS Code's search options (Aa / ab| / .*) modeled as one non-global RegExp.
// Non-global so `.test()` / `.exec()` carry no lastIndex state (each starts at 0).
interface Matcher {
  /** Any match anywhere in `s` (the content pre-filter). */
  test(s: string): boolean;
  /** The first match in one line, or null. */
  firstMatch(line: string): { readonly index: number; readonly length: number } | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a Matcher, or null for an invalid user regex (→ caller returns no hits). */
function buildMatcher(
  needle: string,
  opts: {
    caseSensitive?: boolean | undefined;
    wholeWord?: boolean | undefined;
    regex?: boolean | undefined;
  },
): Matcher | null {
  let source = opts.regex === true ? needle : escapeRegExp(needle);
  if (opts.wholeWord === true) source = `\\b(?:${source})\\b`;
  let re: RegExp;
  try {
    re = new RegExp(source, opts.caseSensitive === true ? '' : 'i');
  } catch {
    return null; // malformed regex — graceful empty result
  }
  return {
    test: (s) => re.test(s),
    firstMatch: (line) => {
      const m = re.exec(line);
      return m ? { index: m.index, length: m[0].length } : null;
    },
  };
}

/**
 * Window a matching line around the first occurrence of the needle, trimmed and
 * capped to SNIPPET_MAX_CHARS with leading/trailing ellipses when clipped. Keeps
 * the matched text visible even in a very long line without shipping the whole
 * line. `needleLower`/`lineLower` are the pre-lowercased forms (the caller
 * already has them, so we don't re-lowercase per line).
 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function snippet(line: string, matchIndex: number, matchLen: number): string {
  const trimmedStart = line.length - line.trimStart().length;
  const collapsed = line.trim();
  if (collapsed.length <= SNIPPET_MAX_CHARS) return collapsed;
  // Long line: center the window on the first match (relative to the trimmed
  // line, since that's what we return). `half` is clamped to ≥0 so a needle
  // LONGER than the window (a pasted long phrase) still anchors the window at
  // the match start instead of being pushed past it.
  const matchInTrimmed = Math.max(0, matchIndex - trimmedStart);
  const half = Math.max(0, Math.floor((SNIPPET_MAX_CHARS - matchLen) / 2));
  let start = Math.max(0, matchInTrimmed - half);
  let end = Math.min(collapsed.length, start + SNIPPET_MAX_CHARS);
  // If clamping at the end pulled the window short, slide it left to fill.
  start = Math.max(0, end - SNIPPET_MAX_CHARS);
  end = Math.min(collapsed.length, start + SNIPPET_MAX_CHARS);
  // Snap the window off any surrogate-pair boundary so a clipped emoji / astral
  // char never ships as a lone surrogate (renders as U+FFFD). When start lands
  // on a low surrogate its high half is outside the window → drop the orphan;
  // when end-1 is a high surrogate its low half is outside → drop it. The `…`
  // already covers the dropped half.
  if (start > 0 && isLowSurrogate(collapsed.charCodeAt(start))) start++;
  if (end < collapsed.length && isHighSurrogate(collapsed.charCodeAt(end - 1))) end--;
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
  const matcher = buildMatcher(needle, {
    caseSensitive: args.caseSensitive,
    wholeWord: args.wholeWord,
    regex: args.regex,
  });
  // Malformed user regex → no hits (the panel just shows "no results").
  if (matcher === null) return { query: needle, hits: [] };

  const root = requireWorkspaceRoot(ctx);

  const maxFiles = clampPositive(args.maxFiles, DEFAULT_MAX_FILES);
  const maxMatchesPerFile = clampPositive(args.maxMatchesPerFile, DEFAULT_MAX_MATCHES_PER_FILE);

  const hits: SearchHit[] = [];
  let truncated = false;
  let dirsWalked = 0;
  let filesScanned = 0;

  // Iterative DFS so a deep tree can't blow the call stack. Each frame carries
  // the absolute path (for listFiles) + the workspace-relative POSIX path (for
  // readFile and the result). `visited` holds canonical (realpath) dirs already
  // walked: workspace.listFiles contains children to the workspace but does NOT
  // cycle-guard the CALLER's recursion, so an IN-BOUNDS directory symlink back
  // to an ancestor (e.g. `notes/self -> ..`) would otherwise make us rescan the
  // same tree until MAX_DIRS (duplicate hits + a spurious truncated flag). Dedup
  // on the canonical path the way materializeWorkspace does.
  const visited = new Set<string>();
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }];
  outer: while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    let realDir: string;
    try {
      realDir = await canonicalize(ctx.fs, frame.abs);
    } catch (err) {
      // Root canonicalize failing = workspace gone/unmounted → surface it (same
      // policy as the listFiles failure below); a child that vanished is skipped.
      if (frame.rel === '') throw err;
      continue;
    }
    if (visited.has(realDir)) continue; // symlink cycle / already walked
    visited.add(realDir);
    if (++dirsWalked > MAX_DIRS) {
      truncated = true;
      break;
    }
    let listing: { entries: ReadonlyArray<{ name: string; type: 'file' | 'dir' }> };
    try {
      listing = (await ctx.run('workspace.listFiles', { path: frame.abs })) as typeof listing;
    } catch (err) {
      // The ROOT listing failing means the active workspace is gone / unmounted
      // / unreachable — surface that (PATH_NOT_FOUND / containment) rather than
      // report "no matches" for a broken workspace. Only a CHILD dir that
      // vanished mid-walk (or a symlink-escape listFiles refuses) is skipped.
      if (frame.rel === '') throw err;
      continue;
    }
    // listFiles already returns entries sorted (dirs-first, then alphabetical);
    // we collect child dirs here and push them REVERSED below so the LIFO stack
    // pops them alphabetically. (Final result order is fixed by the rank-before-
    // cap sort at the end, so walk order only affects tie-broken traversal.)
    const dirs: (typeof frame)[] = [];
    for (const entry of listing.entries) {
      const childRel = frame.rel ? `${frame.rel}/${entry.name}` : entry.name;
      const childAbs = join(frame.abs, entry.name);
      if (entry.type === 'dir') {
        // SKIP_DIRS prunes tooling/cache DIRECTORIES only — a regular FILE whose
        // basename happens to be `build` / `vendor` / `node_modules` (an
        // extensionless note) is still searched.
        if (SKIP_DIRS.has(entry.name)) continue;
        dirs.push({ abs: childAbs, rel: childRel });
        continue;
      }
      // Scan budget: we deliberately read EVERY candidate file (so the result
      // set can be ranked, not just the first `maxFiles` in traversal order),
      // bounded only by this backstop.
      if (++filesScanned > MAX_FILES_SCANNED) {
        truncated = true;
        break outer;
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
      // A file longer than the per-file cap was only PARTIALLY searched, so a
      // match could lie beyond the prefix — flag the whole result as incomplete
      // whether or not the prefix matched, so "no matches" never hides a capped
      // large file.
      if (file.truncated) truncated = true;
      if (!matcher.test(file.content)) continue;

      // Split on LF, CRLF, AND bare CR (classic-Mac) so line numbers + per-line
      // snippets stay correct and no interior \r leaks into a snippet.
      const lines = file.content.split(/\r\n|\r|\n/);
      const matches: SearchMatch[] = [];
      let total = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const fm = matcher.firstMatch(line);
        if (fm === null) continue;
        total++;
        if (matches.length < maxMatchesPerFile) {
          matches.push({ line: i + 1, text: snippet(line, fm.index, fm.length) });
        }
      }
      // content matched but no single line did → the needle straddled a newline
      // (a multi-line query / regex). Skip rather than emit a hit with no
      // snippet; per-line is our snippet unit.
      if (total === 0) continue;

      hits.push({
        file: childRel,
        matches,
        total,
        ...(file.truncated && { truncated: true }),
      });
    }
    // Push dirs reversed so alphabetical-first pops first off the LIFO stack.
    for (let i = dirs.length - 1; i >= 0; i--) {
      const d = dirs[i];
      if (d) stack.push(d);
    }
  }

  // ABOUTNESS BOOST: a file whose human-written badge DESCRIPTION is about the
  // query is surfaced ABOVE files that merely contain the phrase more times — "the
  // note that's ABOUT supply-demand" beats "a note that mentions it once". The
  // description is our intent signal; ranking by it (not just raw match count) is
  // exactly where structured retrieval beats plain grep. SPARSE-SAFE: only files
  // that already carry a matching description get the boost; un-annotated files
  // keep the prior match-count ordering untouched. Best-effort: the badge layer
  // not being registered (a test wiring a subset) or erroring degrades to the old
  // count-only rank, never fails the search. One badge.list call, not one per hit.
  const aboutFiles = new Set<string>();
  try {
    const { badges } = (await ctx.run('badge.list', { query: needleLower })) as {
      badges: ReadonlyArray<{ path: string; description?: string }>;
    };
    for (const b of badges) {
      if ((b.description ?? '').toLowerCase().includes(needleLower)) aboutFiles.add(b.path);
    }
  } catch {
    /* badge module absent / errored — rank by match count alone */
  }

  // Rank BEFORE applying the file cap so the strongest results survive — not just
  // whichever files came first in traversal order. Sort keys, in order:
  //   1. description "aboutness" (a matching badge description first),
  //   2. content match count (desc),
  //   3. path (asc, stable tie-break).
  // The cap is a RESULT cap (top-N by relevance), not a traversal-order cut; a
  // capped result set is flagged `truncated`.
  hits.sort(
    (a, b) =>
      (aboutFiles.has(a.file) ? 0 : 1) - (aboutFiles.has(b.file) ? 0 : 1) ||
      b.total - a.total ||
      a.file.localeCompare(b.file),
  );
  const capped = hits.length > maxFiles;
  const top = capped ? hits.slice(0, maxFiles) : hits;

  return { query: needle, hits: top, ...((truncated || capped) && { truncated: true }) };
};

// Brief defaults: a context-sized file set (what fits a chat hand-off), not a
// result page. `search.query`'s own defaults (50 files) are for browsing.
const BRIEF_MAX_FILES = 8;
const BRIEF_MAX_MATCHES_PER_FILE = 3;

/**
 * `search.brief({ query })` — assemble a paste-ready context brief by RETRIEVAL.
 *
 * Focus is viewport-sourced: it mirrors what the user is looking at. This is the
 * other on-ramp — "I know what I want to ask, not which files matter": content
 * search finds the files, then each hit is hydrated with its badge prompt,
 * reference notes, and inbound (referenced_by) notes (via ctx.run — the badge
 * graph stays behind its own door, and its absence degrades to a plain match
 * list). The output is self-contained Markdown ready to paste into any AI chat.
 */
export const brief: Handler<SearchBriefArgs, SearchBriefResult> = async (args, ctx) => {
  const res = (await ctx.run('search.query', {
    query: args.query,
    maxFiles: clampPositive(args.maxFiles, BRIEF_MAX_FILES),
    maxMatchesPerFile: clampPositive(args.maxMatchesPerFile, BRIEF_MAX_MATCHES_PER_FILE),
  })) as SearchQueryResult;

  const lines: string[] = ['# bh search brief', '', `query: ${res.query}`, ''];
  if (res.hits.length === 0) {
    lines.push('results:', '  (none)');
  } else {
    lines.push('results:');
    for (const hit of res.hits) {
      lines.push(`  - ${hit.file}`);
      // Hydrate with the human-written layer. Both reads are best-effort: a
      // missing badge (sparse overlay), an unregistered module (UnknownCommand)
      // or a transient read error must degrade the brief, never fail it.
      // References / backlinks are PLAIN PATHS now (the edge note moved to
      // canvas.yaml), so the brief inlines bare topology + the description.
      type HydratedBadge = {
        description?: string;
        references?: string[];
        referenced_by?: string[];
      } | null;
      let badge: HydratedBadge = null;
      try {
        badge = (await ctx.run('badge.get', { file: hit.file, kind: 'file' })) as HydratedBadge;
      } catch {
        badge = null;
      }
      const prompt = badge?.description?.trim();
      if (prompt !== undefined && prompt !== '') lines.push(`      description: ${prompt}`);
      for (const m of hit.matches) {
        lines.push(`      match (line ${m.line}): ${m.text}`);
      }
      const refs = badge?.references ?? [];
      if (refs.length > 0) {
        lines.push('      refs:');
        for (const ref of refs) lines.push(`        -> ${ref}`);
      }
      // The OTHER side of the graph: who points AT this file — often exactly the
      // context a retrieval-sourced brief is missing.
      const inbound = badge?.referenced_by ?? [];
      if (inbound.length > 0) {
        lines.push('      referenced-by:');
        for (const from of inbound) lines.push(`        <- ${from}`);
      }
    }
  }
  lines.push(
    '',
    '# (Assembled by content search — each file inlines its human-written notes.',
    '#  Files were matched by content; those whose description is ABOUT the query',
    '#  rank first. Still retrieval, not hand-curation — treat relevance accordingly.)',
  );

  return {
    query: res.query,
    brief: `${lines.join('\n')}\n`,
    files: res.hits.map((h) => h.file),
    ...(res.truncated === true && { truncated: true }),
  };
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['search.query', query as unknown as Handler<never, unknown>],
    ['search.brief', brief as unknown as Handler<never, unknown>],
  ];
}

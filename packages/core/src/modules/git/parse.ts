// Pure parsers for git's porcelain output. Kept separate from commands.ts so
// they're unit-testable without a real git (the trickiest, most regression-prone
// part of the module). Grounded in the actual bytes of
// `git status --porcelain=v1 -z --branch` (see git-parse.test.ts).
import type { GitCommit, GitCommitFile, GitFileStatus, GitStashEntry } from './types.js';

export interface ParsedBranchHeader {
  readonly branch: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
}

/**
 * Parse the `## …` branch header line (the part AFTER `## `). Forms:
 *   "main"                                  → no upstream
 *   "main...origin/main"                    → upstream, in sync
 *   "main...origin/main [ahead 1, behind 2]"→ divergence (either/both bracketed)
 *   "main...origin/main [gone]"             → upstream gone (ahead/behind 0)
 *   "HEAD (no branch)"                      → detached
 *   "No commits yet on main"                → unborn (branch known, no HEAD)
 */
export function parseBranchHeader(header: string): ParsedBranchHeader {
  if (header.startsWith('HEAD (no branch)')) {
    return { branch: null, detached: true, upstream: null, ahead: 0, behind: 0 };
  }
  const unborn = header.match(/^No commits yet on (.+)$/);
  if (unborn) {
    return { branch: unborn[1] ?? null, detached: false, upstream: null, ahead: 0, behind: 0 };
  }
  // "<branch>...<upstream>[ optional " [ahead N, behind M]" ]". A branch name
  // can't contain "..." (git refname rules), so the first "..." splits cleanly.
  const tracked = header.match(/^(.+?)\.\.\.(\S+)(?:\s+\[(.+)\])?$/);
  if (tracked) {
    const bracket = tracked[3] ?? '';
    const ahead = bracket.match(/ahead (\d+)/);
    const behind = bracket.match(/behind (\d+)/);
    return {
      branch: tracked[1] ?? null,
      detached: false,
      upstream: tracked[2] ?? null,
      ahead: ahead ? Number.parseInt(ahead[1] ?? '0', 10) : 0,
      behind: behind ? Number.parseInt(behind[1] ?? '0', 10) : 0,
    };
  }
  return { branch: header.trim(), detached: false, upstream: null, ahead: 0, behind: 0 };
}

export interface ParsedStatus extends ParsedBranchHeader {
  readonly files: GitFileStatus[];
}

/**
 * Parse `git status --porcelain=v1 -z --branch`. NUL-separated fields: a leading
 * `## …` header, then one `XY␣path` field per change (X = index, Y = work-tree).
 * A rename/copy is followed by an extra field carrying the ORIGINAL path. Untracked
 * is `??`, ignored `!!`.
 */
export function parseStatus(raw: string): ParsedStatus {
  const fields = raw.split('\0').filter((f) => f.length > 0);
  let header: ParsedBranchHeader = {
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  };
  const files: GitFileStatus[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field === undefined) continue;
    if (field.startsWith('## ')) {
      header = parseBranchHeader(field.slice(3));
      continue;
    }
    // "XY path": positions 0,1 = X,Y; position 2 = space; 3+ = path.
    const x = field[0] ?? ' ';
    const y = field[1] ?? ' ';
    const path = field.slice(3);
    // A rename/copy carries an extra SOURCE field. The trigger is X OR Y being
    // 'R', or X being 'C' — matching git's own porcelain emitter. Checking only
    // X (the old code) mis-parsed a work-tree-side rename: the source path got
    // consumed as the NEXT entry, cascading the whole remaining file list out of
    // alignment. (Mirrors VS Code's GitStatusParser — extensions/git/src/git.ts.)
    if (x === 'R' || y === 'R' || x === 'C') {
      const orig = fields[i + 1];
      i++;
      files.push(orig !== undefined ? { path, x, y, orig } : { path, x, y });
    } else {
      files.push({ path, x, y });
    }
  }
  return { ...header, files };
}

/**
 * Parse `git stash list --format=%gd%x1f%s` — one entry per line, the stash ref
 * (`stash@{0}`) and its subject separated by US (\x1f).
 */
export function parseStashList(raw: string): GitStashEntry[] {
  const entries: GitStashEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    const sep = line.indexOf('\x1f');
    if (sep === -1) {
      entries.push({ ref: line, message: '' });
    } else {
      entries.push({ ref: line.slice(0, sep), message: line.slice(sep + 1) });
    }
  }
  return entries;
}

/** True for a porcelain XY pair that marks an unmerged (conflict) entry. */
export function isConflict(x: string, y: string): boolean {
  const xy = x + y;
  return xy === 'DD' || xy === 'AA' || xy === 'UU' || x === 'U' || y === 'U';
}

// ── git log parsing ──────────────────────────────────────────────────────────
// `git.log` emits each commit with fields joined by US (\x1f) and records ended
// by RS (\x1e) — ASCII control bytes that effectively never occur in commit text,
// so subjects/bodies with spaces, newlines, or "..." parse cleanly (NUL can't be
// used: a SHA/body is text, but the field set here mixes message bytes). The
// `%x1f`/`%x1e` git format escapes in commands.ts (LOG_FORMAT) emit exactly these.
const LOG_FIELD = '\x1f';
const LOG_RECORD = '\x1e';

/**
 * Parse the `%D` decoration string (e.g. "HEAD -> main, origin/main, tag: v1")
 * into the plain ref names pointing at a commit + whether HEAD is among them.
 * "HEAD -> main" → head + ref "main"; bare "HEAD" (detached) → head, no ref;
 * "tag: v1" → ref "v1".
 */
function parseDecorations(raw: string): { refs: string[]; head: boolean } {
  const refs: string[] = [];
  let head = false;
  for (const token of raw.split(',').map((s) => s.trim())) {
    if (token === '') continue;
    if (token === 'HEAD') {
      head = true;
      continue;
    }
    const arrow = token.match(/^HEAD -> (.+)$/);
    if (arrow) {
      head = true;
      if (arrow[1] !== undefined) refs.push(arrow[1]);
      continue;
    }
    refs.push(token.startsWith('tag: ') ? token.slice(5) : token);
  }
  return { refs, head };
}

/**
 * Parse the raw stdout of `git log --format=<LOG_FORMAT>` into structured commits.
 * Records are RS-separated; git's `tformat` adds a trailing newline after each, so
 * a leading newline is stripped per record. Defensive: a record with too few
 * fields is skipped rather than throwing (one corrupt line shouldn't sink history).
 */
export function parseLog(raw: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const rawRecord of raw.split(LOG_RECORD)) {
    const record = rawRecord.replace(/^\n/, '');
    if (record === '') continue;
    const f = record.split(LOG_FIELD);
    if (f.length < 12) continue;
    const [hash, shortHash, parents, an, ae, ad, cn, ce, cd, decorations, subject, ...bodyParts] =
      f;
    // body is the last field; rejoin defensively in case it ever contained US.
    const body = bodyParts.join(LOG_FIELD);
    const { refs, head } = parseDecorations(decorations ?? '');
    commits.push({
      hash: hash ?? '',
      shortHash: shortHash ?? '',
      parents: (parents ?? '').split(' ').filter((p) => p.length > 0),
      author: { name: an ?? '', email: ae ?? '', date: ad ?? '' },
      committer: { name: cn ?? '', email: ce ?? '', date: cd ?? '' },
      subject: subject ?? '',
      body,
      refs,
      head,
    });
  }
  return commits;
}

/**
 * Parse `git diff-tree --name-status -r -z` (NUL-separated). Each entry is a
 * status field (`M`, `A`, `D`, `R100`, `C75`, …) followed by its path; a rename
 * or copy (`R`/`C`) carries TWO paths — the source then the destination. Mirrors
 * the rename handling in parseStatus, just over diff-tree's name-status stream.
 */
export function parseNameStatus(raw: string): GitCommitFile[] {
  const fields = raw.split('\0').filter((f) => f.length > 0);
  const files: GitCommitFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i];
    if (code === undefined) continue;
    const status = code[0] ?? 'M';
    if (status === 'R' || status === 'C') {
      const orig = fields[i + 1];
      const dest = fields[i + 2];
      i += 2;
      if (dest !== undefined) {
        files.push(orig !== undefined ? { path: dest, status, orig } : { path: dest, status });
      }
    } else {
      const path = fields[i + 1];
      i += 1;
      if (path !== undefined) files.push({ path, status });
    }
  }
  return files;
}

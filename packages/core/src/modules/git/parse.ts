// Pure parsers for git's porcelain output. Kept separate from commands.ts so
// they're unit-testable without a real git (the trickiest, most regression-prone
// part of the module). Grounded in the actual bytes of
// `git status --porcelain=v1 -z --branch` (see git-parse.test.ts).
import type { GitFileStatus } from './types.js';

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

/** True for a porcelain XY pair that marks an unmerged (conflict) entry. */
export function isConflict(x: string, y: string): boolean {
  const xy = x + y;
  return xy === 'DD' || xy === 'AA' || xy === 'UU' || x === 'U' || y === 'U';
}

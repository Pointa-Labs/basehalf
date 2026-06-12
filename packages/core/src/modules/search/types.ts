/**
 * Content search — full-text "find that note where I wrote about X" across a
 * workspace's text files. The retrieval leg the command palette was missing:
 * badge.list matches paths + the user's prompt, but never the file BODY.
 *
 * Read-only and case-insensitive substring (the same "dead simple, no fuzzy
 * distance yet" taste as the palette). Walks via the already-hardened
 * `workspace.listFiles` + reads via `workspace.readFile`, so every path-escape
 * / binary-sniff / capped-read guard is inherited, not re-implemented.
 */

export interface SearchQueryArgs {
  /** The substring to look for. Empty / whitespace-only → no hits. */
  readonly query: string;
  /** Max files to return (default 50). The result flags `truncated` when more
   *  files matched than this cap. */
  readonly maxFiles?: number;
  /** Max snippet lines to return PER file (default 5). `hit.total` still
   *  reports the real per-file match count even when capped here. */
  readonly maxMatchesPerFile?: number;
}

/** One matching line inside a file. */
export interface SearchMatch {
  /** 1-based line number of the match. */
  readonly line: number;
  /** The matching line, trimmed + windowed around the first match so a
   *  minified or very long line doesn't blow up the result. */
  readonly text: string;
}

/** One file with at least one content match. */
export interface SearchHit {
  /** Workspace-relative POSIX path (same shape badge / focus use). */
  readonly file: string;
  /** Up to `maxMatchesPerFile` matching lines. */
  readonly matches: readonly SearchMatch[];
  /** Total matching lines in the (possibly capped) content — may exceed
   *  `matches.length`. */
  readonly total: number;
  /** The file was longer than the per-file read cap, so only its prefix was
   *  searched. Surfaced so a UI can hint "searched the first part." */
  readonly truncated?: boolean;
}

export interface SearchQueryResult {
  /** Echo of the trimmed query actually searched for. */
  readonly query: string;
  /** Hits, sorted by match count (desc) then path (asc). */
  readonly hits: readonly SearchHit[];
  /** More files matched than `maxFiles`; the list was capped. */
  readonly truncated?: boolean;
}

export interface SearchBriefArgs {
  /** The substring to look for. Empty / whitespace-only → empty brief. */
  readonly query: string;
  /** Max files to include (default 8 — a context-sized set, not a result page). */
  readonly maxFiles?: number;
  /** Max snippet lines PER file (default 3). */
  readonly maxMatchesPerFile?: number;
}

export interface SearchBriefResult {
  /** Echo of the trimmed query. */
  readonly query: string;
  /** The assembled, self-contained Markdown brief — content matches hydrated
   *  with each file's badge prompt + reference notes + inbound notes. Ready to
   *  paste into any AI chat (same spirit as `.bh/focus.md`, but assembled by
   *  RETRIEVAL instead of explicit curation — the on-ramp for "I know what I
   *  want to ask but not which files matter"). */
  readonly brief: string;
  /** The files the brief covers, in brief order. */
  readonly files: readonly string[];
  /** The underlying search was capped / incomplete. */
  readonly truncated?: boolean;
}

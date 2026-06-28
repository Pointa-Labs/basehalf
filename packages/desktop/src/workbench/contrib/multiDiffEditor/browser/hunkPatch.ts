/**
 * Extract a single-hunk patch from a file's raw `git diff` output, for hunk-level
 * staging. Returns the file header (`diff --git` / `---` / `+++`) plus exactly one
 * hunk — the one whose OLD-side line range intersects [oldFrom, oldTo] — as the
 * verbatim bytes git emitted, so `git apply` round-trips it cleanly (preserving
 * `\ No newline at end of file` and exact context).
 *
 * Pure + unit-tested: building a patch by hand is the fragile part of hunk staging
 * (off-by-one line counts, EOF newline), so we reuse git's own bytes and only pick
 * WHICH hunk — never reconstruct one. Matching by old-line RANGE (not hunk index)
 * tolerates the rare context-merge boundary where the rendered hunk count could
 * differ from git's by one.
 */

interface ParsedHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  /** The hunk's full text including its `@@` header line, newline-terminated. */
  readonly text: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/** Split raw `git diff <file>` output into its file header + hunks. */
export function parseDiff(raw: string): { header: string; hunks: ParsedHunk[] } {
  const lines = raw.split('\n');
  const headerLines: string[] = [];
  const hunks: ParsedHunk[] = [];
  let i = 0;
  // Everything before the first `@@` is the file header.
  while (i < lines.length && !(lines[i] ?? '').startsWith('@@')) {
    headerLines.push(lines[i] ?? '');
    i++;
  }
  while (i < lines.length) {
    const head = lines[i] ?? '';
    const m = head.match(HUNK_RE);
    if (!m) {
      i++;
      continue;
    }
    const body: string[] = [head];
    i++;
    while (i < lines.length && !(lines[i] ?? '').startsWith('@@')) {
      body.push(lines[i] ?? '');
      i++;
    }
    // Drop a trailing empty element from the final split so the block ends in one \n.
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    hunks.push({
      oldStart: Number.parseInt(m[1] ?? '0', 10),
      oldCount: m[2] === undefined ? 1 : Number.parseInt(m[2], 10),
      text: `${body.join('\n')}\n`,
    });
  }
  return { header: headerLines.join('\n'), hunks };
}

export function extractHunkPatch(raw: string, oldFrom: number, oldTo: number): string | null {
  const { header, hunks } = parseDiff(raw);
  if (header.trim() === '' || hunks.length === 0) return null;
  const hit = hunks.find((h) => {
    // A pure-add hunk has oldCount 0 at line oldStart — give it a 1-line span so a
    // neighboring context line still matches it.
    const span = Math.max(h.oldCount, 1);
    return h.oldStart < oldTo + 1 && h.oldStart + span > oldFrom;
  });
  if (!hit) return null;
  const head = header.endsWith('\n') ? header : `${header}\n`;
  return `${head}${hit.text}`;
}

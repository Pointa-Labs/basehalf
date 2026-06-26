/**
 * A minimal line-level diff (LCS) for the editor's git gutter change-bars:
 * compares the editor buffer to its git baseline and reports which lines in the
 * CURRENT (modified) doc are added / modified, and where content was deleted.
 * Pure + unit-tested. O(n·m) — the caller skips it for very large files.
 */

export type LineChangeKind = 'add' | 'modify' | 'delete';

export interface LineChange {
  readonly kind: LineChangeKind;
  /** 1-based first affected line in the MODIFIED doc. For a pure delete this is
   *  the line now sitting just below the removed content. */
  readonly startLine: number;
  /** 1-based last affected line. Equals startLine for a delete marker. */
  readonly endLine: number;
}

function splitLines(s: string): string[] {
  // Normalize CRLF; a single trailing newline doesn't create a phantom line.
  const body = s.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return body === '' ? [] : body.split('\n');
}

export function computeLineChanges(original: string, modified: string): LineChange[] {
  const a = splitLines(original);
  const b = splitLines(modified);
  const n = a.length;
  const m = b.length;

  // LCS-length table: dp[i][j] = LCS of a[i..] and b[j..].
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const dpi = dp[i] as number[];
    const dpi1 = dp[i + 1] as number[];
    for (let j = m - 1; j >= 0; j--) {
      dpi[j] =
        a[i] === b[j]
          ? (dpi1[j + 1] as number) + 1
          : Math.max(dpi1[j] as number, dpi[j + 1] as number);
    }
  }

  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  let del = 0; // pending deleted original lines
  let addStart = 0; // 1-based modified start of pending adds (0 = none)
  let addEnd = 0;
  const flush = (): void => {
    if (addStart > 0 && del > 0) {
      changes.push({ kind: 'modify', startLine: addStart, endLine: addEnd });
    } else if (addStart > 0) {
      changes.push({ kind: 'add', startLine: addStart, endLine: addEnd });
    } else if (del > 0) {
      // Pure deletion: a marker on the line now at this position (the line below
      // the removed block), clamped into the doc; at EOF mark the last line.
      const line = Math.min(Math.max(1, m), j + 1);
      changes.push({ kind: 'delete', startLine: line, endLine: line });
    }
    del = 0;
    addStart = 0;
    addEnd = 0;
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      del++; // delete a[i]
      i++;
    } else {
      if (addStart === 0) addStart = j + 1; // add b[j]
      addEnd = j + 1;
      j++;
    }
  }
  while (i < n) {
    del++;
    i++;
  }
  while (j < m) {
    if (addStart === 0) addStart = j + 1;
    addEnd = j + 1;
    j++;
  }
  flush();
  return changes;
}

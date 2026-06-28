import { describe, expect, it } from 'vitest';
import {
  extractHunkPatch,
  parseDiff,
} from '../src/workbench/contrib/multiDiffEditor/browser/hunkPatch.js';

// A real two-hunk `git diff` payload (header + two @@ blocks).
const RAW = [
  'diff --git a/f.txt b/f.txt',
  'index 111..222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,3 @@',
  ' line1',
  '-line2',
  '+LINE2',
  ' line3',
  '@@ -10,3 +10,4 @@',
  ' line10',
  ' line11',
  '+inserted',
  ' line12',
  '',
].join('\n');

describe('parseDiff', () => {
  it('splits the header and each hunk', () => {
    const { header, hunks } = parseDiff(RAW);
    expect(header).toContain('--- a/f.txt');
    expect(header).toContain('+++ b/f.txt');
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldCount: 3 });
    expect(hunks[1]).toMatchObject({ oldStart: 10, oldCount: 3 });
    expect(hunks[0]?.text.startsWith('@@ -1,3 +1,3 @@')).toBe(true);
    expect(hunks[0]?.text.endsWith('\n')).toBe(true);
  });

  it('defaults oldCount to 1 for a single-line hunk header (@@ -a +c @@)', () => {
    const { hunks } = parseDiff('--- a/x\n+++ b/x\n@@ -5 +5 @@\n-a\n+b\n');
    expect(hunks[0]).toMatchObject({ oldStart: 5, oldCount: 1 });
  });
});

describe('extractHunkPatch', () => {
  it('returns the file header + only the matching hunk (first hunk)', () => {
    const patch = extractHunkPatch(RAW, 2, 2);
    expect(patch).not.toBeNull();
    expect(patch).toContain('--- a/f.txt');
    expect(patch).toContain('@@ -1,3 +1,3 @@');
    expect(patch).not.toContain('@@ -10,3'); // the OTHER hunk is excluded
    expect(patch?.endsWith('\n')).toBe(true);
  });

  it('matches by old-line range → the second hunk', () => {
    const patch = extractHunkPatch(RAW, 11, 11);
    expect(patch).toContain('@@ -10,3 +10,4 @@');
    expect(patch).not.toContain('@@ -1,3');
  });

  it('a pure-add hunk (oldCount 0) still matches its anchor line', () => {
    const raw = '--- a/x\n+++ b/x\n@@ -4,0 +5,2 @@\n+new1\n+new2\n';
    expect(extractHunkPatch(raw, 4, 4)).toContain('@@ -4,0 +5,2 @@');
  });

  it('a new-file pure-add hunk can be matched at old line 0', () => {
    const raw = '--- /dev/null\n+++ b/x\n@@ -0,0 +1,2 @@\n+new1\n+new2\n';
    expect(extractHunkPatch(raw, 0, 0)).toContain('@@ -0,0 +1,2 @@');
  });

  it('returns null when no hunk covers the range or input is empty', () => {
    expect(extractHunkPatch(RAW, 999, 999)).toBeNull();
    expect(extractHunkPatch('', 1, 1)).toBeNull();
  });
});

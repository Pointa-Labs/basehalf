import { describe, expect, it } from 'vitest';
import { keywordHits } from '../src/renderer/src/lib/adhd.js';
import {
  type FocusBlock,
  blockSourceSpan,
  linesToBlockIds,
} from '../src/renderer/src/lib/editorFocus.js';
import { type ReuseEntry, segmentBody } from '../src/renderer/src/lib/mdSegment.js';

// blockSourceSpan / linesToBlockIds are pure: they reconstruct a block's .md SOURCE
// line span from the same id-keyed verbatim tiles the splice-save uses. We build the
// id index straight off segmentBody (1:1 segment→block for these bodies) for the
// simple paragraph cases, and hand-author byId for the multi-line / code-fence cases.

function indexBody(body: string): { blocks: FocusBlock[]; byId: Map<string, ReuseEntry> } {
  const segs = segmentBody(body);
  const blocks: FocusBlock[] = [];
  const byId = new Map<string, ReuseEntry>();
  segs.forEach((seg, i) => {
    const id = `b${i}`;
    blocks.push({ id, type: 'paragraph' });
    byId.set(id, { key: seg.source, raw: seg.raw, prefix: seg.prefix, sep: seg.sep });
  });
  return { blocks, byId };
}

describe('blockSourceSpan — a block → its [start, end] source line range', () => {
  it('a single-line block spans one line', () => {
    const body = 'First paragraph.\n\nSecond paragraph here.\n';
    const { blocks, byId } = indexBody(body);
    expect(blockSourceSpan(blocks, 'b0', byId, 0)).toEqual({ start: 1, end: 1 });
    expect(blockSourceSpan(blocks, 'b1', byId, 0)).toEqual({ start: 3, end: 3 });
  });

  it('a multi-line (fenced code) block spans its full source height', () => {
    // "Intro." (2 newlines incl. blank sep) then a 3-source-line fenced code block.
    const byId = new Map<string, ReuseEntry>([
      ['p0', { key: 'Intro.', raw: 'Intro.\n\n', prefix: '', sep: '\n\n' }],
      ['code', { key: '```\nx\n```', raw: '```\nx\n```\n\n', prefix: '', sep: '\n\n' }],
    ]);
    const blocks: FocusBlock[] = [
      { id: 'p0', type: 'paragraph' },
      { id: 'code', type: 'codeBlock' },
    ];
    // code opens on line 3 (after "Intro." + blank) and is 3 source lines → [3, 5].
    expect(blockSourceSpan(blocks, 'code', byId, 0)).toEqual({ start: 3, end: 5 });
  });

  it('offsets the whole span by the frontmatter line count', () => {
    const { blocks, byId } = indexBody('Body line.\n');
    // frontmatter `---\ntitle: x\n---\n` is 3 newlines → body line 1 = file line 4.
    expect(blockSourceSpan(blocks, 'b0', byId, 3)).toEqual({ start: 4, end: 4 });
  });

  it('resolves a NESTED block id to its enclosing top-level block span', () => {
    const byId = new Map<string, ReuseEntry>([
      // A top-level list item whose tile spans the nested child too (2 source lines);
      // the trailing newline is the separator, so the node itself is 2 lines.
      ['parent', { key: '- parent', raw: '- parent\n  - child\n', prefix: '', sep: '\n' }],
    ]);
    const blocks: FocusBlock[] = [
      {
        id: 'parent',
        type: 'bulletListItem',
        children: [{ id: 'child', type: 'bulletListItem' }],
      },
    ];
    expect(blockSourceSpan(blocks, 'parent', byId, 0)).toEqual({ start: 1, end: 2 });
    // The nested child reports the parent's whole span, never null.
    expect(blockSourceSpan(blocks, 'child', byId, 0)).toEqual({ start: 1, end: 2 });
  });

  it('a brand-new (un-indexed) block collapses to a single line', () => {
    const blocks: FocusBlock[] = [{ id: 'fresh', type: 'paragraph' }];
    const byId = new Map<string, ReuseEntry>();
    expect(blockSourceSpan(blocks, 'fresh', byId, 0)).toEqual({ start: 1, end: 1 });
  });

  it('returns null for an id not in the tree', () => {
    const { blocks, byId } = indexBody('only.\n');
    expect(blockSourceSpan(blocks, 'nope', byId, 0)).toBeNull();
  });
});

describe('linesToBlockIds — read line-ranges → covering top-level block ids', () => {
  const body = 'First paragraph.\n\nSecond paragraph here.\n\nThird one.\n';
  // b0 → line 1, b1 → line 3, b2 → line 5 (each single-line, blank-separated).

  it('picks the blocks a range covers', () => {
    const { blocks, byId } = indexBody(body);
    expect(linesToBlockIds(blocks, byId, 0, [[1, 1]])).toEqual(['b0']);
    expect(linesToBlockIds(blocks, byId, 0, [[3, 3]])).toEqual(['b1']);
    expect(linesToBlockIds(blocks, byId, 0, [[5, 5]])).toEqual(['b2']);
  });

  it('a range spanning several blocks returns them all', () => {
    const { blocks, byId } = indexBody(body);
    expect(linesToBlockIds(blocks, byId, 0, [[1, 5]])).toEqual(['b0', 'b1', 'b2']);
  });

  it('unions multiple disjoint ranges', () => {
    const { blocks, byId } = indexBody(body);
    expect(
      linesToBlockIds(blocks, byId, 0, [
        [1, 1],
        [5, 5],
      ]),
    ).toEqual(['b0', 'b2']);
  });

  it('a range landing in a blank-line gap matches no block', () => {
    const { blocks, byId } = indexBody(body);
    // line 2 and line 4 are the blank separators between paragraphs.
    expect(linesToBlockIds(blocks, byId, 0, [[2, 2]])).toEqual([]);
    expect(linesToBlockIds(blocks, byId, 0, [[4, 4]])).toEqual([]);
  });

  it('intersects a range with a multi-line block by its interior lines', () => {
    const byId = new Map<string, ReuseEntry>([
      ['p0', { key: 'Intro.', raw: 'Intro.\n\n', prefix: '', sep: '\n\n' }],
      ['code', { key: '```\nx\n```', raw: '```\nx\n```\n\n', prefix: '', sep: '\n\n' }],
    ]);
    const blocks: FocusBlock[] = [
      { id: 'p0', type: 'paragraph' },
      { id: 'code', type: 'codeBlock' },
    ];
    // code spans [3,5]; a range touching only its middle line still selects it.
    expect(linesToBlockIds(blocks, byId, 0, [[4, 4]])).toEqual(['code']);
    expect(linesToBlockIds(blocks, byId, 0, [[1, 1]])).toEqual(['p0']);
  });

  it('honours the frontmatter offset', () => {
    const { blocks, byId } = indexBody('Body line.\n');
    expect(linesToBlockIds(blocks, byId, 3, [[4, 4]])).toEqual(['b0']);
    expect(linesToBlockIds(blocks, byId, 3, [[1, 1]])).toEqual([]); // inside frontmatter
  });

  it('empty ranges select nothing', () => {
    const { blocks, byId } = indexBody(body);
    expect(linesToBlockIds(blocks, byId, 0, [])).toEqual([]);
  });

  it('a multi-block segment keeps the FOLLOWING block on its true source line', () => {
    // buildLoadProjection now tiles a multi-block segment (e.g. a multi-paragraph
    // blockquote BlockNote splits into 2 paragraphs) so its EXACT newlines accumulate:
    // the WHOLE segment's raw rides on the LAST block (`multi`), earlier blocks carry
    // none. Without it, each block fell back to a 2-newline estimate and every block
    // AFTER the segment drifted. Here the blockquote raw is 5 newlines (4 source lines
    // + the blank separator) → Tail. must land on line 6, not the old estimate's line 5.
    const byId = new Map<string, ReuseEntry>([
      ['bq0', { key: 'x', raw: '', prefix: '', sep: '', multi: true }],
      ['bq1', { key: 'x', raw: '> a\n> b\n>\n> c\n\n', prefix: '', sep: '\n\n', multi: true }],
      ['tail', { key: 'Tail.', raw: 'Tail.\n', prefix: '', sep: '\n' }],
    ]);
    const blocks: FocusBlock[] = [
      { id: 'bq0', type: 'paragraph' },
      { id: 'bq1', type: 'paragraph' },
      { id: 'tail', type: 'paragraph' },
    ];
    // Both blockquote blocks project to its start; the last spans the body (4 lines).
    expect(blockSourceSpan(blocks, 'bq0', byId, 0)).toEqual({ start: 1, end: 1 });
    expect(blockSourceSpan(blocks, 'bq1', byId, 0)).toEqual({ start: 1, end: 4 });
    // Tail. follows the segment's full 5 newlines → line 6 (exact, not drifted to 5).
    expect(blockSourceSpan(blocks, 'tail', byId, 0)).toEqual({ start: 6, end: 6 });
    // No interior block collides with Tail.'s line; a blockquote-interior range hits
    // the body-spanning block, not Tail.
    expect(linesToBlockIds(blocks, byId, 0, [[6, 6]])).toEqual(['tail']);
    expect(linesToBlockIds(blocks, byId, 0, [[2, 2]])).toEqual(['bq1']);
  });
});

describe('keywordHits — merged [start, end) keyword offsets within a text run', () => {
  it('finds case-insensitive occurrences', () => {
    expect(keywordHits('Cost and COST again', ['cost'])).toEqual([
      [0, 4],
      [9, 13],
    ]);
  });

  it('merges overlapping hits from different keywords', () => {
    // "ab" and "bc" overlap on "b" in "abc" → one merged span [0,3].
    expect(keywordHits('abc', ['ab', 'bc'])).toEqual([[0, 3]]);
  });

  it('matches CJK keywords', () => {
    const text = '介绍供需均衡与边际成本。';
    expect(keywordHits(text, ['供需均衡', '边际成本'])).toEqual([
      [2, 6],
      [7, 11],
    ]);
  });

  it('returns nothing when no keyword matches (or none given)', () => {
    expect(keywordHits('plain text', ['absent'])).toEqual([]);
    expect(keywordHits('plain text', [])).toEqual([]);
    expect(keywordHits('', ['x'])).toEqual([]);
  });
});

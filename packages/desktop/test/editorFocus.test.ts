import { describe, expect, it } from 'vitest';
import {
  type FocusBlock,
  blockFileLine,
  blockOrdinal,
  countNewlines,
  refineCursorLine,
  tileSourceNewlines,
  topLevelBlockOf,
} from '../src/workbench/services/editor/browser/editorFocusModel.js';
import {
  RAW_PASSTHROUGH,
  type ReuseEntry,
  segmentBody,
} from '../src/workbench/services/editor/browser/mdSegment.js';

// blockFileLine is pure — it reconstructs a block's .md source line from the same
// id-keyed verbatim tiles the splice-save uses, with no BlockNote/DOM. So we build
// the index straight off segmentBody (1:1 segment→block for these bodies) and
// assert the line each block maps to.

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

describe('countNewlines', () => {
  it('counts line breaks regardless of EOL style', () => {
    expect(countNewlines('')).toBe(0);
    expect(countNewlines('one line')).toBe(0);
    expect(countNewlines('a\nb\nc')).toBe(2);
    expect(countNewlines('a\r\nb\r\n')).toBe(2); // CRLF still counts its \n
  });
});

describe('blockFileLine — block → .md source line', () => {
  it('maps consecutive paragraphs to their source lines', () => {
    const body = 'First paragraph.\n\nSecond paragraph here.\n';
    const { blocks, byId } = indexBody(body);
    expect(blockFileLine(blocks, 'b0', byId, 0)).toBe(1);
    expect(blockFileLine(blocks, 'b1', byId, 0)).toBe(3); // blank line between
  });

  it("accounts for a block's own leading blank lines (prefix)", () => {
    const body = '\n\n# After blanks\n\ntext\n';
    const { blocks, byId } = indexBody(body);
    expect(blockFileLine(blocks, 'b0', byId, 0)).toBe(3); // two leading blank lines
    expect(blockFileLine(blocks, 'b1', byId, 0)).toBe(5);
  });

  it('offsets every line by the frontmatter line count', () => {
    const body = 'Body line.\n';
    const { blocks, byId } = indexBody(body);
    // frontmatter `---\ntitle: x\n---\n` is 3 newlines → body starts at file line 4.
    expect(blockFileLine(blocks, 'b0', byId, 3)).toBe(4);
  });

  it('keeps tight list items on consecutive lines', () => {
    const body = '- one\n- two\n- three\n';
    const { blocks, byId } = indexBody(body);
    expect(blockFileLine(blocks, 'b0', byId, 0)).toBe(1);
    expect(blockFileLine(blocks, 'b1', byId, 0)).toBe(2);
    expect(blockFileLine(blocks, 'b2', byId, 0)).toBe(3);
  });

  it('counts a read-only passthrough block by its carried raw, not byId', () => {
    // "# Doc" (2 newlines incl. blank sep) + a passthrough comment tile (2) → the
    // following paragraph lands on line 5.
    const byId = new Map<string, ReuseEntry>([
      ['head', { key: '# Doc', raw: '# Doc\n\n', prefix: '', sep: '\n\n' }],
      ['body', { key: 'Body.', raw: 'Body.\n', prefix: '', sep: '\n' }],
    ]);
    const blocks: FocusBlock[] = [
      { id: 'head', type: 'heading' },
      { id: 'cmt', type: RAW_PASSTHROUGH, props: { raw: '<!-- a comment -->\n\n' } },
      { id: 'body', type: 'paragraph' },
    ];
    expect(blockFileLine(blocks, 'body', byId, 0)).toBe(5);
  });

  it('estimates a brand-new (un-indexed) block from its separator', () => {
    // A paragraph the user just typed has no tile → assumed 2 newlines (blank-line
    // separated), so the next indexed block shifts by that estimate.
    const byId = new Map<string, ReuseEntry>([
      ['kept', { key: 'Kept.', raw: 'Kept.\n', prefix: '', sep: '\n' }],
    ]);
    const blocks: FocusBlock[] = [
      { id: 'fresh', type: 'paragraph' }, // no byId entry
      { id: 'kept', type: 'paragraph' },
    ];
    expect(blockFileLine(blocks, 'kept', byId, 0)).toBe(3); // 2 (estimate) + 1
  });

  it('resolves a NESTED block id to its enclosing top-level block line', () => {
    // editor.document only holds top-level blocks; a nested cursor's block lives in
    // children. The enclosing top-level item's tile spans the whole subtree, so the
    // nested cursor reports that item's source line (never null).
    const byId = new Map<string, ReuseEntry>([
      ['p0', { key: 'Intro.', raw: 'Intro.\n\n', prefix: '', sep: '\n\n' }],
      // A top-level list item whose tile spans the nested child too (2 source lines).
      ['parent', { key: '- parent', raw: '- parent\n  - child\n', prefix: '', sep: '' }],
    ]);
    const blocks: FocusBlock[] = [
      { id: 'p0', type: 'paragraph' },
      {
        id: 'parent',
        type: 'bulletListItem',
        children: [{ id: 'child', type: 'bulletListItem' }],
      },
    ];
    // "Intro." line 1, "- parent" line 3 (blank line between).
    expect(blockFileLine(blocks, 'parent', byId, 0)).toBe(3);
    // Cursor in the nested "child" resolves to the parent's line, not null.
    expect(blockFileLine(blocks, 'child', byId, 0)).toBe(3);
  });

  it('a flat list keeps each item on its own line (no false nesting)', () => {
    // Regression guard: flat list items are TOP-LEVEL (no children), so the nested
    // resolution must not collapse them onto one line.
    const { blocks, byId } = indexBody('- one\n- two\n- three\n');
    expect(blockFileLine(blocks, 'b1', byId, 0)).toBe(2);
  });

  it('returns null when the id is not in the document', () => {
    const { blocks, byId } = indexBody('only.\n');
    expect(blockFileLine(blocks, 'nope', byId, 0)).toBeNull();
  });
});

describe('blockOrdinal — the Nth rendered block (the row the user sees)', () => {
  it('counts top-level blocks 1-based in document order', () => {
    const blocks: FocusBlock[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(blockOrdinal(blocks, 'a')).toBe(1);
    expect(blockOrdinal(blocks, 'b')).toBe(2);
    expect(blockOrdinal(blocks, 'c')).toBe(3);
  });

  it('counts nested blocks depth-first (parent before its children), DOM order', () => {
    const blocks: FocusBlock[] = [
      { id: 'p0' },
      { id: 'parent', children: [{ id: 'child1' }, { id: 'child2' }] },
      { id: 'after' },
    ];
    expect(blockOrdinal(blocks, 'p0')).toBe(1);
    expect(blockOrdinal(blocks, 'parent')).toBe(2);
    expect(blockOrdinal(blocks, 'child1')).toBe(3);
    expect(blockOrdinal(blocks, 'child2')).toBe(4);
    expect(blockOrdinal(blocks, 'after')).toBe(5);
  });

  it('is independent of source-line inflation (13 short blocks → ordinal 13)', () => {
    // The whole point: blank-line separators bloat the source line but not the
    // block ordinal — block 13 is block 13 no matter how many blank lines precede.
    const blocks: FocusBlock[] = Array.from({ length: 13 }, (_, i) => ({ id: `b${i}` }));
    expect(blockOrdinal(blocks, 'b12')).toBe(13);
  });

  it('returns null when the id is not present', () => {
    expect(blockOrdinal([{ id: 'a' }], 'nope')).toBeNull();
  });
});

describe('topLevelBlockOf — resolve a (possibly nested) id to its top-level block', () => {
  const blocks: FocusBlock[] = [{ id: 'p0' }, { id: 'parent', children: [{ id: 'child' }] }];
  it('direct hit on a top-level block', () => {
    expect(topLevelBlockOf(blocks, 'p0')).toEqual({ block: blocks[0], direct: true });
  });
  it('nested id resolves to its top-level ancestor, direct=false', () => {
    expect(topLevelBlockOf(blocks, 'child')).toEqual({ block: blocks[1], direct: false });
  });
  it('null when absent', () => {
    expect(topLevelBlockOf(blocks, 'nope')).toBeNull();
  });
});

describe('tileSourceNewlines — source line count − 1 of a block', () => {
  it('single source line → 0', () => {
    expect(tileSourceNewlines({ key: 'a', raw: 'a\n\n', prefix: '', sep: '\n\n' })).toBe(0);
  });
  it('counts only the node bytes, excluding prefix + sep', () => {
    // a 3-line fenced code block tile: prefix '\n', source has 2 newlines, sep '\n\n'.
    const raw = '\n```\nx\n```\n\n';
    expect(tileSourceNewlines({ key: 'c', raw, prefix: '\n', sep: '\n\n' })).toBe(2);
  });
});

describe('refineCursorLine — source line + precision', () => {
  it('no saved tile → estimated, line = blockStart', () => {
    expect(
      refineCursorLine({
        blockStart: 5,
        hasEntry: false,
        blockSourceNewlines: 0,
        directHit: true,
        codeWithinOffset: null,
      }),
    ).toEqual({ line: 5, precision: 'estimated' });
  });
  it('single-source-line block → exact', () => {
    expect(
      refineCursorLine({
        blockStart: 5,
        hasEntry: true,
        blockSourceNewlines: 0,
        directHit: true,
        codeWithinOffset: null,
      }),
    ).toEqual({ line: 5, precision: 'exact' });
  });
  it('fenced code block → exact, adds in-fence offset past the opening fence', () => {
    // block opens at line 10 (the ```), cursor on the 3rd code line (2 newlines in).
    expect(
      refineCursorLine({
        blockStart: 10,
        hasEntry: true,
        blockSourceNewlines: 4,
        directHit: true,
        codeWithinOffset: 2,
      }),
    ).toEqual({ line: 13, precision: 'exact' }); // 10 + 1 (fence) + 2
  });
  it('other multi-line block (or nested cursor) → block_start', () => {
    expect(
      refineCursorLine({
        blockStart: 7,
        hasEntry: true,
        blockSourceNewlines: 3,
        directHit: true,
        codeWithinOffset: null,
      }),
    ).toEqual({ line: 7, precision: 'block_start' });
    expect(
      refineCursorLine({
        blockStart: 7,
        hasEntry: true,
        blockSourceNewlines: 3,
        directHit: false,
        codeWithinOffset: null,
      }),
    ).toEqual({ line: 7, precision: 'block_start' });
  });
});

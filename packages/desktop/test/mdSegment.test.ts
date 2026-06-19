import { describe, expect, it } from 'vitest';
import {
  type Segment,
  contentTokens,
  losesContent,
  segmentBody,
  spliceSave,
} from '../src/renderer/src/lib/mdSegment.js';

// segmentBody is pure (mdast only, no BlockNote), so it runs in the Node test env.
// The load-time projection + splice-save (which need a real BlockNote/DOM) are
// exercised end-to-end in test/verify-ui.mjs against the live renderer.

describe('segmentBody — byte-exact tiling of the body', () => {
  // The load-bearing invariant: concatenating every segment's `raw` reproduces
  // the body verbatim. This is what guarantees an unedited save is byte-identical.
  const tiles = (body: string): Segment[] => {
    const segs = segmentBody(body);
    expect(segs.map((s) => s.raw).join('')).toBe(body); // Σ raw === body
    // Each tile decomposes exactly into prefix + source + sep — the separator is
    // what the splice reuses verbatim around an edited node.
    for (const s of segs) expect(s.prefix + s.source + s.sep).toBe(s.raw);
    return segs;
  };

  const fixtures: Record<string, string> = {
    'plain multi-paragraph': 'First paragraph.\n\nSecond paragraph here.\n',
    headings: '# Title\n\nIntro.\n\n## Section\n\nBody text.\n',
    'fenced code with blank lines inside': [
      'Before.',
      '',
      '```js',
      'const a = 1;',
      '',
      'const b = 2;',
      '```',
      '',
      'After.',
      '',
    ].join('\n'),
    'gfm table': ['| a | b |', '| - | - |', '| 1 | 2 |', '', 'Tail.', ''].join('\n'),
    'bullet list': '- one\n- two\n- three\n',
    'ordered list': '1. first\n2. second\n3. third\n',
    'task list': '- [ ] todo\n- [x] done\n',
    blockquote: '> a quoted line\n> continued\n\nOutside.\n',
    'html comment': '# Doc\n\n<!-- bh:workspace-hint -->\n\nBody.\n',
    'raw html details': '<details>\n<summary>more</summary>\nhidden\n</details>\n\nNext.\n',
    'leading blank lines': '\n\n# After blanks\n\ntext\n',
    'no trailing newline': '# A\n\nlast line with no newline',
    crlf: '# A\r\n\r\nLine one.\r\n\r\nLine two.\r\n',
    mixed: [
      '# Title',
      '',
      '<!-- a comment -->',
      '',
      'A paragraph with **bold**.',
      '',
      '- item 1',
      '- item 2',
      '',
      '```',
      'raw code',
      '```',
      '',
      '> quote',
      '',
    ].join('\n'),
  };

  for (const [name, body] of Object.entries(fixtures)) {
    it(`reproduces "${name}" byte-for-byte from raw tiles`, () => {
      tiles(body);
    });
  }

  it('returns [] for an empty body', () => {
    expect(segmentBody('')).toEqual([]);
  });

  it('descends one level into a list so each item is its own segment', () => {
    const segs = tiles('- alpha\n- beta\n- gamma\n');
    // Three list items → at least three segments, each a list item source.
    const itemSources = segs.map((s) => s.source).filter((s) => /^\s*[-*+]\s/.test(s));
    expect(itemSources.length).toBe(3);
    expect(itemSources[0]).toContain('alpha');
    expect(itemSources[1]).toContain('beta');
    expect(itemSources[2]).toContain('gamma');
  });

  it('keeps an HTML comment as a verbatim segment source', () => {
    const segs = tiles('# Doc\n\n<!-- bh:workspace-hint -->\n\nBody.\n');
    expect(segs.some((s) => s.source.includes('<!-- bh:workspace-hint -->'))).toBe(true);
  });

  it("a segment's source is always a slice of its raw tile", () => {
    for (const body of Object.values(fixtures)) {
      for (const seg of segmentBody(body)) {
        expect(seg.raw).toContain(seg.source);
      }
    }
  });
});

describe('losesContent — guards segments whose round-trip drops content', () => {
  it('extracts letter/digit runs as content tokens (ignores markup)', () => {
    expect(contentTokens('Keep <!-- x --> this')).toBe('Keep x this');
    expect(contentTokens('**bold** and _em_')).toBe('bold and em');
    expect(contentTokens('中文 ok 123')).toBe('中文 ok 123');
  });

  it('flags a span whose normalized form lost a token (inline comment dropped)', () => {
    // BlockNote turns `Keep <!-- secret --> this` into `Keep  this` (comment gone).
    expect(losesContent('Keep <!-- secret --> this', 'Keep  this')).toBe(true);
  });

  it('flags a SYMBOL-only inline comment being dropped (no letter/digit tokens)', () => {
    // `<!-- !!! -->` carries no tokens, so only the comment comparison catches it.
    expect(losesContent('Keep <!-- !!! --> this', 'Keep  this')).toBe(true);
    expect(losesContent('a <!-- --> b', 'a  b')).toBe(true);
  });

  it('does NOT flag pure formatting churn (same tokens, different markup)', () => {
    expect(losesContent('* a\n* b', '- a\n- b')).toBe(false); // bullet marker swap
    expect(losesContent('soft\nwrap', 'soft wrap')).toBe(false); // wrap → space
    expect(losesContent('Plain **bold** here', 'Plain **bold** here')).toBe(false);
  });
});

describe('spliceSave — frontmatter / body join fidelity', () => {
  // Minimal fake editor: a brand-new block (id not in byId) only needs
  // blocksToMarkdownLossy. Cast through unknown — we exercise the join logic.
  const fakeEditor = {
    blocksToMarkdownLossy: async () => 'hello\n',
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double
  } as any;
  const newBlock = [{ type: 'paragraph', id: 'b1' }];

  it('inserts a newline when frontmatter ends at EOF with no trailing newline', async () => {
    // The corruption case: `---\nk: v\n---` (no trailing newline) + typed body.
    const out = await spliceSave(fakeEditor, newBlock, '---\nk: v\n---', new Map());
    expect(out).toBe('---\nk: v\n---\nhello\n'); // NOT `---hello`
    // The closing fence is still on its own line (frontmatter survives a reopen).
    expect(out).toContain('---\nhello');
  });

  it('does not double the newline when frontmatter already ends in one', async () => {
    const out = await spliceSave(fakeEditor, newBlock, '---\nk: v\n---\n', new Map());
    expect(out).toBe('---\nk: v\n---\nhello\n');
  });

  it('uses CRLF as the separator for a CRLF frontmatter', async () => {
    const out = await spliceSave(fakeEditor, newBlock, '---\r\nk: v\r\n---', new Map());
    expect(out).toBe('---\r\nk: v\r\n---\r\nhello\n');
  });

  it('ignores `multi` tile entries — saves a multi-block segment exactly as if untiled', async () => {
    // multi entries carry the segment's newline accounting for line-projection, NOT a
    // verbatim tile. spliceSave must treat them as no tile (re-serialize), so the save
    // is byte-for-byte what it was before these entries existed.
    const blocks = [
      { type: 'paragraph', id: 'm0' },
      { type: 'paragraph', id: 'm1' },
    ];
    const multiMap = new Map([
      ['m0', { key: 'x', raw: '> p1\n>\n> p2\n\n', prefix: '', sep: '\n\n', multi: true }],
      ['m1', { key: 'x', raw: '', prefix: '', sep: '', multi: true }],
    ]);
    const withMulti = await spliceSave(fakeEditor, blocks, '', multiMap);
    const untiled = await spliceSave(fakeEditor, blocks, '', new Map());
    expect(withMulti).toBe(untiled);
  });

  it('keeps the closing fence newline-terminated even for an empty body', async () => {
    // A seeded empty paragraph still emits a separator, so the result is
    // `---\nk: v\n---\n\n` — the fence stays on its own line (no `---` glued to
    // content), so the frontmatter survives a reopen.
    const emptyEditor = { blocksToMarkdownLossy: async () => '' } as never;
    const out = await spliceSave(
      emptyEditor,
      [{ type: 'paragraph', id: 'b1' }],
      '---\nk: v\n---',
      new Map(),
    );
    expect(out.startsWith('---\nk: v\n---\n')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { __test, isLossyRoundTrip } from '../src/renderer/src/lib/mdLossy.js';

const { canonical } = __test;

describe('isLossyRoundTrip — cosmetic churn is NOT lossy', () => {
  it('soft-wrapped prose folded onto one line is equivalent', () => {
    const original = 'A single sentence that the author\nhard-wrapped across two lines.';
    const reserialized = 'A single sentence that the author hard-wrapped across two lines.';
    expect(isLossyRoundTrip(original, reserialized)).toBe(false);
  });

  it('emphasis marker style (* vs _) does not matter', () => {
    expect(isLossyRoundTrip('this is *why* it works', 'this is _why_ it works')).toBe(false);
    expect(isLossyRoundTrip('**bold** word', '__bold__ word')).toBe(false);
  });

  it('bullet character and ordered-list renumbering are cosmetic', () => {
    expect(isLossyRoundTrip('* one\n* two', '- one\n- two')).toBe(false);
    expect(isLossyRoundTrip('1. first\n2. second', '1. first\n1. second')).toBe(false);
  });

  it('blank-line-run differences are cosmetic', () => {
    expect(isLossyRoundTrip('# Title\n\n\n\nBody', '# Title\n\nBody')).toBe(false);
  });

  it("the demo's practice.md (multi-line list items + bold) is editable", () => {
    const original = [
      '# The daily loop',
      '',
      '1. **Drop a folder** (papers, notes, code, drafts) into BaseHalf.',
      '2. **Describe each file** for the AI in the Badge panel — a single',
      '   sentence is usually enough.',
      '3. **Connect related files** by dragging from one badge to another.',
      '   Add a short note on the edge explaining *why* they relate.',
      '',
    ].join('\n');
    // What BlockNote round-trips it to: list items folded onto one line,
    // emphasis re-emitted, trailing blank dropped.
    const reserialized = [
      '# The daily loop',
      '',
      '1. **Drop a folder** (papers, notes, code, drafts) into BaseHalf.',
      '2. **Describe each file** for the AI in the Badge panel — a single sentence is usually enough.',
      '3. **Connect related files** by dragging from one badge to another. Add a short note on the edge explaining _why_ they relate.',
    ].join('\n');
    expect(isLossyRoundTrip(original, reserialized)).toBe(false);
  });
});

describe('isLossyRoundTrip — genuine loss IS lossy', () => {
  it('dropped text trips the guard', () => {
    expect(isLossyRoundTrip('keep this\nand this too', 'keep this')).toBe(true);
  });

  it('a merged paragraph break trips the guard', () => {
    // Two separate paragraphs collapsed into one is real structure loss.
    expect(isLossyRoundTrip('para one\n\npara two', 'para one para two')).toBe(true);
  });

  it('mangled YAML frontmatter trips the guard', () => {
    const original = '---\ntitle: Hello\ntags: [a, b]\n---\n# Body';
    // BlockNote eats the second fence / reshapes it — structure differs.
    const reserialized = '---\n\ntitle: Hello tags: [a, b]\n\n# Body';
    expect(isLossyRoundTrip(original, reserialized)).toBe(true);
  });

  it('a dropped table trips the guard', () => {
    const original = '| a | b |\n| - | - |\n| 1 | 2 |';
    const reserialized = 'a b\n1 2';
    expect(isLossyRoundTrip(original, reserialized)).toBe(true);
  });

  it('content inside a code fence is preserved verbatim (not folded)', () => {
    const md = '```\nline one\nline two\n```';
    // identical round-trip is obviously not lossy
    expect(isLossyRoundTrip(md, md)).toBe(false);
    // but losing a code line is
    expect(isLossyRoundTrip(md, '```\nline one\n```')).toBe(true);
  });
});

describe('canonical()', () => {
  it('is idempotent', () => {
    const md = '# H\n\n- a\n- b\n\nsome *prose* wrapped\nover lines';
    expect(canonical(canonical(md))).toBe(canonical(md));
  });
});

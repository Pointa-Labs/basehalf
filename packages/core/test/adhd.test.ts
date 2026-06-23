import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createCore } from '../src/index.js';
import { mergeRange, normalizeRanges, subtractRange } from '../src/modules/adhd/ranges.js';
import { boundCore } from './helpers/bound-core.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * ADHD = per-file reading aids in `.bh/mirror/<file>/adhd.yaml`:
 *   highlight_keywords: string[]   (editor highlights)
 *   read_paragraphs: [start,end][]  (inclusive 1-based read line ranges)
 * Commands: get / set / addKeyword / removeKeyword / markRead / markUnread.
 */

async function seed() {
  const { fs, files, dirs } = mockFs();
  dirs.add('/work');
  const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/work');
  await core.run('workspace.add', { path: '/work', name: 'w' });
  return { fs, files, core };
}

const adhdYaml = (rel: string) => `/work/.bh/mirror/${rel}/adhd.yaml`;

describe('adhd range algebra (pure)', () => {
  it('normalizeRanges sorts, merges overlap AND gap-free adjacency', () => {
    expect(
      normalizeRanges([
        [31, 38],
        [12, 24],
      ]),
    ).toEqual([
      [12, 24],
      [31, 38],
    ]);
    expect(
      normalizeRanges([
        [12, 24],
        [20, 30],
      ]),
    ).toEqual([[12, 30]]); // overlap
    expect(
      normalizeRanges([
        [12, 24],
        [25, 38],
      ]),
    ).toEqual([[12, 38]]); // adjacent (no gap)
    expect(
      normalizeRanges([
        [12, 24],
        [26, 38],
      ]),
    ).toEqual([
      [12, 24],
      [26, 38],
    ]); // gap at 25
  });

  it('mergeRange adds + coalesces', () => {
    expect(
      mergeRange(
        [
          [1, 5],
          [20, 25],
        ],
        5,
        21,
      ),
    ).toEqual([[1, 25]]);
  });

  it('subtractRange splits a bisected range and trims edges', () => {
    expect(subtractRange([[10, 30]], 15, 20)).toEqual([
      [10, 14],
      [21, 30],
    ]); // split
    expect(subtractRange([[10, 30]], 5, 12)).toEqual([[13, 30]]); // trim left
    expect(subtractRange([[10, 30]], 25, 40)).toEqual([[10, 24]]); // trim right
    expect(subtractRange([[10, 30]], 1, 100)).toEqual([]); // fully cleared
    expect(subtractRange([[10, 30]], 40, 50)).toEqual([[10, 30]]); // disjoint — untouched
  });

  it('rejects invalid ranges', () => {
    expect(() => normalizeRanges([[5, 2]])).toThrow(/before start/);
    expect(() => normalizeRanges([[0, 3]])).toThrow(/1-based/);
    expect(() => mergeRange([], 1.5, 3)).toThrow(/integers/);
  });
});

describe('adhd commands', () => {
  it('get returns null when absent', async () => {
    const { core } = await seed();
    expect(await core.run('adhd.get', { file: 'a.md' })).toBeNull();
  });

  it('addKeyword materializes + dedupes; removeKeyword prunes when empty', async () => {
    const { core, files } = await seed();
    await core.run('adhd.addKeyword', { file: 'a.md', keyword: '供需均衡' });
    const again = await core.run('adhd.addKeyword', { file: 'a.md', keyword: '供需均衡' }); // idempotent
    expect(again).toEqual({ path: 'a.md', kind: 'file', highlight_keywords: ['供需均衡'] });
    await core.run('adhd.addKeyword', { file: 'a.md', keyword: '边际成本' });
    expect(parse(files.get(adhdYaml('a.md')) ?? '')).toEqual({
      path: 'a.md',
      kind: 'file',
      highlight_keywords: ['供需均衡', '边际成本'],
    });
    await core.run('adhd.removeKeyword', { file: 'a.md', keyword: '供需均衡' });
    const empty = await core.run('adhd.removeKeyword', { file: 'a.md', keyword: '边际成本' });
    expect(empty).toBeNull(); // last field gone → adhd.yaml pruned
    expect(files.get(adhdYaml('a.md'))).toBeUndefined();
  });

  it('set replaces wholesale, normalizing ranges + de-duping keywords', async () => {
    const { core } = await seed();
    const res = await core.run('adhd.set', {
      file: 'a.md',
      highlight_keywords: ['x', 'x', ' y '],
      read_paragraphs: [
        [31, 38],
        [12, 24],
        [20, 26],
      ],
    });
    expect(res).toEqual({
      path: 'a.md',
      kind: 'file',
      highlight_keywords: ['x', 'y'],
      read_paragraphs: [
        [12, 26],
        [31, 38],
      ],
    });
  });

  it('markRead merges and markUnread splits, pruning when empty', async () => {
    const { core } = await seed();
    await core.run('adhd.markRead', { file: 'a.md', start: 12, end: 24 });
    const merged = await core.run('adhd.markRead', { file: 'a.md', start: 25, end: 38 });
    expect(merged.read_paragraphs).toEqual([[12, 38]]); // adjacency-merged

    const split = await core.run('adhd.markUnread', { file: 'a.md', start: 20, end: 28 });
    expect(split.read_paragraphs).toEqual([
      [12, 19],
      [29, 38],
    ]);

    const gone = await core.run('adhd.markUnread', { file: 'a.md', start: 1, end: 999 });
    expect(gone).toBeNull(); // all read ranges cleared → pruned
    expect(await core.run('adhd.get', { file: 'a.md' })).toBeNull();
  });

  it('markRead validates the range', async () => {
    const { core } = await seed();
    await expect(core.run('adhd.markRead', { file: 'a.md', start: 9, end: 2 })).rejects.toThrow(
      /before start/,
    );
  });

  it('keyword + read state coexist in one file', async () => {
    const { core } = await seed();
    await core.run('adhd.addKeyword', { file: 'a.md', keyword: 'k' });
    const both = await core.run('adhd.markRead', { file: 'a.md', start: 1, end: 3 });
    expect(both).toEqual({
      path: 'a.md',
      kind: 'file',
      highlight_keywords: ['k'],
      read_paragraphs: [[1, 3]],
    });
  });

  it('revision counts adhd files', async () => {
    const { core } = await seed();
    expect((await core.run('adhd.revision', {})).count).toBe(0);
    await core.run('adhd.addKeyword', { file: 'a.md', keyword: 'k' });
    await core.run('adhd.addKeyword', { file: 'b.md', keyword: 'k' });
    expect((await core.run('adhd.revision', {})).count).toBe(2);
  });
});

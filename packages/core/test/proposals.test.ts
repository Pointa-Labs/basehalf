import { beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

interface TestContext {
  files: Map<string, string>;
  dirs: Set<string>;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  core: any;
}

async function seed(): Promise<TestContext> {
  const { fs, files, dirs } = mockFs();
  dirs.add('/work');
  const core = createCore({ fs, configDir: '/cfg' });
  await core.run('workspace.add', { path: '/work', name: 'w' });
  return { files, dirs, core };
}

const PROPOSALS = '/work/.bh/cache/proposals.md';

describe('proposals.list', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('returns empty when proposals.md is absent (no error, no mkdir)', async () => {
    const r = (await ctx.core.run('proposals.list', {})) as { proposals: unknown[] };
    expect(r.proposals).toEqual([]);
  });

  it('parses well-formed lines into file/target/reason and keeps raw', async () => {
    ctx.files.set(
      PROPOSALS,
      'auth.ts -> session.ts: touching auth breaks the session test\n# a comment\n\nstray observation with no arrow\n',
    );
    const r = (await ctx.core.run('proposals.list', {})) as {
      proposals: { line: number; raw: string; file?: string; target?: string; reason?: string }[];
    };
    expect(r.proposals).toHaveLength(2); // comment + blank skipped
    expect(r.proposals[0]).toEqual({
      line: 0,
      raw: 'auth.ts -> session.ts: touching auth breaks the session test',
      file: 'auth.ts',
      target: 'session.ts',
      reason: 'touching auth breaks the session test',
    });
    // A malformed line is still surfaced verbatim (signal, not dropped).
    expect(r.proposals[1]).toEqual({ line: 1, raw: 'stray observation with no arrow' });
  });
});

describe('proposals.dismiss', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('removes one line by index and re-indexes survivors', async () => {
    ctx.files.set(PROPOSALS, 'a -> b: one\nc -> d: two\ne -> f: three\n');
    const r = (await ctx.core.run('proposals.dismiss', { line: 1 })) as {
      dismissed: boolean;
      proposals: { line: number; raw: string }[];
    };
    expect(r.dismissed).toBe(true);
    expect(r.proposals.map((p) => p.raw)).toEqual(['a -> b: one', 'e -> f: three']);
    expect(r.proposals.map((p) => p.line)).toEqual([0, 1]); // re-indexed
    expect(ctx.files.get(PROPOSALS)).toBe('a -> b: one\ne -> f: three\n');
  });

  it('returns dismissed:false for an out-of-range index', async () => {
    ctx.files.set(PROPOSALS, 'a -> b: one\n');
    const r = (await ctx.core.run('proposals.dismiss', { line: 9 })) as { dismissed: boolean };
    expect(r.dismissed).toBe(false);
  });

  it('concurrent dismisses do not resurrect each other (mutex)', async () => {
    ctx.files.set(PROPOSALS, 'a -> b: one\nc -> d: two\n');
    // Dismiss both lines concurrently; under the lock they serialize, so the file
    // ends empty rather than one write clobbering the other back to one line.
    await Promise.all([
      ctx.core.run('proposals.dismiss', { line: 0 }),
      ctx.core.run('proposals.dismiss', { line: 0 }),
    ]);
    const r = (await ctx.core.run('proposals.list', {})) as { proposals: unknown[] };
    expect(r.proposals).toEqual([]);
  });
});

describe('proposals.clear', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await seed();
  });

  it('empties the file and reports the count', async () => {
    ctx.files.set(PROPOSALS, 'a -> b: one\nc -> d: two\n');
    const r = (await ctx.core.run('proposals.clear', {})) as { cleared: number };
    expect(r.cleared).toBe(2);
    const list = (await ctx.core.run('proposals.list', {})) as { proposals: unknown[] };
    expect(list.proposals).toEqual([]);
  });
});

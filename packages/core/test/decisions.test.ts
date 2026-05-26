import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Decisions module tests. Same two-layer pattern as workspace:
 *  - Mock FS unit tests for command semantics
 *  - One integration test against a real tmp dir
 *
 * Most tests need a workspace registered first (decisions live under the
 * current workspace's .bh/decisions/). `bootstrap()` does that.
 */

type Decision = {
  version: 1;
  slug: string;
  title: string;
  rationale: string;
  sources: readonly string[];
  tags: readonly string[];
  status: 'active' | 'deprecated' | 'superseded';
  decidedAt: string;
  decidedBy: string;
  supersedes: string | null;
  supersededBy: string | null;
};

async function bootstrap(): Promise<
  ReturnType<typeof mockFs> & { core: ReturnType<typeof createCore> }
> {
  const m = mockFs();
  m.dirs.add('/work');
  const core = createCore({ fs: m.fs, configDir: '/cfg' });
  await core.run('workspace.add', { path: '/work', name: 'ws' });
  return { ...m, core };
}

describe('decisions module (mock FS)', () => {
  it('add: writes JSON file at .bh/decisions/<slug>.json with full schema', async () => {
    const { core, files } = await bootstrap();
    const r = await core.run<unknown, { decision: Decision; path: string }>('decision.add', {
      title: 'Use Postgres not SQLite',
      because: 'needs concurrent writers',
      source: ['meeting:2026-05-26', 'src/db/index.ts'],
      tag: ['db', 'infra'],
    });

    expect(r.decision.slug).toBe('use-postgres-not-sqlite');
    expect(r.decision.status).toBe('active');
    expect(r.decision.sources).toEqual(['meeting:2026-05-26', 'src/db/index.ts']);
    expect(r.path).toBe('.bh/decisions/use-postgres-not-sqlite.json');

    const raw = files.get('/work/.bh/decisions/use-postgres-not-sqlite.json');
    expect(raw).toBeTruthy();
    const onDisk = JSON.parse(raw as string) as Decision;
    expect(onDisk.title).toBe('Use Postgres not SQLite');
    expect(onDisk.version).toBe(1);
  });

  it('add: refuses if no current workspace (friendly error)', async () => {
    const m = mockFs();
    const core = createCore({ fs: m.fs, configDir: '/cfg' });
    await expect(core.run('decision.add', { title: 'X', because: 'y' })).rejects.toThrow(
      /No active workspace/,
    );
  });

  it('add: refuses duplicate slug', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'Same Title', because: 'a' });
    await expect(core.run('decision.add', { title: 'Same Title', because: 'b' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('add: refuses empty title or rationale', async () => {
    const { core } = await bootstrap();
    await expect(core.run('decision.add', { title: '   ', because: 'x' })).rejects.toThrow(
      /Title is required/,
    );
    await expect(core.run('decision.add', { title: 'T', because: '' })).rejects.toThrow(
      /--because.*required/,
    );
  });

  it('add: --slug override + slug pattern validation', async () => {
    const { core } = await bootstrap();
    const r = await core.run<unknown, { decision: Decision }>('decision.add', {
      title: 'Anything',
      because: 'because',
      slug: 'custom-slug',
    });
    expect(r.decision.slug).toBe('custom-slug');

    await expect(
      core.run('decision.add', { title: 'X', because: 'y', slug: 'Bad Slug!' }),
    ).rejects.toThrow(/Invalid slug/);
  });

  it('add: dedupes sources and tags', async () => {
    const { core } = await bootstrap();
    const r = await core.run<unknown, { decision: Decision }>('decision.add', {
      title: 'T',
      because: 'b',
      source: ['a', 'a', 'b'],
      tag: ['x', 'x', 'y'],
    });
    expect(r.decision.sources).toEqual(['a', 'b']);
    expect(r.decision.tags).toEqual(['x', 'y']);
  });

  it('add: defaults decidedBy from $USER', async () => {
    const { core } = await bootstrap();
    const prev = process.env.USER;
    process.env.USER = 'test-user';
    try {
      const r = await core.run<unknown, { decision: Decision }>('decision.add', {
        title: 'T',
        because: 'b',
      });
      expect(r.decision.decidedBy).toBe('test-user');
    } finally {
      if (prev !== undefined) process.env.USER = prev;
      // biome-ignore lint/performance/noDelete: env restore in tests; "= undefined" coerces to "undefined" string
      else delete process.env.USER;
    }
  });

  it('recall: empty store → no matches', async () => {
    const { core } = await bootstrap();
    const r = await core.run<unknown, { matches: Decision[] }>('decision.recall', {});
    expect(r.matches).toEqual([]);
  });

  it('recall: substring match on title / rationale / tags / sources', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'Use Postgres', because: 'rwx', tag: ['db'] });
    await core.run('decision.add', {
      title: 'Pick Electron',
      because: 'js-native',
      source: ['rfc-electron.md'],
    });

    const byTitle = await core.run<unknown, { matches: Decision[] }>('decision.recall', {
      query: 'postgres',
    });
    expect(byTitle.matches.map((m) => m.slug)).toEqual(['use-postgres']);

    const byRationale = await core.run<unknown, { matches: Decision[] }>('decision.recall', {
      query: 'js-native',
    });
    expect(byRationale.matches.map((m) => m.slug)).toEqual(['pick-electron']);

    const bySource = await core.run<unknown, { matches: Decision[] }>('decision.recall', {
      query: 'rfc',
    });
    expect(bySource.matches.map((m) => m.slug)).toEqual(['pick-electron']);
  });

  it('recall: --tag has AND semantics; --status filters', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'A', because: 'a', tag: ['db', 'infra'] });
    await core.run('decision.add', { title: 'B', because: 'b', tag: ['db'] });
    await core.run('decision.add', { title: 'C', because: 'c', tag: ['ui'] });
    await core.run('decision.update', { slug: 'a', status: 'deprecated' });

    const dbAndInfra = await core.run<unknown, { matches: Decision[] }>('decision.recall', {
      tag: ['db', 'infra'],
    });
    expect(dbAndInfra.matches.map((m) => m.slug)).toEqual(['a']);

    const onlyActive = await core.run<unknown, { matches: Decision[] }>('decision.recall', {
      status: 'active',
    });
    expect(onlyActive.matches.map((m) => m.slug).sort()).toEqual(['b', 'c']);
  });

  it('recall: sorted by decidedAt desc; --limit caps results', async () => {
    const { core } = await bootstrap();
    // Add 3 in known sequence; decidedAt is ISO timestamps, so insertion
    // order corresponds to ascending dates; recall should reverse that.
    await core.run('decision.add', { title: 'First', because: 'x', slug: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    await core.run('decision.add', { title: 'Second', because: 'x', slug: 'second' });
    await new Promise((r) => setTimeout(r, 5));
    await core.run('decision.add', { title: 'Third', because: 'x', slug: 'third' });

    const all = await core.run<unknown, { matches: Decision[] }>('decision.recall', {});
    expect(all.matches.map((m) => m.slug)).toEqual(['third', 'second', 'first']);

    const top2 = await core.run<unknown, { matches: Decision[] }>('decision.recall', {
      limit: 2,
    });
    expect(top2.matches.map((m) => m.slug)).toEqual(['third', 'second']);
  });

  it('show: returns full decision or throws on missing', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'T', because: 'b', slug: 'present' });
    const r = await core.run<unknown, Decision>('decision.show', { slug: 'present' });
    expect(r.title).toBe('T');
    await expect(core.run('decision.show', { slug: 'missing' })).rejects.toThrow(
      /No such decision/,
    );
  });

  it('update: changes status; refuses invalid status', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'T', because: 'b' });
    const r = await core.run<unknown, { decision: Decision }>('decision.update', {
      slug: 't',
      status: 'deprecated',
    });
    expect(r.decision.status).toBe('deprecated');
    await expect(core.run('decision.update', { slug: 't', status: 'gibberish' })).rejects.toThrow(
      /Invalid status/,
    );
  });

  it('update: addSource / addTag append + dedupe', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', {
      title: 'T',
      because: 'b',
      source: ['a'],
      tag: ['x'],
    });
    const r = await core.run<unknown, { decision: Decision }>('decision.update', {
      slug: 't',
      addSource: ['a', 'b'],
      addTag: ['x', 'y'],
    });
    expect(r.decision.sources).toEqual(['a', 'b']);
    expect(r.decision.tags).toEqual(['x', 'y']);
  });

  it('update: supersededBy must point to a real decision', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'A', because: 'a' });
    await expect(
      core.run('decision.update', { slug: 'a', supersededBy: 'nonexistent' }),
    ).rejects.toThrow(/does not exist/);

    await core.run('decision.add', { title: 'B', because: 'b' });
    const r = await core.run<unknown, { decision: Decision }>('decision.update', {
      slug: 'a',
      supersededBy: 'b',
    });
    expect(r.decision.supersededBy).toBe('b');
  });

  it('update: CANNOT change title or rationale (audit integrity)', async () => {
    // The handler simply ignores any title/rationale fields you pass — they
    // aren't in the DecisionUpdateArgs type. Verify the round-trip preserves them.
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'Original Title', because: 'original' });
    await core.run('decision.update', { slug: 'original-title', addTag: ['x'] });
    const after = await core.run<unknown, Decision>('decision.show', { slug: 'original-title' });
    expect(after.title).toBe('Original Title');
    expect(after.rationale).toBe('original');
  });

  it('list: same as recall with no query, behaves consistently', async () => {
    const { core } = await bootstrap();
    await core.run('decision.add', { title: 'A', because: 'a', tag: ['x'] });
    await core.run('decision.add', { title: 'B', because: 'b', tag: ['y'] });
    const r = await core.run<unknown, { decisions: Decision[] }>('decision.list', {
      tag: ['x'],
    });
    expect(r.decisions.map((d) => d.slug)).toEqual(['a']);
  });
});

// ── Integration test (real disk) ────────────────────────────────────────────

describe('decisions module (integration, real FS)', () => {
  let tmpCfg: string;
  let tmpWs: string;

  beforeEach(async () => {
    tmpCfg = await mkdtemp(join(tmpdir(), 'bh-test-cfg-'));
    tmpWs = await mkdtemp(join(tmpdir(), 'bh-test-ws-'));
  });

  afterEach(async () => {
    await rm(tmpCfg, { recursive: true, force: true });
    await rm(tmpWs, { recursive: true, force: true });
  });

  it('full round-trip on real disk: add → recall → update → show', async () => {
    const core = createCore({ configDir: tmpCfg });
    await core.run('workspace.add', { path: tmpWs, name: 'int' });

    await core.run('decision.add', {
      title: 'Test decision',
      because: 'because reasons',
      source: ['a.md'],
      tag: ['t1'],
    });

    const list = await core.run<unknown, { decisions: Decision[] }>('decision.list', {});
    expect(list.decisions).toHaveLength(1);
    expect(list.decisions[0]?.slug).toBe('test-decision');

    // File exists on disk
    const { readFile } = await import('node:fs/promises');
    const onDisk = await readFile(join(tmpWs, '.bh', 'decisions', 'test-decision.json'), 'utf8');
    expect(JSON.parse(onDisk).title).toBe('Test decision');

    await core.run('decision.update', { slug: 'test-decision', status: 'deprecated' });
    const after = await core.run<unknown, Decision>('decision.show', { slug: 'test-decision' });
    expect(after.status).toBe('deprecated');
  });
});

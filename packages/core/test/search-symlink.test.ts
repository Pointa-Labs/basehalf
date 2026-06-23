import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { SearchQueryResult } from '../src/index.js';
import { boundCore } from './helpers/bound-core.js';

/**
 * search.query against the REAL node:fs with a REAL in-bounds directory symlink
 * cycle — the one thing mockFs can't model (its realpath is identity). Proves
 * the visited-realpath guard breaks the cycle instead of rescanning to MAX_DIRS.
 */

let base: string;
let ws: string;
// biome-ignore lint/suspicious/noExplicitAny: test-local core handle
let core: any;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'bh-search-cycle-'));
  ws = join(base, 'workspace');
  await mkdir(ws, { recursive: true });
  const cfg = join(base, 'cfg');
  await mkdir(cfg, { recursive: true });
  core = boundCore(createCore({ configDir: cfg }), ws);
  await core.run('workspace.add', { path: ws, name: 'ws' });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('search.query symlink-cycle guard (real fs)', () => {
  it('breaks an in-bounds directory-symlink cycle instead of rescanning to MAX_DIRS', async () => {
    await writeFile(join(ws, 'note.md'), 'findme here');
    // `loop -> ws` (the root itself): in-bounds (realpath stays inside ws), so
    // listFiles surfaces it as a contained dir. Without the visited guard the
    // DFS would re-walk the whole tree through loop/loop/loop… until MAX_DIRS,
    // duplicating hits (loop/note.md, loop/loop/note.md, …) and flagging
    // truncated. With it, note.md is found exactly once.
    await symlink(ws, join(ws, 'loop'));
    const res = (await core.run('search.query', { query: 'findme' })) as SearchQueryResult;
    expect(res.hits.map((h) => h.file)).toEqual(['note.md']);
    expect(res.truncated).toBeUndefined();
  });
});

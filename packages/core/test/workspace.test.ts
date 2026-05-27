import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Workspace module tests. Two layers:
 *  1. **Mock FS unit tests** — verify command semantics independent of disk.
 *  2. **Integration test** — one end-to-end against a real tmp dir, so the
 *     `createContext()` defaults + `node:fs/promises` wiring stays exercised.
 */

describe('workspace module (mock FS)', () => {
  it('add: creates entry, creates .bh/, sets as current when first', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/my/vault');
    const core = createCore({ fs, configDir: '/cfg' });

    const result = await core.run<
      { path: string; name?: string },
      {
        workspace: { name: string; path: string; addedAt: string };
        setAsCurrent: boolean;
        bhDirCreated: boolean;
      }
    >('workspace.add', { path: '/my/vault', name: 'vault' });

    expect(result.workspace.name).toBe('vault');
    expect(result.workspace.path).toBe('/my/vault');
    expect(result.setAsCurrent).toBe(true);
    expect(result.bhDirCreated).toBe(true);
    expect(dirs.has('/my/vault/.bh')).toBe(true);

    const cfg = JSON.parse(files.get('/cfg/workspaces.json') as string) as {
      current: string;
      workspaces: Record<string, { path: string }>;
    };
    expect(cfg.current).toBe('vault');
    expect(cfg.workspaces.vault?.path).toBe('/my/vault');
  });

  it('add: second workspace does NOT become current', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });

    await core.run('workspace.add', { path: '/a' });
    const r2 = await core.run<unknown, { setAsCurrent: boolean }>('workspace.add', {
      path: '/b',
    });
    expect(r2.setAsCurrent).toBe(false);
  });

  it('add: rejects non-existent path', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('workspace.add', { path: '/nope' })).rejects.toThrow(/does not exist/);
  });

  it('add: rejects a file (not directory)', async () => {
    const { fs, files } = mockFs();
    files.set('/notdir', 'hello');
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('workspace.add', { path: '/notdir' })).rejects.toThrow(/not a directory/);
  });

  it('add: rejects invalid names', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/x');
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('workspace.add', { path: '/x', name: 'bad name!' })).rejects.toThrow(
      /Invalid workspace name/,
    );
  });

  it('add: rejects duplicate names', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'dup' });
    await expect(core.run('workspace.add', { path: '/a', name: 'dup' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('list: sorted alphabetically; reports current', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/b');
    dirs.add('/a');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/b', name: 'beta' });
    await core.run('workspace.add', { path: '/a', name: 'alpha' });

    const r = await core.run<
      unknown,
      {
        current: string;
        workspaces: { name: string }[];
      }
    >('workspace.list', {});

    expect(r.workspaces.map((w) => w.name)).toEqual(['alpha', 'beta']);
    expect(r.current).toBe('beta'); // first added
  });

  it('use: switches current; rejects unknown names', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });

    await core.run('workspace.use', { name: 'b' });
    const cur = await core.run<unknown, { current: { name: string } | null }>(
      'workspace.current',
      {},
    );
    expect(cur.current?.name).toBe('b');

    await expect(core.run('workspace.use', { name: 'missing' })).rejects.toThrow(/No such/);
  });

  it('current: returns null when no workspaces', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { current: unknown }>('workspace.current', {});
    expect(r.current).toBeNull();
  });

  it('remove: picks alphabetically-first survivor as new current', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    dirs.add('/c');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/c', name: 'c' });
    // current = 'b' (first added)

    const r = await core.run<unknown, { newCurrent: string | null }>('workspace.remove', {
      name: 'b',
    });
    expect(r.newCurrent).toBe('a'); // alphabetically first survivor
  });

  it('remove: null current when last workspace removed', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    const r = await core.run<unknown, { newCurrent: string | null }>('workspace.remove', {
      name: 'a',
    });
    expect(r.newCurrent).toBeNull();
  });

  it('remove: does NOT delete the .bh/ directory (observer principle)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/vault');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/vault', name: 'v' });
    expect(dirs.has('/vault/.bh')).toBe(true);
    await core.run('workspace.remove', { name: 'v' });
    expect(dirs.has('/vault/.bh')).toBe(true); // still there
  });
});

// ── Integration test (real disk) ────────────────────────────────────────────

describe('workspace module (integration, real FS)', () => {
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

  it('add → list → current round-trips through real disk', async () => {
    const core = createCore({ configDir: tmpCfg });

    const added = await core.run<
      unknown,
      {
        workspace: { name: string };
        bhDirCreated: boolean;
      }
    >('workspace.add', { path: tmpWs, name: 'rw-test' });
    expect(added.workspace.name).toBe('rw-test');
    expect(added.bhDirCreated).toBe(true);

    // Real .bh/ dir actually created on disk
    const { stat } = await import('node:fs/promises');
    const bhStat = await stat(join(tmpWs, '.bh'));
    expect(bhStat.isDirectory()).toBe(true);

    const list = await core.run<unknown, { workspaces: { name: string }[] }>('workspace.list', {});
    expect(list.workspaces.map((w) => w.name)).toContain('rw-test');

    const cur = await core.run<unknown, { current: { name: string } | null }>(
      'workspace.current',
      {},
    );
    expect(cur.current?.name).toBe('rw-test');
  });

  it('handles pre-existing .bh/ — does not re-create or fail', async () => {
    await mkdir(join(tmpWs, '.bh'), { recursive: true });
    const core = createCore({ configDir: tmpCfg });
    const r = await core.run<unknown, { bhDirCreated: boolean }>('workspace.add', {
      path: tmpWs,
      name: 'pre-existing',
    });
    expect(r.bhDirCreated).toBe(false);
  });
});

// ── --setup (non-destructive) ───────────────────────────────────────────────

type SetupReport = {
  gitignoreUpdated: boolean;
  claudeMdUpdated: boolean;
  gitignoreSkipped: boolean;
  claudeMdSkipped: boolean;
  gitignoreAbsent: boolean;
};

describe('workspace --setup (mock FS, non-destructive)', () => {
  it('appends .bh/ to existing .gitignore when missing', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    files.set('/work/.gitignore', 'node_modules/\n');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.gitignoreUpdated).toBe(true);
    expect(files.get('/work/.gitignore')).toMatch(/\.bh\//);
  });

  it('skips .gitignore when .bh/ already present', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    files.set('/work/.gitignore', 'node_modules/\n.bh/\n');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.gitignoreSkipped).toBe(true);
    expect(r.setup.gitignoreUpdated).toBe(false);
  });

  it('reports gitignoreAbsent when no .gitignore exists', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.gitignoreAbsent).toBe(true);
    expect(r.setup.gitignoreUpdated).toBe(false);
  });

  it('creates CLAUDE.md with hint when missing', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.claudeMdUpdated).toBe(true);
    expect(files.get('/work/CLAUDE.md')).toMatch(/bh:recall-hint/);
  });

  it('appends hint section to existing CLAUDE.md (preserves prior content)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    files.set('/work/CLAUDE.md', '# Existing instructions\n\nUse arrow functions.\n');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w', setup: true });
    const after = files.get('/work/CLAUDE.md') as string;
    expect(after).toContain('Existing instructions');
    expect(after).toContain('Use arrow functions.');
    expect(after).toContain('bh:recall-hint');
  });

  it('skips CLAUDE.md when marker already present (idempotent)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    files.set(
      '/work/CLAUDE.md',
      '# Top\n\n<!-- bh:recall-hint -->\n## Using bh\n\nstale section\n',
    );
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.claudeMdSkipped).toBe(true);
    expect(r.setup.claudeMdUpdated).toBe(false);
  });

  it('omits setup report when --setup not passed (back-compat)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup?: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
    });
    expect(r.setup).toBeUndefined();
  });
});

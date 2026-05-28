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

  it('rename: changes the workspace name without touching path or .bh/', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/vault');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/vault', name: 'old' });
    const r = (await core.run('workspace.rename', { from: 'old', to: 'new' })) as {
      workspace: { name: string; path: string };
      currentUpdated: boolean;
    };
    expect(r.workspace.name).toBe('new');
    expect(r.workspace.path).toBe('/vault');
    expect(r.currentUpdated).toBe(true);
    // .bh/ untouched.
    expect(dirs.has('/vault/.bh')).toBe(true);
    // Config now lists the new name and forgets the old.
    const list = (await core.run('workspace.list', {})) as {
      current: string;
      workspaces: { name: string }[];
    };
    expect(list.current).toBe('new');
    expect(list.workspaces.map((w) => w.name)).toEqual(['new']);
  });

  it('rename: when renaming a non-current workspace, current pointer is untouched', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' }); // becomes current
    await core.run('workspace.add', { path: '/b', name: 'b' });
    const r = (await core.run('workspace.rename', { from: 'b', to: 'b2' })) as {
      currentUpdated: boolean;
    };
    expect(r.currentUpdated).toBe(false);
    const list = (await core.run('workspace.list', {})) as { current: string };
    expect(list.current).toBe('a');
  });

  it('rename: throws when source workspace does not exist', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('workspace.rename', { from: 'ghost', to: 'whatever' })).rejects.toThrow(
      /No such workspace: ghost/,
    );
  });

  it('rename: throws on collision with an existing workspace name', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    await expect(core.run('workspace.rename', { from: 'a', to: 'b' })).rejects.toThrow(
      /already taken: b/,
    );
  });

  it('rename: throws on invalid new name (NAME_PATTERN)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await expect(
      core.run('workspace.rename', { from: 'a', to: '@invalid name with spaces' }),
    ).rejects.toThrow(/Invalid workspace name/);
  });

  it('rename: throws when from === to', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await expect(core.run('workspace.rename', { from: 'a', to: 'a' })).rejects.toThrow(
      /from and to are the same/,
    );
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
  it('appends .bh/cache/ to existing .gitignore when missing', async () => {
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
    expect(files.get('/work/.gitignore')).toMatch(/\.bh\/cache\//);
    // The non-cache parts of .bh/ should NOT be ignored — they travel with
    // the folder per IR-v2-06.
    expect(files.get('/work/.gitignore')).not.toMatch(/^\.bh\/$/m);
  });

  it('skips .gitignore when .bh/cache/ already present', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    files.set('/work/.gitignore', 'node_modules/\n.bh/cache/\n');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.gitignoreSkipped).toBe(true);
    expect(r.setup.gitignoreUpdated).toBe(false);
  });

  it('does NOT skip when legacy .bh/ line is present (still needs .bh/cache/)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    // Older workspace setup may have written a bare `.bh/` ignore. The new
    // model needs `.bh/cache/` specifically — re-running `bh init` should
    // append the new line (so .bh/cache/ is covered) and leave the user to
    // remove the bare `.bh/` line manually.
    files.set('/work/.gitignore', 'node_modules/\n.bh/\n');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.gitignoreUpdated).toBe(true);
    expect(files.get('/work/.gitignore')).toMatch(/\.bh\/cache\//);
    // The legacy `.bh/` line is preserved (we don't silently rewrite user files).
    expect(files.get('/work/.gitignore')).toMatch(/^\.bh\/$/m);
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
    expect(files.get('/work/CLAUDE.md')).toMatch(/bh:workspace-hint/);
  });

  it('hint body names every load-bearing contract surface (regression guard)', async () => {
    // The agent-protocol hint is the contract surface for Claude Code /
    // Codex / Cursor. If a future edit accidentally drops one of these
    // path mentions, the agent loses a step in the protocol walk and the
    // value of the integration silently degrades. Cheap to test, costly
    // to miss.
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w', setup: true });
    const hint = files.get('/work/CLAUDE.md') ?? '';
    // Contract paths the hint must teach the agent about.
    expect(hint).toMatch(/\.bh\/focus\.md/);
    expect(hint).toMatch(/\.bh\/badges\//);
    expect(hint).toMatch(/\.bh\/index\/inbound\.json/);
    expect(hint).toMatch(/\.bh\/views\//);
    // Constraints that prevent agents from corrupting bh's state.
    expect(hint).toMatch(/\.bh\/cache\//);
    expect(hint).toMatch(/MD is the truth/i);
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
    expect(after).toContain('bh:workspace-hint');
  });

  it('skips CLAUDE.md when current marker already present (idempotent)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    files.set(
      '/work/CLAUDE.md',
      '# Top\n\n<!-- bh:workspace-hint -->\n## BaseHalf workspace\n\nold content\n',
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

  it('skips CLAUDE.md when legacy bh:recall-hint marker present (backward compat)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    // Older workspaces had a `bh:recall-hint` marker. Re-running `bh init`
    // should detect it and skip — we don't want to stack two hint sections.
    files.set(
      '/work/CLAUDE.md',
      '# Top\n\n<!-- bh:recall-hint -->\n## Using bh\n\nlegacy decisions-recall guide\n',
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

describe('workspace.listFiles', () => {
  it('returns direct children with file/dir types, dirs first, alphabetical', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/root');
    dirs.add('/root/zeta');
    dirs.add('/root/alpha');
    files.set('/root/readme.md', '');
    files.set('/root/notes.txt', '');
    const core = createCore({ fs, configDir: '/cfg' });

    const result = await core.run<
      { path: string },
      { path: string; entries: { name: string; type: 'file' | 'dir' }[] }
    >('workspace.listFiles', { path: '/root' });

    expect(result.path).toBe('/root');
    expect(result.entries).toEqual([
      { name: 'alpha', type: 'dir' },
      { name: 'zeta', type: 'dir' },
      { name: 'notes.txt', type: 'file' },
      { name: 'readme.md', type: 'file' },
    ]);
  });

  it('returns one level only (no recursion)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/root');
    dirs.add('/root/nested');
    files.set('/root/nested/deep.md', '');
    const core = createCore({ fs, configDir: '/cfg' });

    const result = await core.run<
      { path: string },
      { entries: { name: string; type: 'file' | 'dir' }[] }
    >('workspace.listFiles', { path: '/root' });

    // Only sees "nested" as a dir; doesn't descend into it.
    expect(result.entries).toEqual([{ name: 'nested', type: 'dir' }]);
  });

  it('returns empty entries for an empty directory', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/root');
    const core = createCore({ fs, configDir: '/cfg' });

    const result = await core.run<{ path: string }, { entries: unknown[] }>('workspace.listFiles', {
      path: '/root',
    });
    expect(result.entries).toEqual([]);
  });

  it('rejects non-existent path with code: PATH_NOT_FOUND', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('workspace.listFiles', { path: '/nope' })).rejects.toMatchObject({
      message: expect.stringContaining('does not exist'),
      code: 'PATH_NOT_FOUND',
    });
  });

  it('rejects a file (not a directory)', async () => {
    const { fs, files } = mockFs();
    files.set('/notdir', 'hi');
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('workspace.listFiles', { path: '/notdir' })).rejects.toThrow(
      /not a directory/,
    );
  });
});

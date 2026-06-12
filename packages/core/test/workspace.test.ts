import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('readFile: maxChars caps returned content + flags truncated', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/big.txt', 'A'.repeat(1000));
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/v' });
    type R = { content: string; truncated?: boolean };
    const full = await core.run<{ path: string }, R>('workspace.readFile', { path: 'big.txt' });
    expect(full.content.length).toBe(1000);
    expect(full.truncated).toBeUndefined();
    const capped = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'big.txt',
      maxChars: 100,
    });
    expect(capped.content.length).toBe(100);
    expect(capped.truncated).toBe(true);
    const under = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'big.txt',
      maxChars: 5000,
    });
    expect(under.content.length).toBe(1000);
    expect(under.truncated).toBeUndefined();
  });

  it('readFile: a capped read fetches only a bounded prefix, never the whole file', async () => {
    // Regression for the optimistic-text-routing risk: an unknown/huge file
    // routed to the viewer must not be slurped whole before the cap/sniff runs.
    const { fs, files, dirs, capRequests } = mockFs();
    dirs.add('/v');
    files.set('/v/huge.log', 'A'.repeat(5_000_000)); // 5 MB
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/v' });
    type R = { content: string; truncated?: boolean };
    const capped = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'huge.log',
      maxChars: 100,
    });
    expect(capped.content.length).toBe(100);
    expect(capped.truncated).toBe(true);
    // The fs was asked for ONLY the bounded byte budget (maxChars*4 + 4), not 5 MB.
    expect(capRequests).toEqual([100 * 4 + 4]);
  });

  it('readFile: flags a binary file (NUL byte) but still returns its content', async () => {
    const NUL = String.fromCharCode(0);
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/data.bin', `PK${NUL}${NUL}binary-ish`);
    files.set('/v/note.txt', 'plain text, no nulls here');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/v' });
    type R = { content: string; binary?: boolean };
    const bin = await core.run<{ path: string }, R>('workspace.readFile', { path: 'data.bin' });
    expect(bin.binary).toBe(true);
    expect(bin.content).toContain('PK'); // content NOT blanked — no data loss for editors
    const txt = await core.run<{ path: string }, R>('workspace.readFile', { path: 'note.txt' });
    expect(txt.binary).toBeUndefined();
  });

  it('readFile: flags invalid UTF-8 bytes even when there is no NUL byte', async () => {
    const { fs, fileBytes, dirs } = mockFs();
    dirs.add('/v');
    fileBytes.set('/v/bad.log', Buffer.from([0x50, 0x4b, 0xff, 0xfe, 0x20, 0x6c, 0x6f, 0x67]));
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/v' });
    type R = { content: string; binary?: boolean };
    const bad = await core.run<{ path: string }, R>('workspace.readFile', { path: 'bad.log' });
    expect(bad.binary).toBe(true);
    expect(bad.content).toContain('\uFFFD');
  });

  it('readFile: does not split valid UTF-8 while sniffing a capped text prefix', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/unicode.log', `${'A'.repeat(199_999)}é tail`);
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/v' });
    type R = { content: string; truncated?: boolean; binary?: boolean };
    const capped = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'unicode.log',
      maxChars: 200_000,
    });
    expect(capped.truncated).toBe(true);
    expect(capped.content.endsWith('é')).toBe(true);
    expect(capped.binary).toBeUndefined();
  });

  it('readFile: does not split surrogate pairs while sniffing a capped text prefix', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/emoji.log', `${'A'.repeat(199_999)}😀 tail`);
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/v' });
    type R = { content: string; truncated?: boolean; binary?: boolean };
    const capped = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'emoji.log',
      maxChars: 200_000,
    });
    expect(capped.truncated).toBe(true);
    expect(capped.content).toBe('A'.repeat(199_999));
    expect(capped.binary).toBeUndefined();
  });

  it('readFile: binary sniff only inspects the capped prefix (what the viewer renders)', async () => {
    const NUL = String.fromCharCode(0);
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    // The NUL is past the first 100 chars -> a maxChars:100 read sees only text.
    files.set('/v/late.bin', `${'A'.repeat(200)}${NUL}tail`);
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/v' });
    type R = { content: string; binary?: boolean };
    const capped = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'late.bin',
      maxChars: 100,
    });
    expect(capped.binary).toBeUndefined();
    const full = await core.run<{ path: string }, R>('workspace.readFile', { path: 'late.bin' });
    expect(full.binary).toBe(true);
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

  it('add: re-adding a registered path is idempotent (folder identity = path)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'dup' });
    const again = await core.run<
      unknown,
      { workspace: { name: string }; alreadyRegistered: boolean }
    >('workspace.add', { path: '/a', name: 'dup' });
    expect(again.alreadyRegistered).toBe(true);
    expect(again.workspace.name).toBe('dup');
    // Even with a different requested name, the same path hits the same entry.
    const renamedAttempt = await core.run<
      unknown,
      { workspace: { name: string }; alreadyRegistered: boolean }
    >('workspace.add', { path: '/a', name: 'other' });
    expect(renamedAttempt.alreadyRegistered).toBe(true);
    expect(renamedAttempt.workspace.name).toBe('dup');
    const list = await core.run<unknown, { workspaces: unknown[] }>('workspace.list', {});
    expect(list.workspaces).toHaveLength(1);
  });

  it('add: path identity is case-insensitive (default macOS/Windows filesystems)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/Notes');
    dirs.add('/notes');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/Notes' });
    const again = await core.run<unknown, { alreadyRegistered: boolean }>('workspace.add', {
      path: '/notes',
    });
    expect(again.alreadyRegistered).toBe(true);
  });

  it('add: explicit name taken by a DIFFERENT path still errors', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'dup' });
    await expect(core.run('workspace.add', { path: '/b', name: 'dup' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('add: derived-name collision with a different path auto-suffixes', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/one/notes');
    dirs.add('/two/notes');
    dirs.add('/three/notes');
    const core = createCore({ fs, configDir: '/cfg' });
    const first = await core.run<unknown, { workspace: { name: string } }>('workspace.add', {
      path: '/one/notes',
    });
    const second = await core.run<unknown, { workspace: { name: string } }>('workspace.add', {
      path: '/two/notes',
    });
    const third = await core.run<unknown, { workspace: { name: string } }>('workspace.add', {
      path: '/three/notes',
    });
    expect(first.workspace.name).toBe('notes');
    expect(second.workspace.name).toBe('notes-2');
    expect(third.workspace.name).toBe('notes-3');
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

  it('remove: removing the current workspace leaves NONE current (empty window)', async () => {
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
    // Never auto-promote a survivor — the user closes a folder, they get the
    // empty/welcome state and choose what to open next.
    expect(r.newCurrent).toBeNull();
    const cur = await core.run<unknown, { current: unknown }>('workspace.current', {});
    expect(cur.current).toBeNull();
  });

  it('remove: removing a NON-current workspace keeps current untouched', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    const r = await core.run<unknown, { newCurrent: string | null }>('workspace.remove', {
      name: 'b',
    });
    expect(r.newCurrent).toBe('a');
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

  it('repath: atomically rebinds the workspace to a new path (preserves name + addedAt)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/old');
    dirs.add('/new');
    const core = createCore({ fs, configDir: '/cfg' });
    const initial = (await core.run('workspace.add', { path: '/old', name: 'w' })) as {
      workspace: { addedAt: string };
    };
    const addedAt = initial.workspace.addedAt;
    const r = (await core.run('workspace.repath', { name: 'w', path: '/new' })) as {
      workspace: { name: string; path: string; addedAt: string };
      bhDirCreated: boolean;
    };
    expect(r.workspace.name).toBe('w');
    expect(r.workspace.path).toBe('/new');
    expect(r.workspace.addedAt).toBe(addedAt); // preserved
    expect(r.bhDirCreated).toBe(true);
    expect(dirs.has('/new/.bh')).toBe(true);
    // current pointer still points at 'w'.
    const list = (await core.run('workspace.list', {})) as {
      current: string;
      workspaces: { name: string; path: string }[];
    };
    expect(list.current).toBe('w');
    expect(list.workspaces[0]?.path).toBe('/new');
  });

  it('repath: throws when target path does not exist or is not a directory', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/old');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/old', name: 'w' });
    await expect(core.run('workspace.repath', { name: 'w', path: '/nope' })).rejects.toThrow(
      /does not exist/,
    );
  });

  it('repath: throws when workspace does not exist', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/new');
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(core.run('workspace.repath', { name: 'ghost', path: '/new' })).rejects.toThrow(
      /No such workspace: ghost/,
    );
  });

  it('repath: throws when target equals current path (no-op)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/old');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/old', name: 'w' });
    await expect(core.run('workspace.repath', { name: 'w', path: '/old' })).rejects.toThrow(
      /already at \/old/,
    );
  });

  it('repath: does NOT bump current pointer when repathing a non-current workspace', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    dirs.add('/b2');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' }); // current
    await core.run('workspace.add', { path: '/b', name: 'b' });
    await core.run('workspace.repath', { name: 'b', path: '/b2' });
    const list = (await core.run('workspace.list', {})) as { current: string };
    expect(list.current).toBe('a');
  });

  it('createDemo: seeds files + badges + refs + focus + CLAUDE.md hint', async () => {
    const { fs, files } = mockFs();
    // No pre-existing dir — createDemo should mkdir.
    const core = createCore({ fs, configDir: '/cfg' });
    const r = (await core.run('workspace.createDemo', {
      path: '/demo',
      name: 'demo',
    })) as {
      workspace: { name: string; path: string };
      filesCreated: string[];
      setup: { claudeMdUpdated: boolean };
    };
    expect(r.workspace.name).toBe('demo');
    expect(r.filesCreated.length).toBeGreaterThan(0);
    expect(r.filesCreated).toContain('intro.md');
    expect(r.setup.claudeMdUpdated).toBe(true);
    // Files actually on disk.
    expect(files.has('/demo/intro.md')).toBe(true);
    expect(files.has('/demo/theory.md')).toBe(true);
    expect(files.has('/demo/practice.md')).toBe(true);
    expect(files.has('/demo/cheatsheet.md')).toBe(true);
    // CLAUDE.md installed with the agent-protocol hint.
    const claudeMd = files.get('/demo/CLAUDE.md') ?? '';
    expect(claudeMd).toMatch(/bh:workspace-hint/);
    expect(claudeMd).toMatch(/focus\.md/);
    // intro.md badge got the demo prompt + outbound refs.
    const intro = (await core.run('badge.get', { file: 'intro.md' })) as {
      prompt?: string;
      references: { to: string; note?: string }[];
    };
    expect(intro.prompt).toMatch(/entry point/i);
    expect(intro.references.map((r) => r.to).sort()).toEqual([
      'cheatsheet.md',
      'practice.md',
      'theory.md',
    ]);
    // focus.md points at intro.md (so an agent's first read returns useful info)
    // AND carries an intent, so the demo showcases the full turn brief (#91).
    const focus = (await core.run('focus.get', {})) as { active: string[]; intent?: string };
    expect(focus.active).toEqual(['intro.md']);
    expect(focus.intent).toBeTruthy();
  });

  it('createDemo: does NOT overwrite existing files with the same name', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/demo');
    // Pre-existing intro.md with custom content the user wrote.
    files.set('/demo/intro.md', '# My intro\n\nDo not touch.\n');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = (await core.run('workspace.createDemo', {
      path: '/demo',
      name: 'demo',
    })) as { filesCreated: string[] };
    // intro.md was NOT in filesCreated (we skipped it; user content preserved).
    expect(r.filesCreated).not.toContain('intro.md');
    expect(files.get('/demo/intro.md')).toBe('# My intro\n\nDo not touch.\n');
    // Other demo files still got written.
    expect(r.filesCreated).toContain('theory.md');
  });

  it('createDemo: rejects invalid workspace names', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    await expect(
      core.run('workspace.createDemo', { path: '/demo', name: '@bad name!' }),
    ).rejects.toThrow(/Invalid workspace name/);
  });

  it('createDemo: idempotent on second call at the same path (no "already exists" error)', async () => {
    const { fs, files } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    // First call — creates the workspace + seeds files.
    const r1 = (await core.run('workspace.createDemo', {
      path: '/demo',
      name: 'demo',
    })) as { filesCreated: string[] };
    expect(r1.filesCreated.length).toBeGreaterThan(0);
    // Second call — must not throw; existing files preserved; workspace
    // remains registered.
    const r2 = (await core.run('workspace.createDemo', {
      path: '/demo',
      name: 'demo',
    })) as { workspace: { name: string }; filesCreated: string[] };
    expect(r2.workspace.name).toBe('demo');
    // filesCreated should be empty the second time (everything already
    // existed; non-destructive seeding).
    expect(r2.filesCreated).toEqual([]);
    // Workspace still listed once (not duplicated).
    const list = (await core.run('workspace.list', {})) as {
      workspaces: { name: string }[];
    };
    expect(list.workspaces.filter((w) => w.name === 'demo')).toHaveLength(1);
    // intro.md content from the first seed is preserved (we never
    // overwrite — just verify the seed survived).
    expect(files.get('/demo/intro.md')).toMatch(/Welcome to your BaseHalf demo workspace/);
  });

  it('createDemo: name collision on a DIFFERENT path is still an error (real conflict)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/other');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/other', name: 'demo' });
    await expect(core.run('workspace.createDemo', { path: '/demo', name: 'demo' })).rejects.toThrow(
      /already registered at \/other/,
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

  it('readFile: real FS flags invalid UTF-8 bytes even when there is no NUL byte', async () => {
    await writeFile(join(tmpWs, 'bad.log'), Buffer.from([0x50, 0x4b, 0xff, 0xfe, 0x20, 0x6c]));
    const core = createCore({ configDir: tmpCfg });
    await core.run('workspace.add', { path: tmpWs, name: 'rw-test' });

    type R = { content: string; binary?: boolean };
    const bad = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'bad.log',
      maxChars: 200_000,
    });

    expect(bad.binary).toBe(true);
    expect(bad.content).toContain('\uFFFD');
  });

  it('readFile: real FS bounds a capped read of a large file to the requested prefix', async () => {
    // Exercises the production O_NOFOLLOW bounded reader (readFileBytesCappedNoFollow):
    // a 2 MB file capped at 1000 chars returns exactly that prefix + truncated,
    // without reading the whole file into memory.
    await writeFile(join(tmpWs, 'big.log'), 'A'.repeat(2_000_000));
    const core = createCore({ configDir: tmpCfg });
    await core.run('workspace.add', { path: tmpWs, name: 'rw-cap' });

    type R = { content: string; truncated?: boolean; binary?: boolean };
    const capped = await core.run<{ path: string; maxChars: number }, R>('workspace.readFile', {
      path: 'big.log',
      maxChars: 1000,
    });

    expect(capped.content.length).toBe(1000);
    expect(capped.truncated).toBe(true);
    expect(capped.binary).toBeUndefined();
  });
});

// ── --setup (non-destructive) ───────────────────────────────────────────────

type SetupReport = {
  gitignoreUpdated: boolean;
  claudeMdUpdated: boolean;
  agentsMdUpdated: boolean;
  copilotMdUpdated: boolean;
  gitignoreSkipped: boolean;
  claudeMdSkipped: boolean;
  agentsMdSkipped: boolean;
  copilotMdSkipped: boolean;
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

  it('creates AGENTS.md with the hint when missing (the cross-tool convention)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.agentsMdUpdated).toBe(true);
    expect(files.get('/work/AGENTS.md')).toMatch(/bh:workspace-hint/);
    expect(files.get('/work/AGENTS.md')).toMatch(/\.bh\/focus\.md/);
  });

  it('creates .github/copilot-instructions.md (nested dir made on demand)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.copilotMdUpdated).toBe(true);
    expect(files.get('/work/.github/copilot-instructions.md')).toMatch(/bh:workspace-hint/);
    // The .github/ parent must be created (production fs.writeFile won't do it).
    expect(dirs.has('/work/.github')).toBe(true);
  });

  it('all three hint files carry the same brief (fan-out consistency)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w', setup: true });
    const marker = '<!-- bh:workspace-hint -->';
    const bodyOf = (s: string) => s.slice(s.indexOf(marker));
    const claude = bodyOf(files.get('/work/CLAUDE.md') ?? '');
    // The section after the marker must be byte-identical across all three files
    // — one brief, three landing spots. Diverging content is the bug this guards.
    expect(bodyOf(files.get('/work/AGENTS.md') ?? '')).toBe(claude);
    expect(bodyOf(files.get('/work/.github/copilot-instructions.md') ?? '')).toBe(claude);
    // …and it still teaches both the file path and the CLI command for each leg.
    expect(claude).toContain('.bh/focus.md');
    expect(claude).toContain('bh search');
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
    // (saved views were removed — a folder is the grouping unit now)
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

  it('skips a hint file per-file: marker in AGENTS.md only, others still install', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    // AGENTS.md was already curated by a prior init; CLAUDE.md / copilot fresh.
    files.set(
      '/work/AGENTS.md',
      '# AGENTS.md\n\n<!-- bh:workspace-hint -->\n## BaseHalf workspace\n\nold\n',
    );
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.agentsMdSkipped).toBe(true);
    expect(r.setup.agentsMdUpdated).toBe(false);
    // Skip is independent per file — the other two still get installed.
    expect(r.setup.claudeMdUpdated).toBe(true);
    expect(r.setup.copilotMdUpdated).toBe(true);
  });

  it('appends to an existing AGENTS.md (preserves prior content)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    files.set('/work/AGENTS.md', '# AGENTS.md\n\nRun `make test` before pushing.\n');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w', setup: true });
    const after = files.get('/work/AGENTS.md') as string;
    expect(after).toContain('Run `make test` before pushing.');
    expect(after).toContain('bh:workspace-hint');
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
  // listFiles now contains enumeration to the current workspace root, so seed
  // one pointing at the listed dir WITHOUT materializing (which would write
  // .bh/ into the dir and pollute these listing assertions).
  function seedCurrent(files: Map<string, string>, name: string, path: string): void {
    files.set(
      '/cfg/workspaces.json',
      JSON.stringify({
        version: 1,
        current: name,
        workspaces: { [name]: { path, addedAt: '2026-01-01T00:00:00.000Z' } },
      }),
    );
  }

  it('returns direct children with file/dir types, dirs first, alphabetical', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/root');
    dirs.add('/root/zeta');
    dirs.add('/root/alpha');
    files.set('/root/readme.md', '');
    files.set('/root/notes.txt', '');
    seedCurrent(files, 'root', '/root');
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
    seedCurrent(files, 'root', '/root');
    const core = createCore({ fs, configDir: '/cfg' });

    const result = await core.run<
      { path: string },
      { entries: { name: string; type: 'file' | 'dir' }[] }
    >('workspace.listFiles', { path: '/root' });

    // Only sees "nested" as a dir; doesn't descend into it.
    expect(result.entries).toEqual([{ name: 'nested', type: 'dir' }]);
  });

  it('returns empty entries for an empty directory', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/root');
    seedCurrent(files, 'root', '/root');
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

  it('refuses to enumerate with NO current workspace (no external-dir oracle)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/etc');
    dirs.add('/etc/secret');
    const core = createCore({ fs, configDir: '/cfg' }); // no workspace seeded
    await expect(core.run('workspace.listFiles', { path: '/etc' })).rejects.toThrow(
      /No current workspace/,
    );
  });
});

import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { boundCore } from './helpers/bound-core.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Workspace module tests. Two layers:
 *  1. **Mock FS unit tests** — verify command semantics independent of disk.
 *  2. **Integration test** — one end-to-end against a real tmp dir, so the
 *     `createContext()` defaults + `node:fs/promises` wiring stays exercised.
 */

describe('workspace module (mock FS)', () => {
  it('add: registers the entry + creates .bh/ (no global current to set)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/my/vault');
    const core = createCore({ fs, configDir: '/cfg' });

    const result = await core.run<
      { path: string; name?: string },
      {
        workspace: { name: string; path: string; addedAt: string };
        bhDirCreated: boolean;
      }
    >('workspace.add', { path: '/my/vault', name: 'vault' });

    expect(result.workspace.name).toBe('vault');
    expect(result.workspace.path).toBe('/my/vault');
    expect(result.bhDirCreated).toBe(true);
    expect(dirs.has('/my/vault/.bh')).toBe(true);

    const cfg = JSON.parse(files.get('/cfg/workspaces.json') as string) as {
      workspaces: Record<string, { path: string }>;
      current?: unknown;
    };
    // No global pointer anymore — the registry is a pure set of folders.
    expect(cfg.current).toBeUndefined();
    expect(cfg.workspaces.vault?.path).toBe('/my/vault');
  });

  it('readFile: maxChars caps returned content + flags truncated', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/big.txt', 'A'.repeat(1000));
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
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

  it('add: registration is pure — neither add records a global current', async () => {
    const { fs, dirs, files } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });

    await core.run('workspace.add', { path: '/a' });
    await core.run('workspace.add', { path: '/b' });

    const cfg = JSON.parse(files.get('/cfg/workspaces.json') as string) as {
      workspaces: Record<string, unknown>;
      current?: unknown;
    };
    expect(Object.keys(cfg.workspaces).sort()).toEqual(['a', 'b']);
    expect(cfg.current).toBeUndefined();
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

  it('list: sorted alphabetically; current = the call-bound workspace', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/b');
    dirs.add('/a');
    const raw = createCore({ fs, configDir: '/cfg' });
    await raw.run('workspace.add', { path: '/b', name: 'beta' });
    await raw.run('workspace.add', { path: '/a', name: 'alpha' });

    type ListR = { current: string | null; workspaces: { name: string }[] };
    // current is DERIVED from the call's bound root, not a stored pointer.
    const bound = await boundCore(raw, '/b').run<unknown, ListR>('workspace.list', {});
    expect(bound.workspaces.map((w) => w.name)).toEqual(['alpha', 'beta']);
    expect(bound.current).toBe('beta');

    // A different bound root surfaces a different current; an unbound call → null.
    const other = await boundCore(raw, '/a').run<unknown, ListR>('workspace.list', {});
    expect(other.current).toBe('alpha');
    const unbound = await raw.run<unknown, ListR>('workspace.list', {});
    expect(unbound.current).toBeNull();
  });

  it('use: validates the name and returns its entry (thin; no side effect)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });

    const used = await core.run<unknown, { current: { name: string; path: string } }>(
      'workspace.use',
      { name: 'b' },
    );
    expect(used.current).toMatchObject({ name: 'b', path: '/b' });

    await expect(core.run('workspace.use', { name: 'missing' })).rejects.toThrow(/No such/);
  });

  it('current: returns null when no workspaces', async () => {
    const { fs } = mockFs();
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { current: unknown }>('workspace.current', {});
    expect(r.current).toBeNull();
  });

  it('remove: unregisters the named workspace, leaving the rest', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    dirs.add('/c');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/c', name: 'c' });

    // No global current to clear — remove just drops the registry entry. If this
    // was the workspace a window had open, the desktop reloads that window to
    // welcome (it owns the window↔workspace binding).
    const r = await core.run<unknown, { removed: string }>('workspace.remove', { name: 'b' });
    expect(r.removed).toBe('b');
    const list = await core.run<unknown, { workspaces: { name: string }[] }>('workspace.list', {});
    expect(list.workspaces.map((w) => w.name).sort()).toEqual(['a', 'c']);
  });

  it('remove: a bound call to the removed workspace then reports current=null', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    await core.run('workspace.remove', { name: 'b' });
    // A call still bound to /b's root no longer resolves to a registered entry.
    const cur = await boundCore(core, '/b').run<unknown, { current: unknown }>(
      'workspace.current',
      {},
    );
    expect(cur.current).toBeNull();
    // /a is untouched and still resolvable.
    const a = await boundCore(core, '/a').run<unknown, { current: { name: string } | null }>(
      'workspace.current',
      {},
    );
    expect(a.current?.name).toBe('a');
  });

  it('remove: removing the last workspace empties the registry', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    const r = await core.run<unknown, { removed: string }>('workspace.remove', { name: 'a' });
    expect(r.removed).toBe('a');
    const list = await core.run<unknown, { workspaces: unknown[] }>('workspace.list', {});
    expect(list.workspaces).toEqual([]);
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
    };
    expect(r.workspace.name).toBe('new');
    expect(r.workspace.path).toBe('/vault');
    // .bh/ untouched.
    expect(dirs.has('/vault/.bh')).toBe(true);
    // Config now lists the new name and forgets the old.
    const list = (await core.run('workspace.list', {})) as {
      workspaces: { name: string }[];
    };
    expect(list.workspaces.map((w) => w.name)).toEqual(['new']);
    // The binding is by PATH, so a window open on /vault re-derives the new name.
    const bound = (await boundCore(core, '/vault').run('workspace.list', {})) as {
      current: string | null;
    };
    expect(bound.current).toBe('new');
  });

  it('rename: renaming one workspace leaves the others (and their paths) intact', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    await core.run('workspace.rename', { from: 'b', to: 'b2' });
    const list = (await core.run('workspace.list', {})) as {
      workspaces: { name: string; path: string }[];
    };
    expect(list.workspaces.map((w) => `${w.name}@${w.path}`).sort()).toEqual(['a@/a', 'b2@/b']);
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
    // The entry now points at the new path (the desktop re-opens the window
    // there, since the window↔workspace binding is by path).
    const list = (await core.run('workspace.list', {})) as {
      workspaces: { name: string; path: string }[];
    };
    expect(list.workspaces[0]?.name).toBe('w');
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

  it('repath: rebinds only the named workspace, leaving siblings at their paths', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    dirs.add('/b2');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    await core.run('workspace.repath', { name: 'b', path: '/b2' });
    const list = (await core.run('workspace.list', {})) as {
      workspaces: { name: string; path: string }[];
    };
    expect(list.workspaces.map((w) => `${w.name}@${w.path}`).sort()).toEqual(['a@/a', 'b@/b2']);
  });

  it('createDemo: seeds files + badges + refs + focus + CLAUDE.md hint', async () => {
    const { fs, files } = mockFs();
    // No pre-existing dir — createDemo should mkdir. Bind to /demo so the
    // badge/canvas/focus reads below resolve to the workspace createDemo seeded
    // (createDemo itself targets /demo internally regardless of the call's root).
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/demo');
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
    expect(claudeMd).toMatch(/current_focus\.yaml/);
    // intro.md badge got the demo description + outbound refs (bare paths now).
    const intro = (await core.run('badge.get', { file: 'intro.md' })) as {
      description?: string;
      references: string[];
    };
    expect(intro.description).toMatch(/entry point/i);
    expect([...intro.references].sort()).toEqual(['cheatsheet.md', 'practice.md', 'theory.md']);
    // Demo positions live in the ROOT canvas.yaml (folder: null), not on the badge.
    const rootCanvas = (await core.run('canvas.get', { folder: null })) as {
      cards: { path: string; x: number; y: number }[];
    } | null;
    const introCard = rootCanvas?.cards.find((c) => c.path === 'intro.md');
    expect(introCard).toBeDefined();
    expect(typeof introCard?.x).toBe('number');
    expect(typeof introCard?.y).toBe('number');
    // current_focus points at intro.md (so an agent's first read of
    // `.bh/current_focus.yaml` returns a useful node instead of null — the
    // viewport-mirror equivalent of "the user is looking at intro.md").
    const focus = (await core.run('focus.get', {})) as { path: string; kind: string } | null;
    expect(focus).toEqual({ path: 'intro.md', kind: 'file' });
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
    const core = boundCore(createCore({ configDir: tmpCfg }), tmpWs);

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
    const core = boundCore(createCore({ configDir: tmpCfg }), tmpWs);
    const r = await core.run<unknown, { bhDirCreated: boolean }>('workspace.add', {
      path: tmpWs,
      name: 'pre-existing',
    });
    expect(r.bhDirCreated).toBe(false);
  });

  it('readFile: real FS flags invalid UTF-8 bytes even when there is no NUL byte', async () => {
    await writeFile(join(tmpWs, 'bad.log'), Buffer.from([0x50, 0x4b, 0xff, 0xfe, 0x20, 0x6c]));
    const core = boundCore(createCore({ configDir: tmpCfg }), tmpWs);
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
    const core = boundCore(createCore({ configDir: tmpCfg }), tmpWs);
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
  gitignoreSkipped: boolean;
  claudeMdSkipped: boolean;
  agentsMdSkipped: boolean;
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
    expect(files.get('/work/AGENTS.md')).toMatch(/current_focus\.yaml/);
  });

  it('does NOT create .github/copilot-instructions.md (the agent reads AGENTS.md now)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w', setup: true });
    // Two root files is the whole footprint — no conjured hidden directory.
    expect(files.has('/work/.github/copilot-instructions.md')).toBe(false);
    expect(dirs.has('/work/.github')).toBe(false);
  });

  it('both hint files carry the same brief (fan-out consistency)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w', setup: true });
    const marker = '<!-- bh:workspace-hint -->';
    const bodyOf = (s: string) => s.slice(s.indexOf(marker));
    const claude = bodyOf(files.get('/work/CLAUDE.md') ?? '');
    // The section after the marker must be byte-identical across both files
    // — one brief, two landing spots. Diverging content is the bug this guards.
    expect(bodyOf(files.get('/work/AGENTS.md') ?? '')).toBe(claude);
    // …and it still teaches the agent's entry point + the mirror tree.
    expect(claude).toContain('.bh/current_focus.yaml');
    expect(claude).toContain('.bh/mirror/');
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
    // Contract paths the hint must teach the agent about (the focus_mode_spec model).
    expect(hint).toMatch(/\.bh\/current_focus\.yaml/); // the per-turn entry point
    expect(hint).toMatch(/badge\.yaml/);
    expect(hint).toMatch(/canvas\.yaml/);
    expect(hint).toMatch(/focus\.yaml/);
    expect(hint).toMatch(/adhd\.yaml/);
    expect(hint).toMatch(/referenced_by/); // both directions of the reference graph
    // Constraints that prevent agents from corrupting bh's state.
    expect(hint).toMatch(/\.bh\/cache\//);
    expect(hint).toMatch(/source of truth/i);
    // The deleted surfaces must NOT reappear.
    expect(hint).not.toMatch(/focus\.md|inbound\.json|\bbh (badge|focus|search|inbound)\b/);
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

  it('UPGRADES a legacy (open-marker-only) hint section in place, preserving user content', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    // A pre-2026-06 install: open marker, NO close marker, the old body ran to EOF.
    files.set(
      '/work/CLAUDE.md',
      '# Top\n\nUser rule: use tabs.\n\n<!-- bh:workspace-hint -->\n## BaseHalf workspace\n\nstale old hint body\n',
    );
    const core = createCore({ fs, configDir: '/cfg' });
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.claudeMdUpdated).toBe(true);
    const after = files.get('/work/CLAUDE.md') as string;
    // User content above the hint is preserved; the stale body is gone; the fresh
    // body (now close-marker-delimited) is in.
    expect(after).toContain('User rule: use tabs.');
    expect(after).not.toContain('stale old hint body');
    expect(after).toContain('<!-- /bh:workspace-hint -->');
    expect(after).toContain('.bh/current_focus.yaml'); // the fresh body's entry point
    // Exactly one open + one close marker — no stacking.
    expect(after.match(/<!-- bh:workspace-hint -->/g)).toHaveLength(1);
    expect(after.match(/<!-- \/bh:workspace-hint -->/g)).toHaveLength(1);
  });

  it('is idempotent on the current (close-marker) format: a second init skips', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w', setup: true });
    const afterFirst = files.get('/work/CLAUDE.md') as string;
    // Re-run setup via a re-add (idempotent path): no marker churn, reported as skip.
    const r = await core.run<unknown, { setup: SetupReport }>('workspace.add', {
      path: '/work',
      name: 'w',
      setup: true,
    });
    expect(r.setup.claudeMdSkipped).toBe(true);
    expect(r.setup.claudeMdUpdated).toBe(false);
    expect(files.get('/work/CLAUDE.md')).toBe(afterFirst); // byte-identical
  });

  it('UPGRADES a legacy bh:recall-hint section to the current hint', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    // Older workspaces had a pre-pivot `bh:recall-hint` marker. Re-running init
    // should REPLACE it with the current hint, not stack a second section.
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
    expect(r.setup.claudeMdUpdated).toBe(true);
    const after = files.get('/work/CLAUDE.md') as string;
    expect(after).toContain('# Top');
    expect(after).not.toContain('legacy decisions-recall guide');
    expect(after).toContain('<!-- bh:workspace-hint -->');
    expect(after).toContain('<!-- /bh:workspace-hint -->');
  });

  it('upgrades each hint file independently (legacy AGENTS.md + fresh CLAUDE.md)', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/work');
    // AGENTS.md was curated by a prior (legacy) init; CLAUDE.md is fresh.
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
    // Both end up with the current hint: AGENTS.md upgraded, CLAUDE.md created.
    expect(r.setup.agentsMdUpdated).toBe(true);
    expect(r.setup.claudeMdUpdated).toBe(true);
    expect(files.get('/work/AGENTS.md')).toContain('<!-- /bh:workspace-hint -->');
    expect(files.get('/work/AGENTS.md')).not.toContain('\n\nold\n');
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

  it('renameFile: moves the note, returns the landing path, leaves the body verbatim', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/old.md', '# hi\n\nbody\n');
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
    await core.run('workspace.add', { path: '/v' });

    type R = { from: string; to: string; renamed: boolean };
    const res = await core.run<{ from: string; to: string }, R>('workspace.renameFile', {
      from: 'old.md',
      to: 'new name.md',
    });
    expect(res).toEqual({ from: 'old.md', to: 'new name.md', renamed: true });
    expect(files.get('/v/new name.md')).toBe('# hi\n\nbody\n'); // body untouched
    expect(files.has('/v/old.md')).toBe(false);
  });

  it('renameFile: a name collision auto-suffixes -2 and never clobbers', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/src.md', 'B');
    files.set('/v/taken.md', 'A');
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
    await core.run('workspace.add', { path: '/v' });

    const res = await core.run<{ from: string; to: string }, { to: string; renamed: boolean }>(
      'workspace.renameFile',
      { from: 'src.md', to: 'taken.md' },
    );
    expect(res.to).toBe('taken-2.md');
    expect(files.get('/v/taken.md')).toBe('A'); // existing file untouched
    expect(files.get('/v/taken-2.md')).toBe('B');
    expect(files.has('/v/src.md')).toBe(false);
  });

  it('renameFile: unchanged path is a no-op; an escaping destination is refused', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/v');
    files.set('/v/note.md', 'x');
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/v');
    await core.run('workspace.add', { path: '/v' });

    const same = await core.run<{ from: string; to: string }, { renamed: boolean }>(
      'workspace.renameFile',
      { from: 'note.md', to: 'note.md' },
    );
    expect(same.renamed).toBe(false);
    await expect(
      core.run('workspace.renameFile', { from: 'note.md', to: '../evil.md' }),
    ).rejects.toThrow();
    expect(files.get('/v/note.md')).toBe('x'); // still there, untouched
  });
});

describe('workspace.listFiles', () => {
  // listFiles contains enumeration to the call's BOUND workspace root (no longer
  // a stored "current"), so bind the core to the listed dir. It doesn't read
  // workspaces.json at all now — the bound root is the containment anchor.
  it('returns direct children with file/dir types, dirs first, alphabetical', async () => {
    const { fs, files, dirs } = mockFs();
    dirs.add('/root');
    dirs.add('/root/zeta');
    dirs.add('/root/alpha');
    files.set('/root/readme.md', '');
    files.set('/root/notes.txt', '');
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/root');

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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/root');

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
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/root');

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

  it('refuses to enumerate with NO workspace bound (no external-dir oracle)', async () => {
    const { fs, dirs } = mockFs();
    dirs.add('/etc');
    dirs.add('/etc/secret');
    const core = createCore({ fs, configDir: '/cfg' }); // no workspace bound
    await expect(core.run('workspace.listFiles', { path: '/etc' })).rejects.toThrow(
      /No workspace bound/,
    );
  });
});

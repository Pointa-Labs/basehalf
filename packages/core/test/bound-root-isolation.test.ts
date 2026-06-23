import { describe, expect, it } from 'vitest';
import { type BadgeFile, createCore } from '../src/index.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Direct tests of the per-call workspace-root seam (the replacement for the old
 * global "current workspace"). Each `run(name, args, { workspaceRoot })` binds a
 * fresh Context to that root; nested `ctx.run` inherits it; an unbound call
 * refuses. These are the invariants the per-window desktop relies on for
 * race-free parallel workspaces.
 */
describe('per-call workspaceRoot seam', () => {
  async function twoWorkspaces() {
    const { fs, dirs } = mockFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    return core;
  }

  it('isolates writes by the call-bound root — no bleed between workspaces', async () => {
    const core = await twoWorkspaces();
    // Same relative path, two different bound roots → two independent badges.
    await core.run(
      'badge.set',
      { file: 'note.md', patch: { description: 'in A' } },
      { workspaceRoot: '/a' },
    );
    await core.run(
      'badge.set',
      { file: 'note.md', patch: { description: 'in B' } },
      { workspaceRoot: '/b' },
    );

    const a = (await core.run(
      'badge.get',
      { file: 'note.md' },
      { workspaceRoot: '/a' },
    )) as BadgeFile;
    const b = (await core.run(
      'badge.get',
      { file: 'note.md' },
      { workspaceRoot: '/b' },
    )) as BadgeFile;
    expect(a.description).toBe('in A');
    expect(b.description).toBe('in B');
  });

  it('workspace.current / list.current derive from the call-bound root (not a stored pointer)', async () => {
    const core = await twoWorkspaces();
    const ca = (await core.run('workspace.current', {}, { workspaceRoot: '/a' })) as {
      current: { name: string } | null;
    };
    const cb = (await core.run('workspace.current', {}, { workspaceRoot: '/b' })) as {
      current: { name: string } | null;
    };
    expect(ca.current?.name).toBe('a');
    expect(cb.current?.name).toBe('b');

    const la = (await core.run('workspace.list', {}, { workspaceRoot: '/a' })) as {
      current: string | null;
    };
    expect(la.current).toBe('a');
  });

  it('a nested ctx.run inherits the call root (listCanvas → listFiles stays in one workspace)', async () => {
    // listCanvas composes workspace.listFiles internally via ctx.run with NO
    // explicit opts — it must inherit the call's bound root, so its readdir
    // targets /a's tree, never an unbound/other path.
    const seen: string[] = [];
    const probe = createCore({ fs: traceFs(seen), configDir: '/cfg' });
    await probe.run('workspace.add', { path: '/a', name: 'a' });
    await probe.run('workspace.listCanvas', { folder: null }, { workspaceRoot: '/a' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p === '/a' || p.startsWith('/a/'))).toBe(true);
  });

  it('an explicit opts on a nested call overrides the inherited root', async () => {
    const core = await twoWorkspaces();
    // Seed a badge in B, then read it from a call BOUND to A but with an explicit
    // per-call override to B — the override wins.
    await core.run(
      'badge.set',
      { file: 'x.md', patch: { description: 'B-only' } },
      { workspaceRoot: '/b' },
    );
    const viaOverride = (await core.run(
      'badge.get',
      { file: 'x.md' },
      { workspaceRoot: '/b' },
    )) as BadgeFile | null;
    expect(viaOverride?.description).toBe('B-only');
    // The same read bound to A sees nothing (proves the roots are truly separate).
    const viaA = await core.run('badge.get', { file: 'x.md' }, { workspaceRoot: '/a' });
    expect(viaA).toBeNull();
  });

  it('refuses an unbound call into a workspace-scoped command', async () => {
    const core = await twoWorkspaces();
    await expect(core.run('badge.get', { file: 'note.md' })).rejects.toThrow(/No workspace bound/);
    await expect(core.run('focus.get', {})).rejects.toThrow(/No workspace bound/);
    await expect(core.run('search.query', { query: 'x' })).rejects.toThrow(/No workspace bound/);
  });
});

/** A mockFs that records every readdir path, so we can prove a nested compose
 *  stayed inside the bound root. */
function traceFs(seen: string[]) {
  const { fs, dirs } = mockFs();
  dirs.add('/a');
  dirs.add('/a/sub');
  const realReaddir = fs.readdir.bind(fs);
  fs.readdir = async (path: string) => {
    seen.push(path);
    return realReaddir(path);
  };
  return fs;
}

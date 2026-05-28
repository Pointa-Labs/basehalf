import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { FsLike } from '../src/index.js';

// fs mock with a real event-loop yield inside every op, so concurrent
// unawaited read-modify-write sequences interleave deterministically — the
// only way to observe a lost-update race in a unit test (see the matching
// inbound-concurrency.test.ts).
function yieldingFs(): { fs: FsLike; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  function addAncestors(path: string): void {
    let parent = path;
    while (parent.includes('/') && parent !== '/') {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      if (parent) dirs.add(parent);
    }
  }
  const fs: FsLike = {
    async readFile(path) {
      await tick();
      return files.has(path) ? (files.get(path) as string) : null;
    },
    async writeFile(path, content) {
      await tick();
      files.set(path, content);
      addAncestors(path);
    },
    async mkdir(path, opts) {
      await tick();
      dirs.add(path);
      if (opts?.recursive) addAncestors(path);
    },
    async stat(path) {
      await tick();
      if (files.has(path)) return { isFile: true, isDirectory: false };
      if (dirs.has(path)) return { isFile: false, isDirectory: true };
      return null;
    },
    async readdir(path) {
      await tick();
      if (!dirs.has(path)) {
        throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
      }
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          const i = rest.indexOf('/');
          names.add(i === -1 ? rest : rest.slice(0, i));
        }
      }
      return Array.from(names).sort();
    },
    async unlink(path) {
      await tick();
      files.delete(path);
    },
  };
  return { fs, dirs };
}

// Regression for the views lost-update race. view.addMember / removeMember /
// update do read -> mutate -> write on a single view JSON. The desktop fires
// these concurrently — a canvas drag persists a position via addMember while
// badge.rename rewrites the same view's membership, or two rapid drags
// overlap — and without serialization the second write clobbered the first.
// views/commands.ts now serializes per view path.
describe('views lost-update race', () => {
  it('two concurrent addMember of different files keep both members', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });
    await core.run('view.create', { id: 'v', name: 'V' });

    const a = core.run('view.addMember', { id: 'v', file: 'a.md', position: { x: 1, y: 1 } });
    const b = core.run('view.addMember', { id: 'v', file: 'b.md', position: { x: 2, y: 2 } });
    await Promise.all([a, b]);

    const view = await core.run('view.get', { id: 'v' });
    expect(view?.members.map((m: { file: string }) => m.file).sort()).toEqual(['a.md', 'b.md']);
  });

  it('a drag (addMember) concurrent with rename-style remove+add does not lose the drag', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });
    await core.run('view.create', { id: 'v', name: 'V' });
    await core.run('view.addMember', { id: 'v', file: 'old.md', position: { x: 5, y: 5 } });

    // Concurrently: a canvas drag adds c.md, while a rename rewrites the
    // membership (remove old.md, add new.md). All three race on view v.
    const drag = core.run('view.addMember', { id: 'v', file: 'c.md', position: { x: 9, y: 9 } });
    const renameRemove = core.run('view.removeMember', { id: 'v', file: 'old.md' });
    const renameAdd = core.run('view.addMember', {
      id: 'v',
      file: 'new.md',
      position: { x: 5, y: 5 },
    });
    await Promise.all([drag, renameRemove, renameAdd]);

    const view = await core.run('view.get', { id: 'v' });
    const files = view?.members.map((m: { file: string }) => m.file).sort();
    // old.md removed; c.md (the drag) and new.md (the rename) both survive.
    expect(files).toEqual(['c.md', 'new.md']);
  });

  it('update (rename view) concurrent with addMember keeps both the new name and the member', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });
    await core.run('view.create', { id: 'v', name: 'Old Name' });

    const rename = core.run('view.update', { id: 'v', patch: { name: 'New Name' } });
    const drag = core.run('view.addMember', { id: 'v', file: 'a.md', position: { x: 1, y: 1 } });
    await Promise.all([rename, drag]);

    const view = await core.run('view.get', { id: 'v' });
    expect(view?.name).toBe('New Name');
    expect(view?.members.map((m: { file: string }) => m.file)).toEqual(['a.md']);
  });
});

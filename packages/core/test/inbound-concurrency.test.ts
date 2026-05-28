import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { FsLike } from '../src/index.js';

// fs mock that introduces a real event-loop yield (macrotask) inside every
// operation, mimicking actual disk I/O scheduling so that concurrent
// unawaited operations can interleave between read and write. This is what
// makes the lost-update race deterministically observable in a unit test:
// without the yield, JS runs each handler to its first await synchronously
// and the interleaving never happens.
function yieldingFs(): { fs: FsLike; files: Map<string, string>; dirs: Set<string> } {
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
        const err = Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
        throw err;
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
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          const i = rest.indexOf('/');
          if (i === -1 && rest.length > 0) names.add(rest);
        }
      }
      return Array.from(names).sort();
    },
    async unlink(path) {
      await tick();
      files.delete(path);
    },
  };
  return { fs, files, dirs };
}

// Regression for the inbound lost-update race: addRef/removeRef do
// read -> mutate -> write on the single shared .bh/index/inbound.json. Two
// concurrent addRefs to the same target used to both read the pre-write
// state, and the second write clobbered the first -- silently dropping a
// backlink from the agent-contract surface. inbound/commands.ts now
// serializes these read-modify-writes per workspace root.
describe('inbound lost-update race', () => {
  it('two concurrent inbound.addRef to the same target keep both entries', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    // Fire two concurrently WITHOUT awaiting the first -- the race window.
    const p1 = core.run('inbound.addRef', { from: 'a.md', to: 'target.md' });
    const p2 = core.run('inbound.addRef', { from: 'b.md', to: 'target.md' });
    await Promise.all([p1, p2]);

    const res = await core.run('inbound.get', { file: 'target.md' });
    expect(res.entries.map((e: { from: string }) => e.from).sort()).toEqual(['a.md', 'b.md']);
  });

  it('two concurrent badge.addRef to the same target keep both entries (full UI path)', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    // badge.addRef cascades into inbound.addRef; distinct source badges
    // (a.md.json / b.md.json) don't collide, but both touch the one
    // inbound.json for target.md.
    const p1 = core.run('badge.addRef', { file: 'a.md', to: 'target.md' });
    const p2 = core.run('badge.addRef', { file: 'b.md', to: 'target.md' });
    await Promise.all([p1, p2]);

    const res = await core.run('inbound.get', { file: 'target.md' });
    expect(res.entries.map((e: { from: string }) => e.from).sort()).toEqual(['a.md', 'b.md']);
  });

  it('concurrent addRef + removeRef on the same target serialize cleanly', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    // Seed an existing backlink, then concurrently add a second and remove
    // the first. With serialization the final state is deterministic:
    // exactly the surviving 'b.md' entry, regardless of interleaving order
    // of the read-modify-writes.
    await core.run('inbound.addRef', { from: 'a.md', to: 'target.md' });
    const add = core.run('inbound.addRef', { from: 'b.md', to: 'target.md' });
    const remove = core.run('inbound.removeRef', { from: 'a.md', to: 'target.md' });
    await Promise.all([add, remove]);

    const res = await core.run('inbound.get', { file: 'target.md' });
    expect(res.entries.map((e: { from: string }) => e.from)).toEqual(['b.md']);
  });
});

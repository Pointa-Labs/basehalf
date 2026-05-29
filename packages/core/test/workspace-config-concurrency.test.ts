import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { FsLike } from '../src/index.js';

// fs mock with a real event-loop yield inside every op, so concurrent
// unawaited read-modify-write sequences interleave deterministically.
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
      if (!dirs.has(path)) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
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

// Regression for the workspace-config lost-update race. add / use / remove /
// rename / repath / setViewport all read workspaces.json, mutate, write — and
// the desktop fires setViewport as a DEBOUNCED, fire-and-forget call that is
// NOT awaited and NOT behind the renderer's busy guard. So a stale in-flight
// setViewport can race a workspace switch: both read the pre-write config and
// the second write clobbers the first. The scary direction is setViewport
// winning and reverting `current` — silently undoing the user's switch.
// workspace/commands.ts now serializes config writes via the shared mutex.
describe('workspace config lost-update race', () => {
  it('setViewport racing workspace.use keeps the switch AND the viewport', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    // current is 'a' (first added). Concurrently: a debounced viewport
    // persist for 'a' races a switch to 'b'.
    const vp = core.run('workspace.setViewport', {
      viewport: { offsetX: 10, offsetY: 20, scale: 2 },
    });
    const use = core.run('workspace.use', { name: 'b' });
    await Promise.all([vp, use]);

    const cur = await core.run('workspace.current', {});
    // The switch must survive — a stale viewport write must not revert it.
    expect(cur.current?.name).toBe('b');
    // And the viewport write must not be lost either.
    const list = await core.run('workspace.list', {});
    const a = list.workspaces.find((w: { name: string }) => w.name === 'a');
    expect(a?.viewport).toEqual({ offsetX: 10, offsetY: 20, scale: 2 });
  });

  it('two concurrent workspace.add keep both workspaces', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/a');
    dirs.add('/b');
    const core = createCore({ fs, configDir: '/cfg' });
    // First add seeds the config + becomes current (materializes); do it
    // alone so the race under test is purely the two concurrent adds below.
    await core.run('workspace.add', { path: '/a', name: 'a' });
    const addB = core.run('workspace.add', { path: '/b', name: 'b' });
    const addC = core.run('workspace.add', { path: '/b', name: 'c' });
    await Promise.all([addB, addC]);

    const list = await core.run('workspace.list', {});
    expect(list.workspaces.map((w: { name: string }) => w.name).sort()).toEqual(['a', 'b', 'c']);
  });
});

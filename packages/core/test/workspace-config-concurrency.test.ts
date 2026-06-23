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

// Regression for the workspace-config lost-update race. add / remove / rename /
// repath / setViewport all read workspaces.json, mutate, write — and the desktop
// fires setViewport as a DEBOUNCED, fire-and-forget call that is NOT awaited. So a
// stale in-flight setViewport can race another config write: both read the
// pre-write config and the second write clobbers the first (a dropped entry or a
// lost viewport). workspace/commands.ts serializes config writes via the shared
// mutex. (There is no global `current` to clobber anymore — the active workspace
// is bound per window/call, not stored — so the only race left is the generic
// entry/viewport lost-update guarded here.)
describe('workspace config lost-update race', () => {
  it('setViewport racing a concurrent workspace.add keeps BOTH the viewport and the new entry', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/a');
    dirs.add('/b');
    dirs.add('/c');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/a', name: 'a' });
    await core.run('workspace.add', { path: '/b', name: 'b' });
    // A debounced viewport persist for 'a' (bound to /a) races a new workspace.add.
    // Both are RMW on workspaces.json — without the shared mutex the second write
    // would clobber the first (lost viewport OR dropped entry).
    const vp = core.run(
      'workspace.setViewport',
      { viewport: { offsetX: 10, offsetY: 20, scale: 2 } },
      { workspaceRoot: '/a' },
    );
    const add = core.run('workspace.add', { path: '/c', name: 'c' });
    await Promise.all([vp, add]);

    const list = await core.run('workspace.list', {});
    // The new workspace survived...
    expect(list.workspaces.map((w: { name: string }) => w.name).sort()).toEqual(['a', 'b', 'c']);
    // ...and the viewport write was not lost.
    const a = list.workspaces.find((w: { name: string }) => w.name === 'a');
    expect(a?.viewport).toEqual({ offsetX: 10, offsetY: 20, scale: 2 });
  });

  it('two concurrent workspace.add keep both workspaces', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/a');
    dirs.add('/b');
    dirs.add('/c');
    const core = createCore({ fs, configDir: '/cfg' });
    // First add seeds the config + becomes current (materializes); do it
    // alone so the race under test is purely the two concurrent adds below.
    // Distinct paths on purpose: same-path adds dedupe by design (folder
    // identity is the path); the race under test is the config lost-update.
    await core.run('workspace.add', { path: '/a', name: 'a' });
    const addB = core.run('workspace.add', { path: '/b', name: 'b' });
    const addC = core.run('workspace.add', { path: '/c', name: 'c' });
    await Promise.all([addB, addC]);

    const list = await core.run('workspace.list', {});
    expect(list.workspaces.map((w: { name: string }) => w.name).sort()).toEqual(['a', 'b', 'c']);
  });
});

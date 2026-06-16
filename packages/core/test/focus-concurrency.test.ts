import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { FsLike } from '../src/index.js';

// fs mock that yields a macrotask inside every op (mimicking real disk I/O
// scheduling) so concurrent unawaited operations interleave between the symlink
// unlink and re-create — the window where a torn current_focus would be
// observable. It models a minimal symlink table (links) so focus.set's
// unlink-then-symlink retarget and focus.get's readlink-resolve run end to end.
// No realpath/lstat/*NoFollow, so the focus store's containment guards degrade to
// the lexical path (correct: no symlinks-to-outside here).
function yieldingFs(): {
  fs: FsLike;
  files: Map<string, string>;
  links: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const links = new Map<string, string>();
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
      const removed = files.delete(path) || links.delete(path);
      if (!removed) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
    },
    async symlink(target, path) {
      await tick();
      if (files.has(path) || links.has(path)) {
        throw Object.assign(new Error(`EEXIST ${path}`), { code: 'EEXIST' });
      }
      links.set(path, target);
      addAncestors(path);
    },
    async readlink(path) {
      await tick();
      return links.has(path) ? (links.get(path) as string) : null;
    },
  };
  return { fs, files, links, dirs };
}

// Regression for a TORN current_focus symlink. focus.set is a two-step retarget
// (unlink the old symlink, then create the new one) plus the node focus.yaml
// write — all under the per-workspace-root focus mutex. Without the mutex, two
// racing sets could interleave their unlink/symlink steps: one set's symlink
// creation could EEXIST against the other's, or a concurrent get could land in
// the gap and see no symlink. The mutex makes the outcome deterministic:
// last-writer-wins, and get always returns exactly one valid node.
describe('current_focus torn-symlink race', () => {
  it('two concurrent focus.set: last writer wins, no tear, no EEXIST', async () => {
    const { fs, links, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    // Fire both WITHOUT awaiting the first — the interleave window. Serialized by
    // the focus mutex, neither tears the symlink nor throws EEXIST.
    const aP = core.run('focus.set', { path: 'a.md', kind: 'file' });
    const bP = core.run('focus.set', { path: 'b.md', kind: 'file' });
    await expect(Promise.all([aP, bP])).resolves.toBeDefined();

    // Exactly one symlink exists and it resolves to a valid node.
    expect(links.size).toBe(1);
    const got = (await core.run('focus.get', {})) as { path: string; kind: string };
    expect(['a.md', 'b.md']).toContain(got.path);
    expect(got.kind).toBe('file');
    // The winning symlink points at the node get returned (no mismatch / tear).
    expect(links.get('/work/.bh/current_focus.yaml')).toBe(`mirror/${got.path}/focus.yaml`);
  });

  it('focus.set racing focus.clear: get is either the set node or null, never torn', async () => {
    const { fs, links, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    await core.run('focus.set', { path: 'seed.md', kind: 'file' });
    // Race a retarget against a clear. The mutex serializes them; the final state
    // is one of the two deterministic outcomes, never a half-applied symlink.
    const setP = core.run('focus.set', { path: 'next.md', kind: 'file' });
    const clearP = core.run('focus.clear', {});
    await Promise.all([setP, clearP]);

    const got = (await core.run('focus.get', {})) as { path: string } | null;
    if (got === null) {
      expect(links.has('/work/.bh/current_focus.yaml')).toBe(false);
    } else {
      expect(got.path).toBe('next.md');
      expect(links.get('/work/.bh/current_focus.yaml')).toBe('mirror/next.md/focus.yaml');
    }
  });

  it('many concurrent focus.set settle to a single intact symlink', async () => {
    const { fs, links, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    const paths = ['p0.md', 'p1.md', 'p2.md', 'p3.md', 'p4.md', 'p5.md'];
    await Promise.all(paths.map((p) => core.run('focus.set', { path: p, kind: 'file' })));

    expect(links.size).toBe(1);
    const got = (await core.run('focus.get', {})) as { path: string };
    expect(paths).toContain(got.path);
    expect(links.get('/work/.bh/current_focus.yaml')).toBe(`mirror/${got.path}/focus.yaml`);
  });
});

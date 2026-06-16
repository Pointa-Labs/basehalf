import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { FsLike } from '../src/index.js';

// fs mock that yields a macrotask inside every op (mimicking real disk I/O
// scheduling) so concurrent unawaited operations interleave between read and
// write — what makes a lost-update race deterministically observable. No
// realpath/lstat/*NoFollow, so the focus store's containment guards degrade to
// the lexical path (correct: no symlinks here) and still hit readFile/writeFile
// where the yield lives. Mirrors inbound-concurrency.test.ts.
function yieldingFs(hooks?: {
  onReadFile?: (path: string, content: string | null) => Promise<string | null> | string | null;
  onWriteFile?: (path: string, content: string) => Promise<void> | void;
}): { fs: FsLike; files: Map<string, string>; dirs: Set<string> } {
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
      const content = files.has(path) ? (files.get(path) as string) : null;
      return hooks?.onReadFile ? hooks.onReadFile(path, content) : content;
    },
    async writeFile(path, content) {
      await tick();
      files.set(path, content);
      addAncestors(path);
      await hooks?.onWriteFile?.(path, content);
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
      files.delete(path);
    },
  };
  return { fs, files, dirs };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Regression for the focus.md lost-update race: focus.resync is a
// read-modify-write on the single .bh/focus.md (read the active list, re-inline
// fresh badge data, write back). Racing a focus.set, resync's STALE read of the
// old active list would write it back and clobber the set's newer list —
// silently dropping a file from the agent-contract surface. focus/commands.ts
// serializes all focus.md writes (set/clear/resync) per workspace root with a
// focus-file mutex; this proves the final state is deterministic.
describe('focus.md lost-update race', () => {
  it('concurrent focus.set + focus.resync: resync must not clobber the newer set', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    await core.run('focus.set', { files: ['a.md'] }); // seed: active = [a.md]
    // Fire concurrently WITHOUT awaiting the first — the race window. The set
    // widens the active list to [a.md, b.md]; the resync re-renders whatever
    // active list it reads. Without the mutex, resync can read the stale [a.md]
    // and write it back over the set's [a.md, b.md].
    const setP = core.run('focus.set', { files: ['a.md', 'b.md'] });
    const resyncP = core.run('focus.resync', {});
    await Promise.all([setP, resyncP]);

    const got = (await core.run('focus.get', {})) as { active: string[] };
    expect(got.active).toEqual(['a.md', 'b.md']);
  });

  it('concurrent badge.addRef (auto-resync) + focus.set keep the wider active list', async () => {
    const { fs, dirs } = yieldingFs();
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    await core.run('focus.set', { files: ['a.md'] });
    // badge.addRef on the active a.md cascades into focus.resync; race it with
    // a focus.set that widens the list. The full UI path (badge edit + focus
    // change at once) must not lose b.md.
    const editP = core.run('badge.addRef', { file: 'a.md', to: 'dep.md' });
    const setP = core.run('focus.set', { files: ['a.md', 'b.md'] });
    await Promise.all([editP, setP]);

    const got = (await core.run('focus.get', {})) as { active: string[] };
    expect(got.active).toEqual(['a.md', 'b.md']);
  });

  it('concurrent badge edit + focus.set keep the fresh inlined prompt', async () => {
    const oldBadgeReadStarted = deferred();
    const releaseOldBadgeRead = deferred();
    const freshFocusWritten = deferred();
    let blockNextBadgeRead = false;
    const { fs, files, dirs } = yieldingFs({
      async onReadFile(path, content) {
        if (blockNextBadgeRead && path === '/work/.bh/mirror/a.md/badge.yaml') {
          blockNextBadgeRead = false;
          oldBadgeReadStarted.resolve();
          await releaseOldBadgeRead.promise;
        }
        return content;
      },
      onWriteFile(path, content) {
        if (path === '/work/.bh/focus.md' && content.includes('prompt: FRESH prompt')) {
          freshFocusWritten.resolve();
        }
      },
    });
    dirs.add('/work');
    const core = createCore({ fs, configDir: '/cfg' });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    await core.run('badge.set', { file: 'a.md', patch: { description: 'OLD prompt' } });
    await core.run('focus.set', { files: ['a.md'] });

    blockNextBadgeRead = true;
    const setP = core.run('focus.set', { files: ['a.md'] });
    await oldBadgeReadStarted.promise;

    const editP = core.run('badge.set', { file: 'a.md', patch: { description: 'FRESH prompt' } });
    await Promise.race([freshFocusWritten.promise, sleep(50)]);
    releaseOldBadgeRead.resolve();
    await Promise.all([setP, editP]);

    const md = files.get('/work/.bh/focus.md') ?? '';
    expect(md).toContain('prompt: FRESH prompt');
    expect(md).not.toContain('prompt: OLD prompt');
  });
});

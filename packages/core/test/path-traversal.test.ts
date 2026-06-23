import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { assertWorkspaceRelative } from '../src/kernel/index.js';
import { boundCore } from './helpers/bound-core.js';
import { mockFs } from './helpers/mock-fs.js';

// Regression for a path-traversal / arbitrary-write bug: badge.set (and
// every other badge op) routed `args.file` straight into
// `path.join(root, '.bh/badges', file + '.json')` with no validation. A
// value like '../../../etc/passwd' collapsed through join and escaped the
// workspace — badge.set({ file: '../../../etc/passwd' }) wrote
// '/etc/passwd.json'. workspace.writeFile already rejected this; badges did
// not. Both now share the kernel guard assertWorkspaceRelative.
describe('workspace-relative path guard', () => {
  it('assertWorkspaceRelative rejects traversal, absolute, and empty paths', () => {
    expect(() => assertWorkspaceRelative('../etc/passwd')).toThrow(/traversal/i);
    expect(() => assertWorkspaceRelative('a/../../b')).toThrow(/traversal/i);
    expect(() => assertWorkspaceRelative('/etc/passwd')).toThrow(/relative/i);
    expect(() => assertWorkspaceRelative('C:\\Windows\\x')).toThrow(/relative/i);
    expect(() => assertWorkspaceRelative('..\\..\\x')).toThrow(/traversal/i);
    expect(() => assertWorkspaceRelative('')).toThrow();
  });

  it('assertWorkspaceRelative accepts ordinary nested rel paths', () => {
    expect(() => assertWorkspaceRelative('intro.md')).not.toThrow();
    expect(() => assertWorkspaceRelative('notes/chapter-3.md')).not.toThrow();
    // A `..` only counts as a whole segment — a filename containing dots
    // (like "..hidden" or "a..b.md") is legitimate and must be allowed.
    expect(() => assertWorkspaceRelative('a..b.md')).not.toThrow();
    expect(() => assertWorkspaceRelative('notes/..hidden.md')).not.toThrow();
  });
});

describe('badge path traversal is rejected', () => {
  it('badge.set with a ../ path throws and writes nothing outside the workspace', async () => {
    const { fs, files } = mockFs();
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/work');
    fs.mkdir('/work', { recursive: true });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    await expect(
      core.run('badge.set', { file: '../../../etc/passwd', patch: { prompt: 'pwned' } }),
    ).rejects.toThrow(/traversal/i);

    // No badge file escaped the workspace. (/cfg/workspaces.json is the
    // registry and is expected outside /work; what must NOT exist is a
    // write derived from the traversal path.)
    expect(files.has('/etc/passwd.json')).toBe(false);
    const escapedBadges = Array.from(files.keys()).filter(
      (k) => k.includes('passwd') || k.startsWith('/etc'),
    );
    expect(escapedBadges).toEqual([]);
  });

  it('badge.get / badge.delete / badge.addRef also reject traversal', async () => {
    const { fs } = mockFs();
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/work');
    fs.mkdir('/work', { recursive: true });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    await expect(core.run('badge.get', { file: '../escape' })).rejects.toThrow(/traversal/i);
    await expect(core.run('badge.delete', { file: '../escape' })).rejects.toThrow(/traversal/i);
    await expect(core.run('badge.addRef', { file: '../escape', to: 'x.md' })).rejects.toThrow(
      /traversal/i,
    );
  });

  it('a legitimate nested badge path still works', async () => {
    const { fs, files } = mockFs();
    const core = boundCore(createCore({ fs, configDir: '/cfg' }), '/work');
    fs.mkdir('/work', { recursive: true });
    await core.run('workspace.add', { path: '/work', name: 'w' });

    await core.run('badge.set', { file: 'notes/chapter-3.md', patch: { prompt: 'ok' } });
    expect(files.has('/work/.bh/mirror/notes/chapter-3.md/badge.yaml')).toBe(true);
  });
});

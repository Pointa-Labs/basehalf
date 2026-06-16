import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

/**
 * badge.rename must treat the focus.md reconcile as BEST-EFFORT — exactly like
 * badge.set/addRef/removeRef do via reconcileFocus. A hostile / workspace-
 * escaping symlinked focus.md makes focus.renameActiveFile throw PathEscape; if
 * that aborted badge.rename, steps 1-3 (badge move + inbound) would already have
 * committed, leaving the badge moved but the op reported as a failure. Real fs
 * (real symlink) — mockFs can't model this.
 */

let base: string;
let ws: string;
let outside: string;
// biome-ignore lint/suspicious/noExplicitAny: test-local core handle
let core: any;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'bh-rename-sym-'));
  ws = join(base, 'workspace');
  outside = join(base, 'outside');
  await mkdir(ws, { recursive: true });
  await mkdir(outside, { recursive: true });
  const cfg = join(base, 'cfg');
  await mkdir(cfg, { recursive: true });
  core = createCore({ configDir: cfg });
  await core.run('workspace.add', { path: ws, name: 'ws' });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('badge.rename with a hostile focus.md (real fs)', () => {
  it('still completes the rename when focus.md is a workspace-escaping symlink', async () => {
    await writeFile(join(ws, 'note.md'), '# Note\n');
    await core.run('badge.set', { file: 'note.md', patch: {} });
    await core.run('focus.set', { files: ['note.md'] }); // note.md is active

    // Replace .bh/focus.md with a symlink escaping the workspace → the focus
    // reconcile (focus.renameActiveFile) will throw PathEscape.
    const secret = join(outside, 'secret.md');
    await writeFile(secret, 'SECRET\n');
    await unlink(join(ws, '.bh', 'focus.md'));
    await symlink(secret, join(ws, '.bh', 'focus.md'));

    // The rename must NOT throw despite the hostile focus.md...
    const result = (await core.run('badge.rename', { from: 'note.md', to: 'note2.md' })) as {
      badge: { path: string };
    };
    expect(result.badge.path).toBe('note2.md');

    // ...and the badge actually moved (steps 1-3 committed).
    const list = (await core.run('badge.list', {})) as { badges: { path: string }[] };
    const files = list.badges.map((b) => b.path);
    expect(files).toContain('note2.md');
    expect(files).not.toContain('note.md');
  });
});

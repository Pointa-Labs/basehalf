import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

/**
 * badge.rename cascades the WHOLE mirror node: focus is a viewport mirror
 * (`.bh/current_focus.yaml` → `.bh/mirror/<path>/focus.yaml`), and the rename now
 * carries the focus.yaml subtree with the badge AND repoints the current_focus
 * symlink when it pointed inside the renamed node — so `focusUpdated: true` and the
 * agent keeps tracking the node. This runs against the REAL fs (real `.bh/mirror/`
 * symlink for current_focus) — the in-memory mock can't model the actual symlink
 * retarget end to end. It pins that the rename commits the badge AND the focus
 * follows it across a real symlink.
 */

let base: string;
let ws: string;
// biome-ignore lint/suspicious/noExplicitAny: test-local core handle
let core: any;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'bh-rename-sym-'));
  ws = join(base, 'workspace');
  await mkdir(ws, { recursive: true });
  const cfg = join(base, 'cfg');
  await mkdir(cfg, { recursive: true });
  core = createCore({ configDir: cfg });
  await core.run('workspace.add', { path: ws, name: 'ws' });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('badge.rename + current_focus (real fs)', () => {
  it('cascades the focus: focusUpdated:true and current_focus follows across a real symlink', async () => {
    // Rename BOTH the user file and the badge (what workspace.renameEntry does), so
    // the end state is coherent — the node really lives at note2.md now.
    await writeFile(join(ws, 'note.md'), '# Note\n');
    await core.run('badge.set', { file: 'note.md', patch: {} });
    // Focus the node being renamed (real current_focus symlink in .bh/mirror/).
    await core.run('focus.set', { path: 'note.md', kind: 'file' });
    // Move the user file on disk first (renameEntry's first step), then the badge.
    await core.run('workspace.renameEntry', { from: 'note.md', to: 'note2.md', kind: 'file' });

    // The badge actually moved.
    const list = (await core.run('badge.list', {})) as { badges: { path: string }[] };
    const files = list.badges.map((b) => b.path);
    expect(files).toContain('note2.md');
    expect(files).not.toContain('note.md');

    // current_focus followed the rename across the real symlink → the new path.
    const focus = (await core.run('focus.get', {})) as { path: string; kind: string } | null;
    expect(focus).toEqual({ path: 'note2.md', kind: 'file' });
    // The node exists on disk at the new path, so pruneDangling leaves it in place.
    const pruned = (await core.run('focus.pruneDangling', {})) as { cleared: boolean };
    expect(pruned.cleared).toBe(false);
  });

  it('reports focusUpdated:true from a direct badge.rename of the focused node', async () => {
    await writeFile(join(ws, 'note.md'), '# Note\n');
    await core.run('badge.set', { file: 'note.md', patch: {} });
    await core.run('focus.set', { path: 'note.md', kind: 'file' });

    const result = (await core.run('badge.rename', { from: 'note.md', to: 'note2.md' })) as {
      badge: { path: string };
      focusUpdated: boolean;
    };
    expect(result.badge.path).toBe('note2.md');
    expect(result.focusUpdated).toBe(true);
  });
});

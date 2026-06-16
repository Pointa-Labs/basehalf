import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

/**
 * badge.rename no longer reconciles focus: focus is a viewport mirror
 * (`.bh/current_focus.yaml` → `.bh/mirror/<path>/focus.yaml`), not a curated
 * `.bh/focus.md` brief, so the old best-effort `focus.renameActiveFile` cascade
 * (and the hostile-symlinked-focus.md hazard it guarded) is gone. badge.rename
 * always reports `focusUpdated: false` and moves only the badge + inbound. This
 * runs against the REAL fs (real `.bh/mirror/` symlink for current_focus) — the
 * in-memory mock can't model the actual symlink store end to end. It pins that
 * the rename completes and commits regardless of a current_focus pointed at the
 * renamed node (the stale focus is cleaned later by `focus.pruneDangling`).
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
  it('completes the rename and reports focusUpdated:false with the node focused', async () => {
    await writeFile(join(ws, 'note.md'), '# Note\n');
    await core.run('badge.set', { file: 'note.md', patch: {} });
    // Focus the node being renamed (real current_focus symlink in .bh/mirror/).
    await core.run('focus.set', { path: 'note.md', kind: 'file' });

    const result = (await core.run('badge.rename', { from: 'note.md', to: 'note2.md' })) as {
      badge: { path: string };
      focusUpdated: boolean;
    };
    expect(result.badge.path).toBe('note2.md');
    // Focus is a viewport mirror — the rename never cascades into it.
    expect(result.focusUpdated).toBe(false);

    // The badge actually moved (steps 1-3 committed).
    const list = (await core.run('badge.list', {})) as { badges: { path: string }[] };
    const files = list.badges.map((b) => b.path);
    expect(files).toContain('note2.md');
    expect(files).not.toContain('note.md');

    // current_focus still resolves to the OLD node path (rename moved only the
    // badge metadata, not the user file or the focus.yaml): the user file
    // `note.md` is still on disk, so pruneDangling leaves the focus in place.
    const focus = (await core.run('focus.get', {})) as { path: string; kind: string } | null;
    expect(focus).toEqual({ path: 'note.md', kind: 'file' });
    const pruned = (await core.run('focus.pruneDangling', {})) as { cleared: boolean };
    expect(pruned.cleared).toBe(false);
  });
});

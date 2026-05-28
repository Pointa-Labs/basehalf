import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BadgeFile, _resetWatcherForTests, createCore, watcherEvents } from '../src/index.js';
import type { WatcherEvent } from '../src/modules/watcher/types.js';

/**
 * Watcher integration tests. These use real chokidar against a real tmp
 * workspace because there isn't a sensible way to mock chokidar's emit
 * cycle without re-implementing it. Each test rotates a fresh tmpdir
 * + a fresh BH_CONFIG_DIR override, then `_resetWatcherForTests` closes
 * the module-private chokidar instance so state doesn't leak across tests.
 */

// chokidar awaitWriteFinish stabilityThreshold (100ms) + rename buffer
// window (600ms) + slack. Both add AND unlink events are buffered for
// the rename heuristic; markOrphan / materialize only fire after that
// timer expires (or earlier when a paired counterpart arrives).
const DEBOUNCE = 900;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('watcher module', () => {
  let workspaceRoot: string;
  let configDir: string;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  let core: any;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'bh-watcher-ws-'));
    configDir = await mkdtemp(join(tmpdir(), 'bh-watcher-cfg-'));
    core = createCore({ configDir });
    await core.run('workspace.add', { path: workspaceRoot, name: 'w' });
  });

  afterEach(async () => {
    await _resetWatcherForTests();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  it('start returns active:true and remembers the workspaceRoot', async () => {
    const result = await core.run('watcher.start', {});
    expect(result.active).toBe(true);
    expect(result.workspaceRoot).toBe(workspaceRoot);
    const status = await core.run('watcher.status', {});
    expect(status.active).toBe(true);
    expect(status.workspaceRoot).toBe(workspaceRoot);
  });

  it('stop closes the watcher', async () => {
    await core.run('watcher.start', {});
    const result = await core.run('watcher.stop', {});
    expect(result.stopped).toBe(true);
    const status = await core.run('watcher.status', {});
    expect(status.active).toBe(false);
  });

  it('stop is a no-op when nothing is running', async () => {
    const result = await core.run('watcher.stop', {});
    expect(result.stopped).toBe(false);
  });

  it('reacts to file add: materializes a default badge', async () => {
    await core.run('watcher.start', {});
    await writeFile(join(workspaceRoot, 'note.md'), 'hi');
    await sleep(DEBOUNCE);
    const badge = (await core.run('badge.get', { file: 'note.md' })) as BadgeFile | null;
    expect(badge).not.toBeNull();
    expect(badge?.file).toBe('note.md');
    expect(badge?.kind).toBe('file');
  });

  it('reacts to dir add: materializes a folder badge', async () => {
    await core.run('watcher.start', {});
    await mkdir(join(workspaceRoot, 'images'));
    await sleep(DEBOUNCE);
    const badge = (await core.run('badge.get', {
      file: 'images',
      kind: 'folder',
    })) as BadgeFile | null;
    expect(badge?.kind).toBe('folder');
  });

  it('reacts to file unlink: marks badge orphan, preserves prompt + refs', async () => {
    await writeFile(join(workspaceRoot, 'note.md'), 'hi');
    await core.run('workspace.use', { name: 'w' }); // re-materialize to pick up file
    await core.run('badge.set', { file: 'note.md', patch: { prompt: 'matters' } });
    await core.run('badge.addRef', { file: 'note.md', to: 'other.md' });
    await core.run('watcher.start', {});
    await unlink(join(workspaceRoot, 'note.md'));
    await sleep(DEBOUNCE);
    const badge = (await core.run('badge.get', { file: 'note.md' })) as BadgeFile | null;
    expect(badge?.orphan).toBe(true);
    expect(badge?.prompt).toBe('matters');
    expect(badge?.references).toEqual([{ to: 'other.md' }]);
  });

  it('ignores .bh/ writes (would otherwise infinite-loop on our own badge writes)', async () => {
    await core.run('watcher.start', {});
    // Trigger a badge.set ourselves — chokidar should NOT re-fire since .bh
    // is in the ignored globs.
    await core.run('badge.set', { file: 'fake.md', patch: {} });
    await sleep(DEBOUNCE);
    // No infinite loop = success; sanity check that the badge exists once.
    const list = (await core.run('badge.list', {})) as { badges: BadgeFile[] };
    expect(list.badges.filter((b) => b.file === 'fake.md')).toHaveLength(1);
  });

  it('detects rename: unlink + add (same dir + ext within window) → badge.rename', async () => {
    // Pre-seed a file with a custom prompt + an outbound ref so we can
    // tell rename (preservation) from orphan+add (loss).
    await writeFile(join(workspaceRoot, 'old.md'), 'hello');
    await core.run('workspace.use', { name: 'w' });
    await core.run('badge.set', { file: 'old.md', patch: { prompt: 'load-bearing' } });
    await core.run('badge.addRef', { file: 'old.md', to: 'sibling.md' });
    // Also add an inbound ref so we can verify it gets rewritten.
    await core.run('badge.addRef', { file: 'sibling.md', to: 'old.md', note: 'see also' });
    await core.run('watcher.start', {});
    // Perform an OS rename (chokidar fires unlink + add in quick succession).
    await rename(join(workspaceRoot, 'old.md'), join(workspaceRoot, 'new.md'));
    await sleep(DEBOUNCE);

    // Old badge gone; new badge inherits prompt + references.
    const oldBadge = await core.run('badge.get', { file: 'old.md' });
    expect(oldBadge).toBeNull();
    const newBadge = (await core.run('badge.get', { file: 'new.md' })) as BadgeFile | null;
    expect(newBadge?.prompt).toBe('load-bearing');
    expect(newBadge?.references).toEqual([{ to: 'sibling.md' }]);
    expect(newBadge?.orphan).toBeUndefined();

    // sibling.md's outbound ref rewritten to point at the new name.
    const sibling = (await core.run('badge.get', { file: 'sibling.md' })) as BadgeFile;
    expect(sibling.references).toEqual([{ to: 'new.md', note: 'see also' }]);
  });

  it('does NOT misfire as rename when extensions differ (markOrphan + materialize)', async () => {
    await writeFile(join(workspaceRoot, 'doc.md'), 'hello');
    await core.run('workspace.use', { name: 'w' });
    await core.run('badge.set', { file: 'doc.md', patch: { prompt: 'keep me' } });
    await core.run('watcher.start', {});
    // Unlink doc.md; create doc.txt — different extension, NOT a rename.
    await unlink(join(workspaceRoot, 'doc.md'));
    await writeFile(join(workspaceRoot, 'doc.txt'), 'hello');
    await sleep(DEBOUNCE);
    // Old badge is orphan; new badge is empty (fresh materialize).
    const oldBadge = (await core.run('badge.get', { file: 'doc.md' })) as BadgeFile;
    expect(oldBadge.orphan).toBe(true);
    expect(oldBadge.prompt).toBe('keep me'); // preserved on orphan
    const newBadge = (await core.run('badge.get', { file: 'doc.txt' })) as BadgeFile;
    expect(newBadge.prompt).toBeUndefined();
  });

  it('does NOT misfire as rename when parent dirs differ', async () => {
    await mkdir(join(workspaceRoot, 'a'), { recursive: true });
    await mkdir(join(workspaceRoot, 'b'), { recursive: true });
    await writeFile(join(workspaceRoot, 'a', 'x.md'), 'hi');
    await core.run('workspace.use', { name: 'w' });
    await core.run('badge.set', { file: 'a/x.md', patch: { prompt: 'A-bound' } });
    await core.run('watcher.start', {});
    await unlink(join(workspaceRoot, 'a', 'x.md'));
    await writeFile(join(workspaceRoot, 'b', 'x.md'), 'hi');
    await sleep(DEBOUNCE);
    // Different parent dir → orphan + fresh materialize, not rename.
    const oldBadge = (await core.run('badge.get', { file: 'a/x.md' })) as BadgeFile;
    expect(oldBadge.orphan).toBe(true);
    expect(oldBadge.prompt).toBe('A-bound');
    const newBadge = (await core.run('badge.get', { file: 'b/x.md' })) as BadgeFile;
    expect(newBadge.prompt).toBeUndefined();
  });

  it('emits a synthetic rename event on watcherEvents for hosts to react to', async () => {
    await writeFile(join(workspaceRoot, 'old.md'), 'hi');
    await core.run('workspace.use', { name: 'w' });
    await core.run('badge.set', { file: 'old.md' });
    await core.run('watcher.start', {});
    const events: WatcherEvent[] = [];
    const listener = (e: WatcherEvent): void => {
      events.push(e);
    };
    watcherEvents.on('event', listener);
    try {
      await rename(join(workspaceRoot, 'old.md'), join(workspaceRoot, 'new.md'));
      await sleep(DEBOUNCE);
    } finally {
      watcherEvents.off('event', listener);
    }
    const renameEvent = events.find((e) => e.type === 'rename');
    expect(renameEvent).toBeDefined();
    if (renameEvent && renameEvent.type === 'rename') {
      expect(renameEvent.fromRelPath).toBe('old.md');
      expect(renameEvent.toRelPath).toBe('new.md');
      expect(renameEvent.isDir).toBe(false);
    }
  });
});

describe('badge.markOrphan (direct invocation)', () => {
  let workspaceRoot: string;
  let configDir: string;
  // biome-ignore lint/suspicious/noExplicitAny: cross-test core handle
  let core: any;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'bh-orphan-ws-'));
    configDir = await mkdtemp(join(tmpdir(), 'bh-orphan-cfg-'));
    core = createCore({ configDir });
    await core.run('workspace.add', { path: workspaceRoot, name: 'w' });
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  it('returns null when badge does not exist', async () => {
    const result = await core.run('badge.markOrphan', { file: 'missing.md' });
    expect(result).toBeNull();
  });

  it('preserves prompt + references when marking orphan', async () => {
    await core.run('badge.set', { file: 'a.md', patch: { prompt: 'p' } });
    await core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const result = (await core.run('badge.markOrphan', { file: 'a.md' })) as BadgeFile;
    expect(result.orphan).toBe(true);
    expect(result.prompt).toBe('p');
    expect(result.references).toEqual([{ to: 'b.md' }]);
  });
});

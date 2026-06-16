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
// Hard cap for waitFor. macOS FSEvents latency spikes to ~500ms+ under heavy
// parallel load (CI / a busy dev box running other suites), which a fixed
// sleep(DEBOUNCE) then-assert would miss → flaky. waitFor returns the instant
// the expected reconcile lands and only burns wall-clock when the box is slow.
// Kept UNDER vitest's 5000ms default per-test timeout so a genuinely-stalled
// FSEvents stream (an over-saturated box) fails fast with the real terminal
// state rather than hanging until vitest kills the test. On a healthy machine
// events land in well under 1.5s, so this ceiling is never approached.
const SETTLE_TIMEOUT = 4500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `probe` until `done` holds (or SETTLE_TIMEOUT elapses), then return the
 * last value so the test's own expect() reports the real terminal state on
 * timeout. Replaces fixed-sleep-then-assert so the watcher tests don't flake
 * on FSEvents latency under load — fast when quick, tolerant when slow.
 */
async function waitFor<T>(
  probe: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = SETTLE_TIMEOUT,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  for (;;) {
    try {
      last = await probe();
      if (done(last)) return last;
    } catch (err) {
      // The probe can transiently fail while the watcher is MID-WRITE on the
      // badge we're polling (a 0-byte read between O_TRUNC and the write →
      // BadgeCorrupt). That's not the terminal state — keep polling; only
      // surface it if we genuinely run out of time.
      if (Date.now() - start > timeoutMs) throw err;
      await sleep(25);
      continue;
    }
    if (Date.now() - start > timeoutMs) return last;
    await sleep(25);
  }
}

// retry: these are REAL chokidar integration tests against the OS event
// stream — inherently timing-sensitive (FSEvents/inotify latency, the
// rename-pairing window). The deterministic rename-heuristic logic is covered
// separately (watcher-find-counterpart.test.ts) with NO retry, so a genuine
// logic regression still fails hard there; retry here only absorbs OS-timing
// jitter, not correctness.
describe('watcher module', { retry: 2 }, () => {
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

  it('reacts to file add: creates NO badge (files are a sparse overlay)', async () => {
    await core.run('watcher.start', {});
    await writeFile(join(workspaceRoot, 'note.md'), 'hi');
    // Let the add's rename-window buffer expire so its finalize has run.
    await sleep(DEBOUNCE);
    // No eager materialization — a brand-new file gets no badge JSON.
    expect(await core.run('badge.get', { file: 'note.md' })).toBeNull();
    // It still shows on the canvas, read straight from the filesystem.
    const { children } = (await core.run('workspace.listCanvas', { folder: null })) as {
      children: { path: string }[];
    };
    expect(children.some((c) => c.path === 'note.md')).toBe(true);
  });

  it('reacts to dir add: creates NO folder badge (sparse)', async () => {
    await core.run('watcher.start', {});
    await mkdir(join(workspaceRoot, 'images'));
    await sleep(DEBOUNCE);
    expect(await core.run('badge.get', { file: 'images', kind: 'folder' })).toBeNull();
  });

  it('reacts to file unlink: marks badge orphan, preserves description + refs', async () => {
    await writeFile(join(workspaceRoot, 'note.md'), 'hi');
    await core.run('workspace.use', { name: 'w' }); // re-materialize to pick up file
    await core.run('badge.set', { file: 'note.md', patch: { description: 'matters' } });
    await core.run('badge.addRef', { file: 'note.md', to: 'other.md' });
    await core.run('watcher.start', {});
    await unlink(join(workspaceRoot, 'note.md'));
    const badge = (await waitFor(
      () => core.run('badge.get', { file: 'note.md' }),
      (b) => (b as BadgeFile | null)?.orphan === true,
    )) as BadgeFile | null;
    expect(badge?.orphan).toBe(true);
    expect(badge?.description).toBe('matters');
    expect(badge?.references).toEqual(['other.md']);
  });

  it('a buffered unlink does NOT orphan the SAME-named file after a workspace switch', async () => {
    // The cross-workspace race: delete a file in A, switch to B (whose same
    // relative path has a live badge) within the buffer window. The buffered
    // unlink's finalize must NOT mark B's live file orphan.
    const wsB = await mkdtemp(join(tmpdir(), 'bh-watcher-wsB-'));
    try {
      // A has shared.md (annotated); B has its own shared.md (annotated, live).
      await writeFile(join(workspaceRoot, 'shared.md'), 'A');
      await core.run('workspace.use', { name: 'w' });
      await core.run('badge.set', { file: 'shared.md', patch: { description: 'A note' } });
      await core.run('workspace.add', { path: wsB, name: 'b' });
      await writeFile(join(wsB, 'shared.md'), 'B');
      await core.run('workspace.use', { name: 'b' });
      await core.run('badge.set', { file: 'shared.md', patch: { description: 'B note' } });

      // Watch A, delete A/shared.md, then immediately switch to B + watch it.
      await core.run('workspace.use', { name: 'w' });
      await core.run('watcher.start', {});
      await unlink(join(workspaceRoot, 'shared.md'));
      await core.run('workspace.use', { name: 'b' }); // current → B
      await core.run('watcher.start', {}); // flushes A's buffers under the B context

      // Give any straggler finalize time to (not) misfire, then assert B is clean.
      const bBadge = (await waitFor(
        () => core.run('badge.get', { file: 'shared.md' }),
        () => false, // never "done" — poll for the full window, return last value
        500,
      )) as BadgeFile | null;
      expect(bBadge?.orphan).toBeUndefined();
      expect(bBadge?.description).toBe('B note');
    } finally {
      await rm(wsB, { recursive: true, force: true });
    }
  });

  it('ignores .bh/ writes (would otherwise infinite-loop on our own badge writes)', async () => {
    await core.run('watcher.start', {});
    // Trigger a badge.set ourselves — chokidar should NOT re-fire since .bh
    // is in the ignored globs.
    await core.run('badge.set', { file: 'fake.md', patch: {} });
    await sleep(DEBOUNCE);
    // No infinite loop = success; sanity check that the badge exists once.
    const list = (await core.run('badge.list', {})) as { badges: BadgeFile[] };
    expect(list.badges.filter((b) => b.path === 'fake.md')).toHaveLength(1);
  });

  it('detects rename: unlink + add (same dir + ext within window) → badge.rename', async () => {
    // Pre-seed a file with a custom prompt + an outbound ref so we can
    // tell rename (preservation) from orphan+add (loss).
    await writeFile(join(workspaceRoot, 'old.md'), 'hello');
    await core.run('workspace.use', { name: 'w' });
    await core.run('badge.set', { file: 'old.md', patch: { description: 'load-bearing' } });
    await core.run('badge.addRef', { file: 'old.md', to: 'sibling.md' });
    // Also add an inbound ref so we can verify it gets rewritten.
    await core.run('badge.addRef', { file: 'sibling.md', to: 'old.md' });
    await core.run('watcher.start', {});
    // Perform an OS rename (chokidar fires unlink + add in quick succession).
    await rename(join(workspaceRoot, 'old.md'), join(workspaceRoot, 'new.md'));

    // Wait for the rename to FULLY finalize. badge.rename writes the new badge
    // FIRST, then rewrites referencing siblings — so the sibling's rewritten
    // outbound ref is the TERMINAL signal. Waiting on new.md's description alone
    // races the still-pending sibling rewrite (the gap widened once badge
    // edits started reconciling focus.md).
    const sibling = (await waitFor(
      () => core.run('badge.get', { file: 'sibling.md' }),
      (b) => (b as BadgeFile | null)?.references?.[0] === 'new.md',
    )) as BadgeFile;
    const newBadge = (await core.run('badge.get', { file: 'new.md' })) as BadgeFile | null;
    const oldBadge = await core.run('badge.get', { file: 'old.md' });
    expect(oldBadge).toBeNull();
    expect(newBadge?.description).toBe('load-bearing');
    expect(newBadge?.references).toEqual(['sibling.md']);
    expect(newBadge?.orphan).toBeUndefined();
    // sibling.md's outbound ref rewritten to point at the new name.
    expect(sibling.references).toEqual(['new.md']);
  });

  it('does NOT misfire as rename when extensions differ (orphan old, no badge for new)', async () => {
    await writeFile(join(workspaceRoot, 'doc.md'), 'hello');
    await core.run('workspace.use', { name: 'w' }); // ensure current
    await core.run('badge.set', { file: 'doc.md', patch: { description: 'keep me' } });
    await core.run('watcher.start', {});
    // Unlink doc.md; create doc.txt — different extension, NOT a rename.
    await unlink(join(workspaceRoot, 'doc.md'));
    await writeFile(join(workspaceRoot, 'doc.txt'), 'hello');
    // Old badge is orphaned (description preserved); the new file is brand-new → NO
    // badge (sparse). markOrphan is the terminal signal, so once it lands the
    // add's finalize has also run.
    const oldBadge = (await waitFor(
      () => core.run('badge.get', { file: 'doc.md' }),
      (b) => (b as BadgeFile | null)?.orphan === true,
    )) as BadgeFile;
    expect(oldBadge.orphan).toBe(true);
    expect(oldBadge.description).toBe('keep me'); // preserved on orphan
    expect(await core.run('badge.get', { file: 'doc.txt' })).toBeNull();
  });

  it('does NOT misfire as rename when parent dirs differ', async () => {
    await mkdir(join(workspaceRoot, 'a'), { recursive: true });
    await mkdir(join(workspaceRoot, 'b'), { recursive: true });
    await writeFile(join(workspaceRoot, 'a', 'x.md'), 'hi');
    await core.run('workspace.use', { name: 'w' });
    await core.run('badge.set', { file: 'a/x.md', patch: { description: 'A-bound' } });
    await core.run('watcher.start', {});
    await unlink(join(workspaceRoot, 'a', 'x.md'));
    await writeFile(join(workspaceRoot, 'b', 'x.md'), 'hi');
    // Different parent dir → orphan old + NO badge for the new file (not a rename).
    const oldBadge = (await waitFor(
      () => core.run('badge.get', { file: 'a/x.md' }),
      (b) => (b as BadgeFile | null)?.orphan === true,
    )) as BadgeFile;
    expect(oldBadge.orphan).toBe(true);
    expect(oldBadge.description).toBe('A-bound');
    expect(await core.run('badge.get', { file: 'b/x.md' })).toBeNull();
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
      await waitFor(
        async () => events.find((e) => e.type === 'rename'),
        (e) => e !== undefined,
      );
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

  it('preserves description + references when marking orphan', async () => {
    await core.run('badge.set', { file: 'a.md', patch: { description: 'p' } });
    await core.run('badge.addRef', { file: 'a.md', to: 'b.md' });
    const result = (await core.run('badge.markOrphan', { file: 'a.md' })) as BadgeFile;
    expect(result.orphan).toBe(true);
    expect(result.description).toBe('p');
    expect(result.references).toEqual(['b.md']);
  });
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrefsStore, sanitizePrefs } from '../src/platform/storage/electron-main/prefsStore.js';

// The full default shape — kept in one place so adding a pref is a one-line
// change here, not a sweep across every assertion.
const DEFAULTS = { autoUpdateCheck: true, autoDownloadUpdate: false };

describe('sanitizePrefs', () => {
  it('returns defaults for junk input', () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULTS);
    expect(sanitizePrefs(null)).toEqual(DEFAULTS);
    expect(sanitizePrefs('nope')).toEqual(DEFAULTS);
    expect(sanitizePrefs(42)).toEqual(DEFAULTS);
  });

  it('keeps known keys with correct types, drops the rest', () => {
    expect(sanitizePrefs({ autoUpdateCheck: false, extra: 'x' })).toEqual({
      ...DEFAULTS,
      autoUpdateCheck: false,
    });
    expect(sanitizePrefs({ autoDownloadUpdate: true })).toEqual({
      ...DEFAULTS,
      autoDownloadUpdate: true,
    });
    expect(sanitizePrefs({ autoUpdateCheck: false, autoDownloadUpdate: true })).toEqual({
      autoUpdateCheck: false,
      autoDownloadUpdate: true,
    });
  });

  it('falls back to the default on a wrong-typed value rather than leaking it', () => {
    expect(sanitizePrefs({ autoUpdateCheck: 'false' })).toEqual(DEFAULTS);
    expect(sanitizePrefs({ autoDownloadUpdate: 1 })).toEqual(DEFAULTS);
  });
});

describe('PrefsStore', () => {
  let dir: string;
  const stores: PrefsStore[] = [];
  const track = (s: PrefsStore): PrefsStore => {
    stores.push(s);
    return s;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bh-prefs-'));
  });
  afterEach(async () => {
    // Drain queued write-throughs before removing the dir, or a late write
    // recreates files under the rm (ENOTEMPTY).
    await Promise.all(stores.splice(0).map((s) => s.flush()));
    await rm(dir, { recursive: true, force: true });
  });

  it('starts from defaults when no file exists', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    expect(store.get()).toEqual(DEFAULTS);
  });

  it('set() merges, persists, and a fresh store reads it back', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    const merged = store.set({ autoUpdateCheck: false });
    expect(merged).toEqual({ ...DEFAULTS, autoUpdateCheck: false });
    await store.flush();

    const onDisk = JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8'));
    expect(onDisk).toEqual({ ...DEFAULTS, autoUpdateCheck: false });

    const reread = track(new PrefsStore(dir));
    await reread.load();
    expect(reread.get()).toEqual({ ...DEFAULTS, autoUpdateCheck: false });
  });

  it('merges one key at a time without clobbering the others', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    store.set({ autoDownloadUpdate: true });
    expect(store.get()).toEqual({ autoUpdateCheck: true, autoDownloadUpdate: true });
    store.set({ autoUpdateCheck: false });
    expect(store.get()).toEqual({ autoUpdateCheck: false, autoDownloadUpdate: true });
  });

  it('survives a corrupt file (falls back to defaults)', async () => {
    await writeFile(join(dir, 'prefs.json'), '{ not json', 'utf8');
    const store = track(new PrefsStore(dir));
    await store.load();
    expect(store.get()).toEqual(DEFAULTS);
  });

  it('ignores untrusted patch shapes', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    expect(store.set('garbage')).toEqual(DEFAULTS);
    expect(store.set({ autoUpdateCheck: 1 })).toEqual(DEFAULTS);
    expect(store.set(null)).toEqual(DEFAULTS);
  });

  it('serializes rapid writes — last value wins on disk', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    store.set({ autoUpdateCheck: false });
    store.set({ autoUpdateCheck: true });
    store.set({ autoUpdateCheck: false });
    await store.flush();
    const onDisk = JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8'));
    expect(onDisk).toEqual({ ...DEFAULTS, autoUpdateCheck: false });
  });
});

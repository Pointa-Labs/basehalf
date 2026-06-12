import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrefsStore, sanitizePrefs } from '../src/main/prefs.js';

describe('sanitizePrefs', () => {
  it('returns defaults for junk input', () => {
    expect(sanitizePrefs(undefined)).toEqual({ autoUpdateCheck: true });
    expect(sanitizePrefs(null)).toEqual({ autoUpdateCheck: true });
    expect(sanitizePrefs('nope')).toEqual({ autoUpdateCheck: true });
    expect(sanitizePrefs(42)).toEqual({ autoUpdateCheck: true });
  });

  it('keeps known keys with correct types, drops the rest', () => {
    expect(sanitizePrefs({ autoUpdateCheck: false, extra: 'x' })).toEqual({
      autoUpdateCheck: false,
    });
    // Wrong type falls back to the default rather than leaking through.
    expect(sanitizePrefs({ autoUpdateCheck: 'false' })).toEqual({ autoUpdateCheck: true });
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
    expect(store.get()).toEqual({ autoUpdateCheck: true });
  });

  it('set() merges, persists, and a fresh store reads it back', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    const merged = store.set({ autoUpdateCheck: false });
    expect(merged).toEqual({ autoUpdateCheck: false });
    await store.flush();

    const onDisk = JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8'));
    expect(onDisk).toEqual({ autoUpdateCheck: false });

    const reread = track(new PrefsStore(dir));
    await reread.load();
    expect(reread.get()).toEqual({ autoUpdateCheck: false });
  });

  it('survives a corrupt file (falls back to defaults)', async () => {
    await writeFile(join(dir, 'prefs.json'), '{ not json', 'utf8');
    const store = track(new PrefsStore(dir));
    await store.load();
    expect(store.get()).toEqual({ autoUpdateCheck: true });
  });

  it('ignores untrusted patch shapes', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    expect(store.set('garbage')).toEqual({ autoUpdateCheck: true });
    expect(store.set({ autoUpdateCheck: 1 })).toEqual({ autoUpdateCheck: true });
    expect(store.set(null)).toEqual({ autoUpdateCheck: true });
  });

  it('serializes rapid writes — last value wins on disk', async () => {
    const store = track(new PrefsStore(dir));
    await store.load();
    store.set({ autoUpdateCheck: false });
    store.set({ autoUpdateCheck: true });
    store.set({ autoUpdateCheck: false });
    await store.flush();
    const onDisk = JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8'));
    expect(onDisk).toEqual({ autoUpdateCheck: false });
  });
});

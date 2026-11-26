// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { InstallError } from '../src/errors.js';
import {
  MAX_ARCHIVE_BYTES,
  RELEASE_PUBLIC_KEY,
  readManifest,
  sanitizeManifest,
  verifyArchive,
  verifyManifest,
} from '../src/release.js';
import { makeFetch, makeKey, makeManifest } from './helpers.js';

/** The manifest of release 0.7.2, as its feed served it on 2026-11-26. */
async function releasedManifest() {
  return JSON.parse(
    await readFile(new URL('./fixtures/manifest-0.7.2.json', import.meta.url), 'utf8'),
  );
}

test('the manifest of a real release is accepted under the key the package holds', async () => {
  const manifest = sanitizeManifest(await releasedManifest());
  assert.ok(manifest);
  assert.deepEqual(
    {
      version: manifest.version,
      length: manifest.length,
      signed: verifyManifest(manifest, RELEASE_PUBLIC_KEY),
    },
    { version: '0.7.2', length: 159649222, signed: true },
  );
});

test('a real manifest with one field changed is not the one that was signed', async () => {
  const released = await releasedManifest();
  const changes = {
    version: '0.7.3',
    url: 'https://example.test/other.zip',
    length: released.length + 1,
    pubDate: '2026-11-26T00:00:00.000Z',
    notes: `${released.notes} `,
    signature: released.manifestSig,
  };
  const signed = Object.fromEntries(
    Object.entries(changes).map(([field, value]) => {
      const manifest = sanitizeManifest({ ...released, [field]: value });
      return [field, manifest ? verifyManifest(manifest, RELEASE_PUBLIC_KEY) : 'refused'];
    }),
  );
  assert.deepEqual(signed, {
    version: false,
    url: false,
    length: false,
    pubDate: false,
    notes: false,
    signature: false,
  });
});

test('a manifest with a field of a wrong shape is refused', () => {
  const key = makeKey();
  const good = makeManifest(key, Buffer.from('archive'));
  const wrong = {
    'not an object': 'manifest',
    'a version of two parts': { ...good, version: '1.2' },
    'an address that is not https': { ...good, url: 'http://example.test/a.zip' },
    'a file as the address': { ...good, url: 'file:///tmp/a.zip' },
    'a new line in the address': { ...good, url: 'https://example.test/a\n.zip' },
    'no length': { ...good, length: 0 },
    'a length that is not whole': { ...good, length: 1.5 },
    'a length above the limit': { ...good, length: MAX_ARCHIVE_BYTES + 1 },
    'a signature that is not base64': { ...good, signature: 'not base64!' },
    'a date of another form': { ...good, pubDate: '26 November 2026' },
    'no signature of the manifest': { ...good, manifestSig: undefined },
    'notes that are too long': { ...good, notes: 'n'.repeat(16_385) },
  };
  assert.deepEqual(
    {
      good: sanitizeManifest(good) !== undefined,
      wrong: Object.entries(wrong)
        .filter(([, raw]) => sanitizeManifest(raw) !== undefined)
        .map(([name]) => name),
    },
    { good: true, wrong: [] },
  );
});

test('an archive is accepted by its length and its signature', () => {
  const key = makeKey();
  const archive = Buffer.from('the bytes of an archive');
  const manifest = makeManifest(key, archive);
  const changed = Buffer.from(archive);
  changed[3] = (changed[3] ?? 0) ^ 1;
  assert.deepEqual(
    {
      same: verifyArchive(archive, manifest, key.publicKey),
      changedByte: verifyArchive(changed, manifest, key.publicKey),
      shorter: verifyArchive(archive.subarray(1), manifest, key.publicKey),
      anotherKey: verifyArchive(archive, manifest, makeKey().publicKey),
      noKey: verifyArchive(archive, manifest, 'not a key'),
    },
    { same: true, changedByte: false, shorter: false, anotherKey: false, noKey: false },
  );
});

test('reading the feed accepts a signed manifest and says why it accepts no other', async () => {
  const key = makeKey();
  const manifest = makeManifest(key, Buffer.from('archive'));
  const feedUrl = 'https://example.test/feed.json';
  /** @param {Parameters<typeof makeFetch>[0]} table */
  const read = async (table) => {
    try {
      const { fetch } = makeFetch(table);
      return (await readManifest({ fetch, feedUrl, publicKey: key.publicKey })).version;
    } catch (error) {
      assert.ok(error instanceof InstallError, String(error));
      return error.message;
    }
  };
  const refused =
    "The list of BaseHalf's releases was refused: it is not the one the releases are signed with. Nothing was installed.";
  assert.deepEqual(
    {
      signed: await read({ [feedUrl]: { body: manifest } }),
      relabelled: await read({ [feedUrl]: { body: { ...manifest, version: '9.9.9' } } }),
      wrongShape: await read({ [feedUrl]: { body: { ...manifest, length: -1 } } }),
      notJson: await read({ [feedUrl]: { body: new TextEncoder().encode('<html>') } }),
      missing: await read({ [feedUrl]: { status: 404, body: {} } }),
      noNetwork: await read({}),
    },
    {
      signed: '1.2.3',
      relabelled: refused,
      wrongShape: refused,
      notJson:
        "The list of BaseHalf's releases could not be read. Check the connection and run this again.",
      missing:
        "The list of BaseHalf's releases could not be read: the server answered 404. Run this again in a while.",
      noNetwork:
        "The list of BaseHalf's releases could not be read. Check the connection and run this again.",
    },
  );
});

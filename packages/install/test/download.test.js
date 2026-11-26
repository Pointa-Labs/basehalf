// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { downloadArchive } from '../src/download.js';
import { InstallError, Interrupted } from '../src/errors.js';
import { makeFetch, makeKey, makeManifest, scratch, stallingBody } from './helpers.js';

const archive = Buffer.from('the bytes of an archive, long enough to come in two parts');

/**
 * Downloads with a table of answers and resolves what the file holds, or
 * the words of the refusal.
 * @param {import('node:test').TestContext} t
 * @param {(manifest: import('../src/release.js').Manifest) => Parameters<typeof makeFetch>[0][string]} answer
 * @param {{ signal?: AbortSignal, stallMs?: number }} [options]
 */
async function download(t, answer, options = {}) {
  const key = makeKey();
  const manifest = makeManifest(key, archive);
  const file = join(await scratch(t), 'archive.zip');
  const { fetch } = makeFetch({ [manifest.url]: answer(manifest) });
  /** @type {number[]} */
  const progress = [];
  try {
    await downloadArchive({
      fetch,
      manifest,
      publicKey: key.publicKey,
      file,
      stallMs: options.stallMs ?? 5_000,
      onProgress: (received) => progress.push(received),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return { held: (await readFile(file)).toString(), last: progress.at(-1) };
  } catch (error) {
    if (error instanceof Interrupted) {
      return 'interrupted';
    }
    assert.ok(error instanceof InstallError, String(error));
    return error.message;
  }
}

const AGAIN = 'Nothing was installed. Run this again.';

test('an archive of the right length and signature is written whole', async (t) => {
  assert.deepEqual(await download(t, () => ({ body: archive })), {
    held: archive.toString(),
    last: archive.length,
  });
});

test('an archive that is not what the release signed is refused', async (t) => {
  const changed = Buffer.from(archive);
  changed[0] = (changed[0] ?? 0) ^ 1;
  assert.deepEqual(
    {
      changedByte: await download(t, () => ({ body: changed })),
      shorter: await download(t, () => ({ body: archive.subarray(0, 10) })),
      longer: await download(t, () => ({ body: Buffer.concat([archive, archive]) })),
      saysAnotherLength: await download(t, () => ({
        headers: { 'content-length': '7' },
        body: archive,
      })),
      notFound: await download(t, () => ({ status: 404, body: archive })),
    },
    {
      changedByte: `The download of BaseHalf 1.2.3 was refused: it is not what the release signed. ${AGAIN}`,
      shorter: `The download of BaseHalf 1.2.3 was refused: it is not what the release signed. ${AGAIN}`,
      longer: `The download of BaseHalf 1.2.3 was refused: it is longer than the release says. ${AGAIN}`,
      saysAnotherLength: `The download of BaseHalf 1.2.3 was refused: it is not as long as the release says. ${AGAIN}`,
      notFound: `BaseHalf 1.2.3 could not be downloaded: the server answered 404. ${AGAIN}`,
    },
  );
});

test('a download that stalls is given up, and an interrupt ends it without a word', async (t) => {
  const interrupted = new AbortController();
  const before = new AbortController();
  before.abort();
  const part = archive.subarray(0, 10);
  assert.deepEqual(
    {
      stalled: await download(t, () => ({ body: stallingBody([part]) }), { stallMs: 1_000 }),
      interrupted: await download(
        t,
        () => ({ body: stallingBody([part], () => interrupted.abort()) }),
        { signal: interrupted.signal },
      ),
      interruptedBefore: await download(t, () => ({ body: stallingBody([part]) }), {
        signal: before.signal,
      }),
    },
    {
      stalled: `The download of BaseHalf 1.2.3 stopped: no data came for 1 seconds. ${AGAIN}`,
      interrupted: 'interrupted',
      interruptedBefore: 'interrupted',
    },
  );
});

test('a download that cannot be written says where, not that the connection failed', async (t) => {
  const key = makeKey();
  const manifest = makeManifest(key, archive);
  const folder = await scratch(t);
  // A folder is where the file would be.
  await mkdir(join(folder, 'archive.zip'));
  const { fetch } = makeFetch({ [manifest.url]: { body: archive } });
  await assert.rejects(
    downloadArchive({
      fetch,
      manifest,
      publicKey: key.publicKey,
      file: join(folder, 'archive.zip'),
      stallMs: 5_000,
    }),
    new InstallError(
      `The download of BaseHalf 1.2.3 could not be written to ${folder} (EISDIR). Nothing was installed.`,
    ),
  );
});

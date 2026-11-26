// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { manifestSigningMessage } from '../src/release.js';

/**
 * A folder of the test's own, removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
export async function scratch(t) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'basehalf-install-test-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/**
 * Writes what the command takes for a BaseHalf: its product file and its
 * launcher. `whole: false` leaves the launcher out.
 * @param {string} place
 * @param {string} version
 * @param {{ whole?: boolean, name?: string, applicationName?: string }} [options]
 * @returns {Promise<string>} The bundle.
 */
export async function makeApplication(place, version, options = {}) {
  const bundle = join(place, options.name ?? 'BaseHalf.app');
  const resources = join(bundle, 'Contents', 'Resources', 'app');
  await mkdir(join(resources, 'bin'), { recursive: true });
  await writeFile(
    join(resources, 'product.json'),
    JSON.stringify({
      applicationName: options.applicationName ?? 'basehalf',
      basehalfVersion: version,
    }),
  );
  if (options.whole !== false) {
    await writeFile(join(resources, 'bin', 'basehalf'), '#!/bin/sh\n', { mode: 0o755 });
  }
  return bundle;
}

/** A key of the test's own, as the key of the releases is kept and used. */
export function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    /** @param {Uint8Array} bytes */
    sign: (bytes) => sign(null, bytes, privateKey).toString('base64'),
  };
}

/**
 * A manifest as a release makes it, for an archive of these bytes.
 * @param {ReturnType<typeof makeKey>} key
 * @param {Uint8Array} archive
 * @param {Partial<import('../src/release.js').Manifest>} [changed]
 * @returns {import('../src/release.js').Manifest}
 */
export function makeManifest(key, archive, changed = {}) {
  const fields = {
    version: '1.2.3',
    url: 'https://example.test/BaseHalf-1.2.3.zip',
    length: archive.length,
    signature: key.sign(archive),
    pubDate: '2026-11-26T10:00:00.000Z',
    notes: 'What is new.\nIn two lines.',
    ...changed,
  };
  return {
    ...fields,
    manifestSig: key.sign(Buffer.from(manifestSigningMessage({ ...fields, manifestSig: '' }))),
    ...('manifestSig' in changed ? { manifestSig: changed.manifestSig ?? '' } : {}),
  };
}

/**
 * A `fetch` that answers from a table of addresses and records what was
 * asked. A body given as a function is called with the signal of the
 * request and may return a stream that never ends.
 * @param {Record<string, { status?: number, headers?: Record<string, string>, body: unknown | ((signal: AbortSignal | undefined) => ReadableStream<Uint8Array>) }>} table
 */
export function makeFetch(table) {
  /** @type {string[]} */
  const asked = [];
  /** @type {typeof fetch} */
  const fetch = async (input, init) => {
    const url = String(input);
    asked.push(url);
    const answer = table[url];
    if (!answer) {
      throw new TypeError('fetch failed');
    }
    const signal = init?.signal ?? undefined;
    const body =
      typeof answer.body === 'function'
        ? answer.body(signal)
        : answer.body instanceof Uint8Array
          ? answer.body
          : JSON.stringify(answer.body);
    return new Response(body, { status: answer.status ?? 200, headers: answer.headers ?? {} });
  };
  return { fetch, asked };
}

/**
 * A body that gives its chunks and then stays open until the request is
 * given up, as a connection that stalls does. `onOpen` is called once the
 * body is open, so that a test interrupts a download that has begun.
 * @param {readonly Uint8Array[]} chunks
 * @param {() => void} [onOpen]
 * @returns {(signal: AbortSignal | undefined) => ReadableStream<Uint8Array>}
 */
export function stallingBody(chunks, onOpen) {
  return (signal) =>
    new ReadableStream({
      start(controller) {
        const giveUp = () =>
          controller.error(new DOMException('This operation was aborted', 'AbortError'));
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        if (signal?.aborted) {
          giveUp();
          return;
        }
        signal?.addEventListener('abort', giveUp);
        if (onOpen) {
          setTimeout(onOpen, 0);
        }
      },
    });
}

/**
 * Links an agent's entry to BaseHalf's own copy below `home`, and writes
 * the copy, as the application does when it installs its skill.
 * @param {string} home
 * @param {readonly string[]} segments
 * @param {string} [target] Where the link points, when not at the copy.
 */
export async function linkSkill(home, segments, target) {
  const copy = join(home, '.basehalf', 'agent-skill', 'basehalf');
  await mkdir(copy, { recursive: true });
  await writeFile(join(copy, 'SKILL.md'), '---\nname: basehalf\n---\n');
  const entry = join(home, ...segments);
  await mkdir(dirname(entry), { recursive: true });
  await symlink(target ?? copy, entry);
}

/**
 * The names in a folder, sorted, or `undefined` when it is gone.
 * @param {string} folder
 */
export async function names(folder) {
  try {
    return (await readdir(folder)).sort();
  } catch {
    return undefined;
  }
}

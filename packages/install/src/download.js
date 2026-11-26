// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { open, readFile } from 'node:fs/promises';
import { InstallError, Interrupted } from './errors.js';
import { verifyArchive } from './release.js';

/**
 * @typedef {import('./release.js').Manifest} Manifest
 */

const AGAIN = 'Nothing was installed. Run this again.';

/**
 * Downloads the archive of a release into `file` and checks the whole of
 * it: its length, and its signature under the key of the releases. A
 * download that says it has another length, that grows past its length, or
 * that brings no byte for `stallMs` is given up.
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {Manifest} options.manifest
 * @param {string} options.publicKey
 * @param {string} options.file
 * @param {number} options.stallMs
 * @param {(received: number, length: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>}
 */
export async function downloadArchive({
  fetch,
  manifest,
  publicKey,
  file,
  stallMs,
  onProgress,
  signal,
}) {
  const stalled = new AbortController();
  const stop = signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const rest = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stalled.abort(), stallMs);
  };
  const handle = await open(file, 'w');
  try {
    rest();
    const response = await fetch(manifest.url, { redirect: 'follow', signal: stop });
    if (!response.ok || !response.body) {
      throw new InstallError(
        `BaseHalf ${manifest.version} could not be downloaded: the server answered ${response.status}. ${AGAIN}`,
      );
    }
    const said = response.headers.get('content-length');
    if (said !== null && Number(said) !== manifest.length) {
      throw new InstallError(
        `The download of BaseHalf ${manifest.version} was refused: it is not as long as the release says. ${AGAIN}`,
      );
    }
    let received = 0;
    for await (const chunk of response.body) {
      rest();
      received += chunk.length;
      if (received > manifest.length) {
        throw new InstallError(
          `The download of BaseHalf ${manifest.version} was refused: it is longer than the release says. ${AGAIN}`,
        );
      }
      await handle.write(chunk);
      onProgress?.(received, manifest.length);
    }
  } catch (error) {
    if (error instanceof InstallError) {
      throw error;
    }
    if (signal?.aborted) {
      throw new Interrupted();
    }
    if (stalled.signal.aborted) {
      throw new InstallError(
        `The download of BaseHalf ${manifest.version} stopped: no data came for ${Math.round(stallMs / 1000)} seconds. ${AGAIN}`,
      );
    }
    throw new InstallError(
      `BaseHalf ${manifest.version} could not be downloaded. Check the connection and run this again.`,
    );
  } finally {
    clearTimeout(timer);
    await handle.close();
  }
  // The signature is over the whole file, so the whole file is read, as the
  // application reads an update.
  if (!verifyArchive(await readFile(file), manifest, publicKey)) {
    throw new InstallError(
      `The download of BaseHalf ${manifest.version} was refused: it is not what the release signed. ${AGAIN}`,
    );
  }
}

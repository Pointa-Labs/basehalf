// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { createPublicKey, verify } from 'node:crypto';
import { InstallError, Interrupted } from './errors.js';

/**
 * What the command accepts as a release is what an installed BaseHalf
 * accepts as an update (the install command, "Installing"): the same shape
 * of the manifest, the same message under its signature, the same key, and
 * the same limit on the archive. The application's half is
 * `src/vs/platform/update/node/basehalfUpdateProtocol.ts`.
 */

/** The address the application's own update reads. */
export const FEED_URL =
  'https://github.com/Pointa-Labs/basehalf/releases/latest/download/update-manifest-darwin-arm64.json';

/** The public key of the releases (Ed25519, SPKI, base64). */
export const RELEASE_PUBLIC_KEY = 'MCowBQYDK2VwAyEALH0EpJUvH3sQl4Lvw3wYTXYd3r6molfDeBnDvvgSH6U=';

/**
 * The release that was the latest when this package was made. An installed
 * BaseHalf takes no update that is older than itself; a computer without
 * BaseHalf has no version to compare with, so the package holds one.
 */
export const OLDEST_RELEASE = '0.7.2';

/** An installed BaseHalf refuses a larger archive, so no release has one. */
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

const MAX_NOTES_CHARS = 16_384;
const VERSION = /^\d+\.\d+\.\d+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** The message under the manifest's signature joins its fields with a new line, so no field may hold one. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
const HAS_CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

/**
 * @typedef {object} Manifest
 * @property {string} version
 * @property {string} url
 * @property {number} length The length of the archive, in bytes.
 * @property {string} signature Over the bytes of the archive.
 * @property {string} pubDate
 * @property {string} notes
 * @property {string} manifestSig Over the fields above.
 */

/**
 * The manifest in what was read from the feed, or `undefined` when a field
 * is missing or of another shape than the application requires.
 * @param {unknown} raw
 * @returns {Manifest | undefined}
 */
export function sanitizeManifest(raw) {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const { version, url, length, signature, pubDate, manifestSig, notes } =
    /** @type {Record<string, unknown>} */ (raw);
  if (typeof version !== 'string' || !VERSION.test(version)) {
    return undefined;
  }
  if (typeof url !== 'string' || !url.startsWith('https://') || HAS_CONTROL_CHARACTER.test(url)) {
    return undefined;
  }
  if (
    typeof length !== 'number' ||
    !Number.isInteger(length) ||
    length <= 0 ||
    length > MAX_ARCHIVE_BYTES
  ) {
    return undefined;
  }
  if (typeof signature !== 'string' || !BASE64.test(signature)) {
    return undefined;
  }
  if (typeof pubDate !== 'string' || !ISO_UTC.test(pubDate)) {
    return undefined;
  }
  if (typeof manifestSig !== 'string' || !BASE64.test(manifestSig)) {
    return undefined;
  }
  const text = typeof notes === 'string' ? notes : '';
  if (text.length > MAX_NOTES_CHARS) {
    return undefined;
  }
  return { version, url, length, signature, pubDate, notes: text, manifestSig };
}

/**
 * The exact message the manifest's signature is over. It is the one the
 * release signs and the one every installed BaseHalf checks.
 * @param {Manifest} manifest
 * @returns {string}
 */
export function manifestSigningMessage(manifest) {
  const notes = Buffer.from(manifest.notes, 'utf8').toString('base64');
  return [
    manifest.version,
    manifest.url,
    String(manifest.length),
    manifest.pubDate,
    manifest.signature,
    notes,
  ].join('\n');
}

/**
 * @param {Uint8Array} message
 * @param {string} signature
 * @param {string} publicKey
 * @returns {boolean}
 */
function verifyEd25519(message, signature, publicKey) {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(null, message, key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Whether the fields of the manifest are the ones a release signed.
 * @param {Manifest} manifest
 * @param {string} publicKey
 * @returns {boolean}
 */
export function verifyManifest(manifest, publicKey) {
  return verifyEd25519(
    Buffer.from(manifestSigningMessage(manifest), 'utf8'),
    manifest.manifestSig,
    publicKey,
  );
}

/**
 * Whether the bytes are the archive the manifest names.
 * @param {Uint8Array} bytes
 * @param {Manifest} manifest
 * @param {string} publicKey
 * @returns {boolean}
 */
export function verifyArchive(bytes, manifest, publicKey) {
  return bytes.length === manifest.length && verifyEd25519(bytes, manifest.signature, publicKey);
}

/**
 * Whether a version is older than another, part by part.
 * @param {string} version
 * @param {string} other
 */
function isOlder(version, other) {
  const [a, b] = [version, other].map((v) => v.split('.').map(Number));
  for (let index = 0; index < 3; index++) {
    const difference = (a?.[index] ?? 0) - (b?.[index] ?? 0);
    if (difference !== 0) {
      return difference < 0;
    }
  }
  return false;
}

/**
 * Reads the manifest of the latest release and accepts it only as the
 * application does, and no release older than `oldest`.
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {string} options.feedUrl
 * @param {string} options.publicKey
 * @param {number} options.timeoutMs How long the feed may take to answer.
 * @param {string} [options.oldest]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Manifest>}
 */
export async function readManifest({
  fetch,
  feedUrl,
  publicKey,
  timeoutMs,
  oldest = OLDEST_RELEASE,
  signal,
}) {
  /** @type {unknown} */
  let raw;
  // A timer of the run's own: it keeps the command alive until the answer
  // or the time, whichever is first.
  const late = new AbortController();
  const timer = setTimeout(() => late.abort(), timeoutMs);
  try {
    const response = await fetch(feedUrl, {
      redirect: 'follow',
      signal: signal ? AbortSignal.any([signal, late.signal]) : late.signal,
    });
    if (!response.ok) {
      throw new InstallError(
        `The list of BaseHalf's releases could not be read: the server answered ${response.status}. Run this again in a while.`,
      );
    }
    raw = await response.json();
  } catch (error) {
    if (error instanceof InstallError) {
      throw error;
    }
    if (signal?.aborted) {
      throw new Interrupted();
    }
    throw new InstallError(
      "The list of BaseHalf's releases could not be read. Check the connection and run this again.",
    );
  } finally {
    clearTimeout(timer);
  }
  const manifest = sanitizeManifest(raw);
  if (!manifest || !verifyManifest(manifest, publicKey)) {
    throw new InstallError(
      "The list of BaseHalf's releases was refused: it is not the one the releases are signed with. Nothing was installed.",
    );
  }
  if (isOlder(manifest.version, oldest)) {
    throw new InstallError(
      `The list of BaseHalf's releases was refused: it names BaseHalf ${manifest.version}, which is older than ${oldest}. Nothing was installed.`,
    );
  }
  return manifest;
}

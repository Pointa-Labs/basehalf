/**
 * The pure half of self-update — manifest validation, version ordering,
 * signature verification, bundle-path derivation. No electron imports, so
 * tests exercise it directly; updater.ts owns the side-effecting flow
 * (fetch/download/extract/swap/relaunch) on top of these.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { basename, dirname } from 'node:path';

/** Ed25519 public key (SPKI, base64). The private half lives only on the
 *  release machine (see scripts/sign-update.mjs); rotating the pair means
 *  shipping one release signed by the old key that embeds the new one. */
export const UPDATE_PUBKEY_B64 = 'MCowBQYDK2VwAyEALH0EpJUvH3sQl4Lvw3wYTXYd3r6molfDeBnDvvgSH6U=';

/** Hard cap on the update archive — a corrupt/malicious manifest can't make
 *  us spool an unbounded body to disk. Current zips are ~110 MB. */
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

export interface UpdateManifest {
  readonly version: string;
  readonly url: string;
  readonly length: number;
  readonly signature: string;
}

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate'; version: string }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; received: number; total: number }
  | { phase: 'staged'; version: string }
  | { phase: 'error'; message: string };

/** Strict `major.minor.patch` (the only shape our releases use). Returns null
 *  rather than guessing at anything fancier — an unparseable version in the
 *  feed must fail closed, not compare loosely. */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** <0 a older, 0 equal, >0 a newer. Null for unparseable input. */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] as number) - (pb[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}

/** Validate an untrusted feed body into a manifest, or null. The url is
 *  pinned to https (no file:/smb:/… retrieval) and the length bounded.
 *  `allowLocalUrl` (set only when the feed itself came from the local test
 *  override) additionally admits an absolute archive path, so an end-to-end
 *  test can run the full verify→extract→swap chain serverless; signature
 *  verification still gates whatever the bytes are. */
export function sanitizeManifest(
  raw: unknown,
  opts?: { allowLocalUrl?: boolean },
): UpdateManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || parseSemver(r.version) === null) return null;
  if (typeof r.url !== 'string') return null;
  const urlOk =
    r.url.startsWith('https://') || (opts?.allowLocalUrl === true && r.url.startsWith('/'));
  if (!urlOk) return null;
  if (typeof r.length !== 'number' || !Number.isInteger(r.length)) return null;
  if (r.length <= 0 || r.length > MAX_ARCHIVE_BYTES) return null;
  if (typeof r.signature !== 'string' || r.signature.length === 0) return null;
  return { version: r.version, url: r.url, length: r.length, signature: r.signature };
}

/** Ed25519-verify `bytes` against the baked-in public key. */
export function verifyArchiveSignature(bytes: Buffer, signatureB64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(UPDATE_PUBKEY_B64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(null, bytes, key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** `/Apps/X.app/Contents/MacOS/X` → `/Apps/X.app`; null when the executable
 *  isn't inside a bundle (dev runs the build output directly). */
export function bundlePathFromExec(execPath: string): string | null {
  const macosDir = dirname(execPath);
  const contentsDir = dirname(macosDir);
  const bundle = dirname(contentsDir);
  if (basename(macosDir) !== 'MacOS') return null;
  if (basename(contentsDir) !== 'Contents') return null;
  if (!bundle.endsWith('.app')) return null;
  return bundle;
}

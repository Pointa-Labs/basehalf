/**
 * The pure half of self-update — manifest validation, version ordering,
 * signature verification, bundle-path derivation. No electron imports, so
 * tests exercise it directly; updater.ts owns the side-effecting flow
 * (fetch/download/extract/swap/relaunch) on top of these.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { basename, dirname } from 'node:path';
import type { JustInstalled, UpdateState } from '../common/update.js';

export type { JustInstalled, UpdateState };

/** Ed25519 public key (SPKI, base64). The private half lives only on the
 *  release machine (see scripts/sign-update.mjs); rotating the pair means
 *  shipping one release signed by the old key that embeds the new one. */
export const UPDATE_PUBKEY_B64 = 'MCowBQYDK2VwAyEALH0EpJUvH3sQl4Lvw3wYTXYd3r6molfDeBnDvvgSH6U=';

/** Hard cap on the update archive — a corrupt/malicious manifest can't make
 *  us spool an unbounded body to disk. Current zips are ~110 MB. */
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

/** Standard base64 (what `.toString('base64')` emits). Used to keep signatures
 *  charset-clean so they can't smuggle a separator into the signed message. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Strict ISO-8601 UTC, exactly what `Date.toISOString()` produces. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** Any C0 control char (incl. the '\n' the signed message uses as its field
 *  separator) or DEL — disallowed in url so a field can't smuggle a separator
 *  and make the canonical signing message ambiguous. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately rejecting control chars in untrusted feed input
const HAS_CONTROL_CHAR = /[\x00-\x1f\x7f]/;

/** Cap on the "what's new" notes — short by nature; a forged longer one fails
 *  manifestSig anyway, this just keeps a malformed feed bounded. */
const MAX_NOTES_CHARS = 16_384;

export interface UpdateManifest {
  readonly version: string;
  readonly url: string;
  readonly length: number;
  /** Ed25519 signature over the archive BYTES — gates what gets installed. */
  readonly signature: string;
  /** ISO-8601 publish time; authenticated by `manifestSig`. */
  readonly pubDate: string;
  /** Optional human "what's new" text, shown once after a self-update. May be
   *  multi-line; authenticated via its base64 in the signing message, so it
   *  doesn't need to be newline-free like the other fields. Defaults to ''. */
  readonly notes: string;
  /** Ed25519 signature over the manifest METADATA (see manifestSigningMessage).
   *  Without it version/url/length/pubDate/notes would be unauthenticated, so a
   *  feed attacker could relabel an old, validly-signed archive as a newer
   *  version (or spoof the "what's new" text) and mislead/downgrade the user. */
  readonly manifestSig: string;
}

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

/** Whether a background update check should actually fire — the cadence POLICY,
 *  kept pure so it's testable without electron's `app`/timers (the wiring lives
 *  in updater.ts's startBackgroundUpdateChecks). The periodic tick always runs
 *  when checks are enabled; a focus-triggered tick coalesces with a recent check
 *  (periodic or a prior focus) so app-switching can't turn into a feed flood. */
export function shouldRunBackgroundCheck(opts: {
  reason: 'interval' | 'focus';
  enabled: boolean;
  now: number;
  lastCheckAt: number;
  focusGapMs: number;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.reason === 'focus' && opts.now - opts.lastCheckAt < opts.focusGapMs) return false;
  return true;
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
  // Every field below is constrained so NONE can contain a newline — that keeps
  // the '\n'-joined signing message injective (no two manifests can collide on
  // one signed string). version is already regex-bound and length is an integer.
  if (!urlOk || HAS_CONTROL_CHAR.test(r.url)) return null;
  if (typeof r.length !== 'number' || !Number.isInteger(r.length)) return null;
  if (r.length <= 0 || r.length > MAX_ARCHIVE_BYTES) return null;
  if (typeof r.signature !== 'string' || !BASE64.test(r.signature)) return null;
  if (typeof r.pubDate !== 'string' || !ISO_UTC.test(r.pubDate)) return null;
  if (typeof r.manifestSig !== 'string' || !BASE64.test(r.manifestSig)) return null;
  // notes is optional display text (may be multi-line). It rides the signing
  // message as base64, so it can't break the injective format; just bound it.
  const notes = typeof r.notes === 'string' ? r.notes : '';
  if (notes.length > MAX_NOTES_CHARS) return null;
  return {
    version: r.version,
    url: r.url,
    length: r.length,
    signature: r.signature,
    pubDate: r.pubDate,
    notes,
    manifestSig: r.manifestSig,
  };
}

/** The exact message the manifest signature covers: the metadata fields plus the
 *  archive signature, so version/url/length/pubDate/notes are bound to one
 *  specific signed archive. notes rides as base64 (so multi-line text can't add
 *  a separator and the join stays injective). MUST stay byte-identical to the
 *  string built in scripts/sign-update.mjs — pinned by a test in updater.test.ts. */
export function manifestSigningMessage(m: {
  version: string;
  url: string;
  length: number;
  pubDate: string;
  signature: string;
  notes: string;
}): string {
  const notesB64 = Buffer.from(m.notes, 'utf8').toString('base64');
  return [m.version, m.url, String(m.length), m.pubDate, m.signature, notesB64].join('\n');
}

/** Ed25519-verify `message` against a public key (the baked-in one by default;
 *  the parameter exists so tests can verify against a generated key). */
function verifyEd25519(message: Buffer, signatureB64: string, pubKeyB64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(pubKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(null, message, key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** Ed25519-verify the archive `bytes` against the signing key. */
export function verifyArchiveSignature(
  bytes: Buffer,
  signatureB64: string,
  pubKeyB64: string = UPDATE_PUBKEY_B64,
): boolean {
  return verifyEd25519(bytes, signatureB64, pubKeyB64);
}

/** Ed25519-verify the manifest METADATA — call before trusting ANY field in a
 *  fetched manifest (including its version), so a forged feed can't relabel an
 *  old signed archive as a newer release. */
export function verifyManifestSignature(
  m: UpdateManifest,
  pubKeyB64: string = UPDATE_PUBKEY_B64,
): boolean {
  return verifyEd25519(Buffer.from(manifestSigningMessage(m), 'utf8'), m.manifestSig, pubKeyB64);
}

/** Parse the install-time "what's new" record the previous version wrote. Returns
 *  it only when its version matches the running build (so a DMG install or a
 *  stale record never triggers the panel) and the notes are non-empty. Pure —
 *  updater.ts owns the file read + one-shot delete. */
export function parseJustInstalled(raw: string, expectedVersion: string): JustInstalled | null {
  try {
    const rec = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof rec.version === 'string' &&
      typeof rec.notes === 'string' &&
      rec.version === expectedVersion &&
      rec.notes.length > 0
    ) {
      return { version: rec.version, notes: rec.notes };
    }
  } catch {
    /* malformed record */
  }
  return null;
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

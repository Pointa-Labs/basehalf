/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { basename, dirname } from '../../../base/common/path.js';

/**
 * The pure half of BaseHalf self-update: manifest validation, version
 * ordering, Ed25519 signature verification and bundle-path derivation. The
 * app is distributed without a platform signing identity, so release
 * integrity comes from this signature chain instead: the release pipeline
 * (build/basehalf/sign-update.mjs) signs each archive AND the manifest
 * metadata with the project's private key, and nothing gets installed unless
 * both verify against the public key baked in below.
 *
 * The manifest format is shared with previously shipped BaseHalf releases —
 * their updaters poll the same feed — so field semantics and the canonical
 * signing message MUST NOT change shape.
 */

/** Ed25519 public key (SPKI, base64). The private half lives only on the
 *  release machine (see build/basehalf/sign-update.mjs); rotating the pair
 *  means shipping one release signed by the old key that embeds the new one. */
export const BASEHALF_UPDATE_PUBKEY_B64 = 'MCowBQYDK2VwAyEALH0EpJUvH3sQl4Lvw3wYTXYd3r6molfDeBnDvvgSH6U=';

/** Hard cap on the update archive — a corrupt/malicious manifest can't make
 *  us spool an unbounded body to disk. */
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

/** Standard base64 (what `.toString('base64')` emits). Used to keep signatures
 *  charset-clean so they can't smuggle a separator into the signed message. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Strict ISO-8601 UTC, exactly what `Date.toISOString()` produces. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** Any C0 control char (incl. the '\n' the signed message uses as its field
 *  separator) or DEL — disallowed in url so a field can't smuggle a separator
 *  and make the canonical signing message ambiguous. */
const HAS_CONTROL_CHAR = /[\x00-\x1f\x7f]/;

/** Cap on the "what's new" notes — short by nature; a forged longer one fails
 *  manifestSig anyway, this just keeps a malformed feed bounded. */
const MAX_NOTES_CHARS = 16_384;

export interface IBaseHalfUpdateManifest {
	readonly version: string;
	readonly url: string;
	readonly length: number;
	/** Ed25519 signature over the archive BYTES — gates what gets installed. */
	readonly signature: string;
	/** ISO-8601 publish time; authenticated by `manifestSig`. */
	readonly pubDate: string;
	/** Optional human "what's new" text. Authenticated via its base64 in the
	 *  signing message; kept for feed compatibility with older releases. */
	readonly notes: string;
	/** Ed25519 signature over the manifest METADATA (see
	 *  basehalfManifestSigningMessage). Without it version/url/length/pubDate/
	 *  notes would be unauthenticated, so a feed attacker could relabel an old,
	 *  validly-signed archive as a newer version and downgrade the user. */
	readonly manifestSig: string;
}

/** Strict `major.minor.patch` (the only shape BaseHalf releases use). Returns
 *  null rather than guessing at anything fancier — an unparseable version in
 *  the feed must fail closed, not compare loosely. */
export function parseBaseHalfVersion(v: string): [number, number, number] | null {
	const m = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/.exec(v.trim());
	if (!m?.groups) {
		return null;
	}
	return [Number(m.groups.major), Number(m.groups.minor), Number(m.groups.patch)];
}

/** <0 a older, 0 equal, >0 a newer. Null for unparseable input. */
export function compareBaseHalfVersions(a: string, b: string): number | null {
	const pa = parseBaseHalfVersion(a);
	const pb = parseBaseHalfVersion(b);
	if (!pa || !pb) {
		return null;
	}
	for (let i = 0; i < 3; i++) {
		const d = pa[i] - pb[i];
		if (d !== 0) {
			return d;
		}
	}
	return 0;
}

/** Validate an untrusted feed body into a manifest, or null. The url is
 *  pinned to https (no file:/smb:/… retrieval) and the length bounded.
 *  `allowLocalUrl` (set only when the feed itself came from the local test
 *  override) additionally admits an absolute archive path, so an end-to-end
 *  test can run the full verify→extract→swap chain serverless; signature
 *  verification still gates whatever the bytes are. */
export function sanitizeBaseHalfUpdateManifest(raw: unknown, opts?: { allowLocalUrl?: boolean }): IBaseHalfUpdateManifest | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const r = raw as Record<string, unknown>;
	if (typeof r.version !== 'string' || parseBaseHalfVersion(r.version) === null) {
		return null;
	}
	if (typeof r.url !== 'string') {
		return null;
	}
	const urlOk = r.url.startsWith('https://') || (opts?.allowLocalUrl === true && r.url.startsWith('/'));
	// Every field below is constrained so NONE can contain a newline — that keeps
	// the '\n'-joined signing message injective (no two manifests can collide on
	// one signed string). version is already regex-bound and length is an integer.
	if (!urlOk || HAS_CONTROL_CHAR.test(r.url)) {
		return null;
	}
	if (typeof r.length !== 'number' || !Number.isInteger(r.length)) {
		return null;
	}
	if (r.length <= 0 || r.length > MAX_ARCHIVE_BYTES) {
		return null;
	}
	if (typeof r.signature !== 'string' || !BASE64.test(r.signature)) {
		return null;
	}
	if (typeof r.pubDate !== 'string' || !ISO_UTC.test(r.pubDate)) {
		return null;
	}
	if (typeof r.manifestSig !== 'string' || !BASE64.test(r.manifestSig)) {
		return null;
	}
	// notes is optional display text (may be multi-line). It rides the signing
	// message as base64, so it can't break the injective format; just bound it.
	const notes = typeof r.notes === 'string' ? r.notes : '';
	if (notes.length > MAX_NOTES_CHARS) {
		return null;
	}
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

/** The exact message the manifest signature covers: the metadata fields plus
 *  the archive signature, so version/url/length/pubDate/notes are bound to one
 *  specific signed archive. notes rides as base64 (so multi-line text can't
 *  add a separator and the join stays injective). MUST stay byte-identical to
 *  the string built in build/basehalf/sign-update.mjs AND to what already
 *  shipped BaseHalf releases verify — pinned by a unit test. */
export function basehalfManifestSigningMessage(m: { version: string; url: string; length: number; pubDate: string; signature: string; notes: string }): string {
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
export function verifyBaseHalfArchiveSignature(bytes: Buffer, signatureB64: string, pubKeyB64: string = BASEHALF_UPDATE_PUBKEY_B64): boolean {
	return verifyEd25519(bytes, signatureB64, pubKeyB64);
}

/** Ed25519-verify the manifest METADATA — call before trusting ANY field in a
 *  fetched manifest (including its version), so a forged feed can't relabel an
 *  old signed archive as a newer release. */
export function verifyBaseHalfManifestSignature(m: IBaseHalfUpdateManifest, pubKeyB64: string = BASEHALF_UPDATE_PUBKEY_B64): boolean {
	return verifyEd25519(Buffer.from(basehalfManifestSigningMessage(m), 'utf8'), m.manifestSig, pubKeyB64);
}

/** `/Apps/X.app/Contents/MacOS/X` → `/Apps/X.app`; null when the executable
 *  isn't inside a bundle (dev runs execute the build output directly). */
export function bundlePathFromExec(execPath: string): string | null {
	const macosDir = dirname(execPath);
	const contentsDir = dirname(macosDir);
	const bundle = dirname(contentsDir);
	if (basename(macosDir) !== 'MacOS') {
		return null;
	}
	if (basename(contentsDir) !== 'Contents') {
		return null;
	}
	if (!bundle.endsWith('.app')) {
		return null;
	}
	return bundle;
}

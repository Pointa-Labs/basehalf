/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync } from 'child_process';
import { createPrivateKey, generateKeyPairSync, sign, KeyObject } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { FileAccess } from '../../../../base/common/network.js';
import { dirname, join } from '../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { basehalfManifestSigningMessage, bundlePathFromExec, compareBaseHalfVersions, parseBaseHalfVersion, sanitizeBaseHalfUpdateManifest, verifyBaseHalfArchiveSignature, verifyBaseHalfManifestSignature } from '../../node/basehalfUpdateProtocol.js';

/** A keypair as the protocol consumes it: the public half SPKI-DER-base64
 *  (the shape verify* expects), ready to sign test messages with the private. */
function testKeypair(): { pubB64: string; privateKey: KeyObject } {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	return {
		pubB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
		privateKey: createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })),
	};
}

suite('basehalfUpdateProtocol - version parsing', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses strict x.y.z only', () => {
		assert.deepStrictEqual(
			[parseBaseHalfVersion('0.1.0'), parseBaseHalfVersion('12.34.56'), parseBaseHalfVersion('1.2'), parseBaseHalfVersion('1.2.3-beta'), parseBaseHalfVersion('v1.2.3'), parseBaseHalfVersion('')],
			[[0, 1, 0], [12, 34, 56], null, null, null, null]
		);
	});

	test('orders correctly and fails closed on junk', () => {
		assert.ok(compareBaseHalfVersions('0.2.0', '0.1.9')! > 0);
		assert.strictEqual(compareBaseHalfVersions('0.1.0', '0.1.0'), 0);
		assert.ok(compareBaseHalfVersions('0.1.0', '1.0.0')! < 0);
		assert.ok(compareBaseHalfVersions('0.10.0', '0.9.9')! > 0);
		assert.strictEqual(compareBaseHalfVersions('abc', '0.1.0'), null);
	});
});

suite('basehalfUpdateProtocol - sanitizeBaseHalfUpdateManifest', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const good = {
		version: '0.2.0',
		url: 'https://github.com/Pointa-Labs/basehalf/releases/download/v0.2.0/x.zip',
		length: 1234,
		signature: 'c2ln',
		pubDate: '2026-01-01T00:00:00.000Z',
		notes: 'First release.',
		manifestSig: 'bXNpZw==',
	};

	test('accepts a well-formed manifest (extra keys dropped)', () => {
		assert.deepStrictEqual(sanitizeBaseHalfUpdateManifest({ ...good, extra: 1 }), good);
	});

	test('treats notes as optional, multi-line display text, capped', () => {
		const { notes, ...noNotes } = good;
		assert.ok(notes);
		assert.strictEqual(sanitizeBaseHalfUpdateManifest(noNotes)?.notes, ''); // optional → defaults to ''
		assert.strictEqual(sanitizeBaseHalfUpdateManifest({ ...good, notes: 'line1\nline2' })?.notes, 'line1\nline2');
		assert.strictEqual(sanitizeBaseHalfUpdateManifest({ ...good, notes: 'x'.repeat(20000) }), null); // over cap
	});

	test('rejects malformed shapes', () => {
		for (const bad of [
			null,
			'x',
			{ ...good, version: '0.2' },
			{ ...good, url: 'http://github.com/x.zip' },
			{ ...good, url: 'file:///etc/passwd' },
			{ ...good, length: 0 },
			{ ...good, length: 1.5 },
			{ ...good, length: 600 * 1024 * 1024 },
			{ ...good, signature: '' },
		]) {
			assert.strictEqual(sanitizeBaseHalfUpdateManifest(bad), null, JSON.stringify(bad)?.slice(0, 80));
		}
	});

	test('requires the authenticated metadata fields', () => {
		const { pubDate, manifestSig, ...noAuth } = good;
		assert.ok(pubDate && manifestSig);
		for (const bad of [
			noAuth, // no pubDate / manifestSig
			{ ...good, pubDate: '' },
			{ ...good, manifestSig: '' },
			{ ...good, pubDate: 5 },
			{ ...good, manifestSig: 5 },
		]) {
			assert.strictEqual(sanitizeBaseHalfUpdateManifest(bad), null);
		}
	});

	test('rejects fields that could make the signed message ambiguous', () => {
		// Keep every signed field newline-free so the '\n'-joined message is
		// injective (no two manifests share a signed string → no signature reuse).
		for (const bad of [
			{ ...good, url: 'https://x/y\n9.9.9' },
			{ ...good, pubDate: '2026-01-01T00:00:00.000Z\nx' },
			{ ...good, pubDate: 'not-a-date' },
			{ ...good, signature: 'not base64!!' },
			{ ...good, manifestSig: 'has\nnewline' },
		]) {
			assert.strictEqual(sanitizeBaseHalfUpdateManifest(bad), null);
		}
	});

	test('admits an absolute archive path only with allowLocalUrl', () => {
		const local = { ...good, url: '/tmp/somewhere/x.zip' };
		assert.strictEqual(sanitizeBaseHalfUpdateManifest(local), null);
		assert.strictEqual(sanitizeBaseHalfUpdateManifest(local, { allowLocalUrl: true })?.url, '/tmp/somewhere/x.zip');
	});
});

suite('basehalfUpdateProtocol - signatures', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('verifies archive bytes against the matching key, rejects everything else', () => {
		const { pubB64, privateKey } = testKeypair();
		const bytes = Buffer.from('payload');
		const sig = sign(null, bytes, privateKey).toString('base64');
		assert.strictEqual(verifyBaseHalfArchiveSignature(bytes, sig, pubB64), true);
		assert.strictEqual(verifyBaseHalfArchiveSignature(Buffer.from('tampered'), sig, pubB64), false);
		// A fresh keypair's signature must NOT verify against the baked-in key.
		assert.strictEqual(verifyBaseHalfArchiveSignature(bytes, sig), false);
		// Garbage signatures do not throw.
		assert.strictEqual(verifyBaseHalfArchiveSignature(Buffer.from('x'), 'not base64!!'), false);
		assert.strictEqual(verifyBaseHalfArchiveSignature(Buffer.from('x'), ''), false);
	});

	test('signing message is the exact canonical string sign-update.mjs must reproduce', () => {
		// Pinned: this format is replicated in build/basehalf/sign-update.mjs
		// AND already baked into shipped BaseHalf releases. If it changes here,
		// every existing install fails verification.
		assert.strictEqual(
			basehalfManifestSigningMessage({
				version: '0.2.0',
				url: 'https://x/y.zip',
				length: 1234,
				pubDate: '2026-01-01T00:00:00.000Z',
				signature: 'c2ln',
				notes: 'Hello',
			}),
			'0.2.0\nhttps://x/y.zip\n1234\n2026-01-01T00:00:00.000Z\nc2ln\nSGVsbG8='
		);
	});

	const base = {
		version: '0.2.0',
		url: 'https://github.com/Pointa-Labs/basehalf/releases/download/v0.2.0/x.zip',
		length: 1234,
		pubDate: '2026-01-01T00:00:00.000Z',
		signature: 'c2ln',
		notes: 'Some notes.',
	};

	function signManifest(m: typeof base, priv: KeyObject): string {
		return sign(null, Buffer.from(basehalfManifestSigningMessage(m), 'utf8'), priv).toString('base64');
	}

	test('accepts a manifest signed over its own metadata', () => {
		const { pubB64, privateKey } = testKeypair();
		const m = { ...base, manifestSig: signManifest(base, privateKey) };
		assert.strictEqual(verifyBaseHalfManifestSignature(m, pubB64), true);
	});

	test('rejects any tampered field (version/url/length/pubDate/signature/notes)', () => {
		const { pubB64, privateKey } = testKeypair();
		const manifestSig = signManifest(base, privateKey);
		for (const patch of [
			{ version: '0.3.0' },
			{ url: 'https://evil.example/x.zip' },
			{ length: 9999 },
			{ pubDate: '2030-01-01T00:00:00.000Z' },
			{ signature: 'b3RoZXI=' },
			{ notes: 'spoofed changelog' },
		]) {
			assert.strictEqual(verifyBaseHalfManifestSignature({ ...base, ...patch, manifestSig }, pubB64), false, JSON.stringify(patch));
		}
	});

	test('blocks the relabel-downgrade attack: old signed archive, forged newer version', () => {
		// Attacker signs (legitimately, long ago) v0.1.0, then serves the same
		// archive relabelled as v9.9.9. The metadata signature is bound to the
		// original tuple, so the forged manifest fails verification.
		const { pubB64, privateKey } = testKeypair();
		const real = { ...base, version: '0.1.0' };
		const manifestSig = signManifest(real, privateKey);
		assert.strictEqual(verifyBaseHalfManifestSignature({ ...real, version: '9.9.9', manifestSig }, pubB64), false);
	});

	test('rejects a manifest signed by a different key, and garbage', () => {
		const { privateKey } = testKeypair(); // not the baked-in key
		const m = { ...base, manifestSig: signManifest(base, privateKey) };
		assert.strictEqual(verifyBaseHalfManifestSignature(m), false); // baked-in pubkey
		assert.strictEqual(verifyBaseHalfManifestSignature({ ...base, manifestSig: 'not base64!!' }), false);
	});
});

suite('basehalfUpdateProtocol - sign-update.mjs cross-check', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// The signer (plain JS release script) and verifier (this TS protocol)
	// can't share code, so prove the real signer's manifestSig + archive
	// signature verify against the protocol — this catches any drift in the
	// canonical signing format between the two.
	test('produces a manifest the verifier accepts', function () {
		const outRoot = dirname(FileAccess.asFileUri('vs/platform/update/node/basehalfUpdateProtocol.js').fsPath);
		const script = join(outRoot, '../../../../..', 'build', 'basehalf', 'sign-update.mjs');
		assert.ok(existsSync(script), `signer script not found at ${script}`);

		const dir = mkdtempSync(join(tmpdir(), 'bh-sign-'));
		try {
			const { publicKey, privateKey } = generateKeyPairSync('ed25519');
			const keyPath = join(dir, 'key.pem');
			writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
			const zip = join(dir, 'BaseHalf-0.2.0-darwin-arm64.zip');
			writeFileSync(zip, Buffer.from('pretend archive bytes'));

			const notes = 'Line one.\nLine two.';
			execFileSync(process.execPath, [script, zip, '--version', '0.2.0', '--notes', notes], {
				env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BH_UPDATE_KEY: keyPath, BH_UPDATE_SKIP_KEYCHECK: '1' },
				stdio: 'ignore',
			});

			const raw = JSON.parse(readFileSync(join(dir, 'update-manifest-darwin-arm64.json'), 'utf8'));
			const m = sanitizeBaseHalfUpdateManifest(raw);
			assert.ok(m, 'signed manifest did not sanitize');
			assert.strictEqual(m.notes, notes); // multi-line notes round-trip
			const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
			assert.strictEqual(verifyBaseHalfManifestSignature(m, pub), true); // notes are authenticated
			assert.strictEqual(verifyBaseHalfArchiveSignature(readFileSync(zip), m.signature, pub), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

suite('basehalfUpdateProtocol - bundlePathFromExec', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives the .app bundle from a packaged executable path', () => {
		assert.strictEqual(bundlePathFromExec('/Applications/BaseHalf.app/Contents/MacOS/BaseHalf'), '/Applications/BaseHalf.app');
		assert.strictEqual(bundlePathFromExec('/tmp/spaced dir/BaseHalf.app/Contents/MacOS/BaseHalf'), '/tmp/spaced dir/BaseHalf.app');
	});

	test('returns null for non-bundle layouts (dev runs)', () => {
		assert.strictEqual(bundlePathFromExec('/usr/local/bin/electron'), null);
		assert.strictEqual(bundlePathFromExec('/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), '/x/node_modules/electron/dist/Electron.app');
		assert.strictEqual(bundlePathFromExec('/x/Contents/MacOS/foo'), null);
	});
});

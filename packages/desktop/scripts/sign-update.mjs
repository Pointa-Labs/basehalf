#!/usr/bin/env node
/**
 * Release-side half of self-update: sign the built .zip with the project's
 * Ed25519 update key and emit the feed manifest the app polls.
 *
 *   node scripts/sign-update.mjs --init
 *       One-time: generate the keypair (private key stays OUTSIDE the repo,
 *       in the per-user app-support dir below; back it up!) and print the
 *       public key to paste into src/platform/update/node/updateProtocol.ts.
 *
 *   node scripts/sign-update.mjs dist/BaseHalf-<version>-arm64.zip
 *       Sign the archive and write dist/update-manifest-darwin-arm64.json.
 *       Upload BOTH as release assets — the app finds the manifest via the
 *       releases/latest/download/ URL.
 *
 * Key override: BH_UPDATE_KEY=/path/to/key.pem (used by tests).
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const DEFAULT_KEY_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'basehalf-release',
  'update-signing.pem',
);
const keyPath = process.env.BH_UPDATE_KEY ?? DEFAULT_KEY_PATH;

const args = process.argv.slice(2);

if (args[0] === '--init') {
  if (existsSync(keyPath)) {
    console.error(`Refusing to overwrite existing key at ${keyPath}`);
    process.exit(1);
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Private key written to ${keyPath} — back it up; losing it strands old installs.`);
  console.log(
    'Public key (paste into UPDATE_PUBKEY_B64 in src/platform/update/node/updateProtocol.ts):',
  );
  console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  process.exit(0);
}

const zipPath = args[0];
if (!zipPath || !existsSync(zipPath)) {
  console.error(
    'Usage: node scripts/sign-update.mjs <path-to-release-zip> [--version x.y.z] [--notes "text" | --notes-file path]',
  );
  process.exit(1);
}

const versionFlag = args.indexOf('--version');
const version =
  versionFlag !== -1 && args[versionFlag + 1]
    ? args[versionFlag + 1]
    : JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version "${version}" is not strict x.y.z — the app's parser will reject it.`);
  process.exit(1);
}

// Optional "what's new" notes, shown once after a self-update. --notes inline or
// --notes-file from disk; defaults to empty.
const notesFlag = args.indexOf('--notes');
const notesFileFlag = args.indexOf('--notes-file');
let notes = '';
if (notesFlag !== -1 && args[notesFlag + 1]) notes = args[notesFlag + 1];
else if (notesFileFlag !== -1 && args[notesFileFlag + 1])
  notes = readFileSync(args[notesFileFlag + 1], 'utf8');
if (notes.length > 16384) {
  console.error('Notes too long (>16384 chars).');
  process.exit(1);
}

const privateKey = createPrivateKey(readFileSync(keyPath));
const bytes = readFileSync(zipPath);
const signature = sign(null, bytes, privateKey).toString('base64');

// Sanity: the embedded public key in the app must verify what we just
// signed, or every install would reject this release. Compare key material.
// BH_UPDATE_SKIP_KEYCHECK=1 bypasses it for tests that sign with a throwaway key.
if (process.env.BH_UPDATE_SKIP_KEYCHECK !== '1') {
  const protocolSrc = readFileSync(
    new URL('../src/platform/update/node/updateProtocol.ts', import.meta.url),
    'utf8',
  );
  const embedded = /UPDATE_PUBKEY_B64 = '([A-Za-z0-9+/=]+)'/.exec(protocolSrc)?.[1];
  const derived = createPublicKey(privateKey)
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
  if (embedded !== derived) {
    console.error(
      'Public key embedded in src/platform/update/node/updateProtocol.ts does not match this signing key!',
    );
    console.error(`  embedded: ${embedded ?? '(not found)'}`);
    console.error(`  signing:  ${derived}`);
    process.exit(1);
  }
}

const pubDate = new Date().toISOString();
const url = `https://github.com/Pointa-Labs/basehalf/releases/download/v${version}/${basename(zipPath)}`;
const length = statSync(zipPath).size;

// Sign the manifest METADATA too, so version/url/length/pubDate/notes can't be
// forged (an unsigned manifest lets a feed attacker relabel an old signed
// archive as a newer release). Canonical message — MUST match
// manifestSigningMessage() in src/platform/update/node/updateProtocol.ts (pinned by a test in
// test/updater.test.ts). notes rides as base64 so multi-line text stays safe.
const notesB64 = Buffer.from(notes, 'utf8').toString('base64');
const signingMessage = [version, url, String(length), pubDate, signature, notesB64].join('\n');
const manifestSig = sign(null, Buffer.from(signingMessage, 'utf8'), privateKey).toString('base64');

const manifest = {
  version,
  pubDate,
  url,
  length,
  signature,
  notes,
  manifestSig,
};

const outPath = join(dirname(zipPath), 'update-manifest-darwin-arm64.json');
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Manifest written to ${outPath}`);
console.log(JSON.stringify(manifest, null, 2));

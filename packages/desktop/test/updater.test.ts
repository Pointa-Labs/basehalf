import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  bundlePathFromExec,
  compareSemver,
  parseSemver,
  sanitizeManifest,
  verifyArchiveSignature,
} from '../src/main/update-protocol.js';

describe('parseSemver / compareSemver', () => {
  it('parses strict x.y.z only', () => {
    expect(parseSemver('0.1.0')).toEqual([0, 1, 0]);
    expect(parseSemver('12.34.56')).toEqual([12, 34, 56]);
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('1.2.3-beta')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });

  it('orders correctly and fails closed on junk', () => {
    expect(compareSemver('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('0.1.0', '1.0.0')).toBeLessThan(0);
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('abc', '0.1.0')).toBeNull();
  });
});

describe('sanitizeManifest', () => {
  const good = {
    version: '0.2.0',
    url: 'https://github.com/Pointa-Labs/basehalf/releases/download/v0.2.0/x.zip',
    length: 1234,
    signature: 'c2ln',
  };

  it('accepts a well-formed manifest (extra keys dropped)', () => {
    expect(sanitizeManifest({ ...good, pubDate: 'x', extra: 1 })).toEqual(good);
  });

  it('rejects malformed shapes', () => {
    expect(sanitizeManifest(null)).toBeNull();
    expect(sanitizeManifest('x')).toBeNull();
    expect(sanitizeManifest({ ...good, version: '0.2' })).toBeNull();
    expect(sanitizeManifest({ ...good, url: 'http://github.com/x.zip' })).toBeNull();
    expect(sanitizeManifest({ ...good, url: 'file:///etc/passwd' })).toBeNull();
    expect(sanitizeManifest({ ...good, length: 0 })).toBeNull();
    expect(sanitizeManifest({ ...good, length: 1.5 })).toBeNull();
    expect(sanitizeManifest({ ...good, length: 600 * 1024 * 1024 })).toBeNull();
    expect(sanitizeManifest({ ...good, signature: '' })).toBeNull();
  });
});

describe('verifyArchiveSignature', () => {
  it('rejects signatures from a different key', () => {
    // A fresh keypair's signature must NOT verify against the baked-in key.
    const { privateKey } = generateKeyPairSync('ed25519');
    const bytes = Buffer.from('payload');
    const sig = sign(
      null,
      bytes,
      createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    );
    expect(verifyArchiveSignature(bytes, sig.toString('base64'))).toBe(false);
  });

  it('rejects garbage signatures without throwing', () => {
    expect(verifyArchiveSignature(Buffer.from('x'), 'not base64!!')).toBe(false);
    expect(verifyArchiveSignature(Buffer.from('x'), '')).toBe(false);
  });
});

describe('bundlePathFromExec', () => {
  it('derives the .app bundle from a packaged executable path', () => {
    expect(bundlePathFromExec('/Applications/BaseHalf.app/Contents/MacOS/BaseHalf')).toBe(
      '/Applications/BaseHalf.app',
    );
    expect(bundlePathFromExec('/tmp/spaced dir/BaseHalf.app/Contents/MacOS/BaseHalf')).toBe(
      '/tmp/spaced dir/BaseHalf.app',
    );
  });

  it('returns null for non-bundle layouts (dev runs)', () => {
    expect(bundlePathFromExec('/usr/local/bin/electron')).toBeNull();
    expect(
      bundlePathFromExec('/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    ).toBe('/x/node_modules/electron/dist/Electron.app');
    expect(bundlePathFromExec('/x/Contents/MacOS/foo')).toBeNull();
  });
});

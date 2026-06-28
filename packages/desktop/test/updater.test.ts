import { execFileSync } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  Updater,
  cleanupUpdateLeftovers,
  startBackgroundUpdateChecks,
} from '../src/platform/update/electron-main/updater.js';
import {
  bundlePathFromExec,
  compareSemver,
  manifestSigningMessage,
  parseJustInstalled,
  parseSemver,
  sanitizeManifest,
  shouldRunBackgroundCheck,
  verifyArchiveSignature,
  verifyManifestSignature,
} from '../src/platform/update/node/updateProtocol.js';

const electronMock = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    on: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  net: {
    fetch: vi.fn(),
  },
}));

vi.mock('electron', () => electronMock);

const prefs = (autoUpdateCheck = true, autoDownloadUpdate = false) =>
  ({
    get: () => ({ autoUpdateCheck, autoDownloadUpdate }),
  }) as never;

/** A keypair as the protocol consumes it: the public half SPKI-DER-base64
 *  (the shape verify* expects), ready to sign test messages with the private. */
function testKeypair(): { pubB64: string; privateKey: ReturnType<typeof createPrivateKey> } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pubB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })),
  };
}

describe('Updater packaged-app guard', () => {
  it('does not check the feed from a non-packaged Electron run', async () => {
    const updater = new Updater('/tmp/basehalf-config', prefs(), { isPackaged: () => false });

    await updater.check({ background: false });

    expect(updater.getState()).toEqual({
      phase: 'error',
      message: 'Updates are only available in the packaged BaseHalf app.',
    });
    expect(electronMock.net.fetch).not.toHaveBeenCalled();
  });

  it('does not start background checks in development', () => {
    electronMock.app.isPackaged = false;
    electronMock.app.on.mockClear();

    startBackgroundUpdateChecks(new Updater('/tmp/basehalf-config', prefs()), prefs());

    expect(electronMock.app.on).not.toHaveBeenCalled();
  });

  it('does not schedule update-leftover cleanup in development', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    cleanupUpdateLeftovers({ isPackaged: () => false });

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});

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

describe('shouldRunBackgroundCheck (update cadence policy)', () => {
  const GAP = 30 * 60 * 1000;
  const base = { now: 10_000_000, lastCheckAt: 0, focusGapMs: GAP };

  it('never checks when auto-check is disabled', () => {
    expect(shouldRunBackgroundCheck({ ...base, reason: 'interval', enabled: false })).toBe(false);
    expect(shouldRunBackgroundCheck({ ...base, reason: 'focus', enabled: false })).toBe(false);
  });

  it('always runs the periodic tick when enabled, regardless of recency', () => {
    // Even moments after another check, the interval still fires.
    expect(
      shouldRunBackgroundCheck({
        reason: 'interval',
        enabled: true,
        now: 1000,
        lastCheckAt: 999,
        focusGapMs: GAP,
      }),
    ).toBe(true);
  });

  it('coalesces a focus tick that lands inside the throttle window', () => {
    expect(
      shouldRunBackgroundCheck({
        reason: 'focus',
        enabled: true,
        now: base.now,
        lastCheckAt: base.now - (GAP - 1),
        focusGapMs: GAP,
      }),
    ).toBe(false);
  });

  it('runs a focus tick once the throttle window has elapsed', () => {
    expect(
      shouldRunBackgroundCheck({
        reason: 'focus',
        enabled: true,
        now: base.now,
        lastCheckAt: base.now - GAP,
        focusGapMs: GAP,
      }),
    ).toBe(true);
  });

  it('runs the first focus tick when nothing has been checked yet', () => {
    expect(shouldRunBackgroundCheck({ ...base, reason: 'focus', enabled: true })).toBe(true);
  });
});

describe('sanitizeManifest', () => {
  const good = {
    version: '0.2.0',
    url: 'https://github.com/Pointa-Labs/basehalf/releases/download/v0.2.0/x.zip',
    length: 1234,
    signature: 'c2ln',
    pubDate: '2026-01-01T00:00:00.000Z',
    notes: 'First release.',
    manifestSig: 'bXNpZw==',
  };

  it('accepts a well-formed manifest (extra keys dropped)', () => {
    expect(sanitizeManifest({ ...good, extra: 1 })).toEqual(good);
  });

  it('treats notes as optional, multi-line display text, capped', () => {
    const { notes, ...noNotes } = good;
    void notes;
    expect(sanitizeManifest(noNotes)?.notes).toBe(''); // optional → defaults to ''
    expect(sanitizeManifest({ ...good, notes: 'line1\nline2' })?.notes).toBe('line1\nline2');
    expect(sanitizeManifest({ ...good, notes: 'x'.repeat(20000) })).toBeNull(); // over cap
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

  it('requires the authenticated metadata fields', () => {
    const { pubDate, manifestSig, ...noAuth } = good;
    void pubDate;
    void manifestSig;
    expect(sanitizeManifest(noAuth)).toBeNull(); // no pubDate / manifestSig
    expect(sanitizeManifest({ ...good, pubDate: '' })).toBeNull();
    expect(sanitizeManifest({ ...good, manifestSig: '' })).toBeNull();
    expect(sanitizeManifest({ ...good, pubDate: 5 })).toBeNull();
    expect(sanitizeManifest({ ...good, manifestSig: 5 })).toBeNull();
  });

  it('rejects fields that could make the signed message ambiguous', () => {
    // Keep every signed field newline-free so the '\n'-joined message is
    // injective (no two manifests share a signed string → no signature reuse).
    expect(sanitizeManifest({ ...good, url: 'https://x/y\n9.9.9' })).toBeNull();
    expect(sanitizeManifest({ ...good, pubDate: '2026-01-01T00:00:00.000Z\nx' })).toBeNull();
    expect(sanitizeManifest({ ...good, pubDate: 'not-a-date' })).toBeNull();
    expect(sanitizeManifest({ ...good, signature: 'not base64!!' })).toBeNull();
    expect(sanitizeManifest({ ...good, manifestSig: 'has\nnewline' })).toBeNull();
  });
});

describe('verifyArchiveSignature', () => {
  it('verifies bytes against the matching key, rejects everything else', () => {
    const { pubB64, privateKey } = testKeypair();
    const bytes = Buffer.from('payload');
    const sig = sign(null, bytes, privateKey).toString('base64');
    expect(verifyArchiveSignature(bytes, sig, pubB64)).toBe(true);
    expect(verifyArchiveSignature(Buffer.from('tampered'), sig, pubB64)).toBe(false);
  });

  it('rejects signatures from a different key', () => {
    // A fresh keypair's signature must NOT verify against the baked-in key.
    const { privateKey } = testKeypair();
    const bytes = Buffer.from('payload');
    const sig = sign(null, bytes, privateKey);
    expect(verifyArchiveSignature(bytes, sig.toString('base64'))).toBe(false);
  });

  it('rejects garbage signatures without throwing', () => {
    expect(verifyArchiveSignature(Buffer.from('x'), 'not base64!!')).toBe(false);
    expect(verifyArchiveSignature(Buffer.from('x'), '')).toBe(false);
  });
});

describe('manifestSigningMessage', () => {
  it('is the exact canonical string sign-update.mjs must reproduce', () => {
    // Pinned: this format is replicated in scripts/sign-update.mjs. If it
    // changes here, change it there too or every release fails verification.
    expect(
      manifestSigningMessage({
        version: '0.2.0',
        url: 'https://x/y.zip',
        length: 1234,
        pubDate: '2026-01-01T00:00:00.000Z',
        signature: 'c2ln',
        notes: 'Hello',
      }),
    ).toBe('0.2.0\nhttps://x/y.zip\n1234\n2026-01-01T00:00:00.000Z\nc2ln\nSGVsbG8=');
  });
});

describe('verifyManifestSignature', () => {
  const base = {
    version: '0.2.0',
    url: 'https://github.com/Pointa-Labs/basehalf/releases/download/v0.2.0/x.zip',
    length: 1234,
    pubDate: '2026-01-01T00:00:00.000Z',
    signature: 'c2ln',
    notes: 'Some notes.',
  };
  const signManifest = (m: typeof base, priv: ReturnType<typeof createPrivateKey>): string =>
    sign(null, Buffer.from(manifestSigningMessage(m), 'utf8'), priv).toString('base64');

  it('accepts a manifest signed over its own metadata', () => {
    const { pubB64, privateKey } = testKeypair();
    const m = { ...base, manifestSig: signManifest(base, privateKey) };
    expect(verifyManifestSignature(m, pubB64)).toBe(true);
  });

  it('rejects any tampered field (version/url/length/pubDate/signature/notes)', () => {
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
      expect(verifyManifestSignature({ ...base, ...patch, manifestSig }, pubB64)).toBe(false);
    }
  });

  it('blocks the relabel-downgrade attack: old signed archive, forged newer version', () => {
    // Attacker signs (legitimately, long ago) v0.1.0 → oldArchiveSig, then serves
    // the same archive relabelled as v9.9.9. The metadata signature is bound to
    // the original tuple, so the forged manifest fails verification.
    const { pubB64, privateKey } = testKeypair();
    const real = { ...base, version: '0.1.0' };
    const manifestSig = signManifest(real, privateKey);
    const forged = { ...real, version: '9.9.9', manifestSig };
    expect(verifyManifestSignature(forged, pubB64)).toBe(false);
  });

  it('rejects a manifest signed by a different key, and garbage', () => {
    const { privateKey } = testKeypair(); // not the baked-in key
    const m = { ...base, manifestSig: signManifest(base, privateKey) };
    expect(verifyManifestSignature(m)).toBe(false); // baked-in pubkey
    expect(verifyManifestSignature({ ...base, manifestSig: 'not base64!!' })).toBe(false);
  });
});

describe('sign-update.mjs ↔ verifier cross-check', () => {
  // The signer (plain JS) and verifier (TS) can't share code, so prove the real
  // signer's manifestSig + archive signature verify against the protocol — this
  // catches any drift in the canonical signing format between the two.
  it('produces a manifest the verifier accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bh-sign-'));
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const keyPath = join(dir, 'key.pem');
      writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
      const zip = join(dir, 'BaseHalf-0.2.0-arm64.zip');
      writeFileSync(zip, Buffer.from('pretend archive bytes'));

      const notes = 'Line one.\nLine two.';
      const script = fileURLToPath(new URL('../scripts/sign-update.mjs', import.meta.url));
      execFileSync('node', [script, zip, '--version', '0.2.0', '--notes', notes], {
        env: { ...process.env, BH_UPDATE_KEY: keyPath, BH_UPDATE_SKIP_KEYCHECK: '1' },
        stdio: 'ignore',
      });

      const raw = JSON.parse(readFileSync(join(dir, 'update-manifest-darwin-arm64.json'), 'utf8'));
      const m = sanitizeManifest(raw);
      expect(m).not.toBeNull();
      if (!m) return;
      expect(m.notes).toBe(notes); // multi-line notes round-trip
      const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      expect(verifyManifestSignature(m, pub)).toBe(true); // notes are authenticated
      expect(verifyArchiveSignature(readFileSync(zip), m.signature, pub)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseJustInstalled', () => {
  const rec = JSON.stringify({ version: '0.2.5', notes: 'New stuff' });

  it('returns the record only when its version matches the running build', () => {
    expect(parseJustInstalled(rec, '0.2.5')).toEqual({ version: '0.2.5', notes: 'New stuff' });
    expect(parseJustInstalled(rec, '0.2.4')).toBeNull(); // stale / a plain DMG install
  });

  it('ignores empty notes and malformed records', () => {
    expect(parseJustInstalled(JSON.stringify({ version: '0.2.5', notes: '' }), '0.2.5')).toBeNull();
    expect(parseJustInstalled(JSON.stringify({ version: '0.2.5' }), '0.2.5')).toBeNull();
    expect(parseJustInstalled('not json', '0.2.5')).toBeNull();
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

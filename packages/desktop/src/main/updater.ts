/**
 * Self-update for the packaged macOS app, without depending on the platform
 * vendor's signing chain: the release pipeline signs each update archive with
 * OUR Ed25519 key (scripts/sign-update.mjs), the public half is baked in
 * below, and nothing gets installed unless the bytes verify against it. The
 * feed is a tiny JSON manifest uploaded next to the release assets; the
 * `releases/latest/download/<asset>` URL always serves the newest release's
 * copy, so old versions discover new ones with a single GET.
 *
 * Install is a bundle swap the app performs on itself: download → verify →
 * extract → copy next to the current .app (same volume, so renames are
 * atomic) → rename current aside → rename new into place → relaunch. The
 * archive is produced from the already ad-hoc-signed bundle, and files the
 * app downloads itself carry no quarantine flag — so the swapped-in version
 * launches cleanly without re-running the first-install terminal step.
 *
 * Main owns the whole state machine (background checks run before any window
 * exists); renderers mirror it via `update:state` pushes.
 */

import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { net, BrowserWindow, app, ipcMain } from 'electron';
import packageJson from '../../package.json' with { type: 'json' };
import type { PrefsStore } from './prefs.js';
import {
  type UpdateManifest,
  type UpdateState,
  bundlePathFromExec,
  compareSemver,
  sanitizeManifest,
  verifyArchiveSignature,
} from './update-protocol.js';

const execFileAsync = promisify(execFile);

/** Recursive delete via /bin/rm. fs.rm CANNOT be used on app bundles from
 *  inside Electron: the asar-patched fs treats the bundle's app.asar as a
 *  virtual directory and the recursive walk dies on it partway (observed
 *  end-to-end: every sweep left exactly Contents/Resources/app.asar behind).
 *  An external rm — like the ditto we already shell out to — is immune. */
async function rmrf(path: string): Promise<void> {
  await execFileAsync('/bin/rm', ['-rf', '--', path]);
}

/** Where old versions look for the newest manifest. `latest/download/<name>`
 *  resolves to the most recent release's asset, so this URL never changes. */
const DEFAULT_FEED_URL =
  'https://github.com/Pointa-Labs/basehalf/releases/latest/download/update-manifest-darwin-arm64.json';

const FEED_TIMEOUT_MS = 30_000;
const BACKGROUND_FIRST_CHECK_MS = 5_000;
const BACKGROUND_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface FetchedFeed {
  ok: boolean;
  status?: number;
  body?: unknown;
  /** True when the body came from the local test-override path — unlocks
   *  local archive urls in the manifest (sanitizeManifest's allowLocalUrl). */
  local?: boolean;
}

/** GET the feed. `BH_UPDATE_FEED_URL` overrides for tests/staging — an
 *  absolute path is read straight from disk so an end-to-end test needs no
 *  server. */
async function fetchFeed(): Promise<FetchedFeed> {
  const override = process.env.BH_UPDATE_FEED_URL;
  const url = override !== undefined && override !== '' ? override : DEFAULT_FEED_URL;
  if (url.startsWith('/')) {
    try {
      return { ok: true, body: JSON.parse(await readFile(url, 'utf8')), local: true };
    } catch {
      return { ok: false };
    }
  }
  const res = await net.fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  if (!res.ok) return { ok: false, status: res.status };
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false };
  }
}

export class Updater {
  private state: UpdateState = { phase: 'idle' };
  private manifest: UpdateManifest | null = null;
  private stagedApp: string | null = null;
  private stagedVersion: string | null = null;
  private busy = false;

  getState(): UpdateState {
    return this.state;
  }

  private setState(next: UpdateState): void {
    this.state = next;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:state', next);
    }
  }

  /** Look at the feed; on a newer version transition to `available`.
   *  Background runs swallow every failure (a flaky network must not flash an
   *  error chip the user never asked for); an explicit check surfaces it. */
  async check(opts: { background: boolean }): Promise<void> {
    if (this.busy) return;
    // A staged install survives re-checks; don't regress the state machine.
    if (this.state.phase === 'staged' || this.state.phase === 'downloading') return;
    this.busy = true;
    try {
      if (!opts.background) this.setState({ phase: 'checking' });
      const feed = await fetchFeed();
      if (!feed.ok) {
        if (!opts.background) {
          this.setState({
            phase: 'error',
            message:
              feed.status === 404
                ? 'No update feed published yet.'
                : 'Could not reach the update feed.',
          });
        } else if (this.state.phase === 'checking') {
          this.setState({ phase: 'idle' });
        }
        return;
      }
      const manifest = sanitizeManifest(feed.body, { allowLocalUrl: feed.local === true });
      if (!manifest) {
        if (!opts.background) {
          this.setState({ phase: 'error', message: 'Update feed is malformed.' });
        }
        return;
      }
      const cmp = compareSemver(manifest.version, packageJson.version);
      if (cmp === null || cmp <= 0) {
        if (!opts.background) this.setState({ phase: 'upToDate', version: packageJson.version });
        return;
      }
      this.manifest = manifest;
      // Transition to `available` (foreground OR background) — the renderer
      // mirrors this via update:state and the title-bar chip offers "Download".
      // No separate "found" event / modal: the chip IS the surfacing.
      this.setState({ phase: 'available', version: manifest.version });
    } catch (err) {
      if (!opts.background) {
        this.setState({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      this.busy = false;
    }
  }

  /** Download the archive, verify length + signature, extract, and hold the
   *  unpacked .app in a temp staging dir until the user confirms install. */
  async download(): Promise<void> {
    const manifest = this.manifest;
    if (this.busy || this.state.phase !== 'available' || !manifest) return;
    this.busy = true;
    const stageDir = join(tmpdir(), `bh-update-${process.pid}`);
    try {
      this.setState({
        phase: 'downloading',
        version: manifest.version,
        received: 0,
        total: manifest.length,
      });
      await rmrf(stageDir);
      await mkdir(stageDir, { recursive: true });
      const zipPath = join(stageDir, 'update.zip');

      let received = 0;
      if (manifest.url.startsWith('/')) {
        // Local archive — only reachable via the test feed override (sanitize
        // gates it); the signature check below still decides whether it installs.
        await copyFile(manifest.url, zipPath);
        received = manifest.length;
      } else {
        const res = await net.fetch(manifest.url);
        if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
        const reader = res.body.getReader();
        const out = createWriteStream(zipPath);
        // A write-stream error (disk full, dir vanished) with no listener
        // crashes the process; capture it and fail the download instead.
        let streamError: Error | null = null;
        out.once('error', (e) => {
          streamError = e;
        });
        const awaitDrain = (): Promise<void> =>
          new Promise<void>((resolve, reject) => {
            const onError = (e: Error): void => reject(e);
            out.once('error', onError);
            out.once('drain', () => {
              out.off('error', onError);
              resolve();
            });
          });
        let lastPushed = 0;
        try {
          for (;;) {
            if (streamError) throw streamError;
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > manifest.length) {
              throw new Error('Archive larger than the manifest says.');
            }
            if (!out.write(value)) await awaitDrain();
            // Progress pushes throttled to ~every 256 KB so the IPC channel
            // isn't spammed per-chunk.
            if (received - lastPushed > 256 * 1024) {
              lastPushed = received;
              this.setState({
                phase: 'downloading',
                version: manifest.version,
                received,
                total: manifest.length,
              });
            }
          }
        } finally {
          await new Promise((r) => out.end(r));
        }
        if (received !== manifest.length) {
          throw new Error(`Download incomplete (${received} of ${manifest.length} bytes).`);
        }
      }

      const bytes = await readFile(zipPath);
      if (!verifyArchiveSignature(bytes, manifest.signature)) {
        throw new Error('Signature verification failed — refusing the update.');
      }

      // ditto preserves the symlinks + metadata inside .app bundles that a
      // generic unzip mangles.
      const extractDir = join(stageDir, 'extracted');
      await mkdir(extractDir, { recursive: true });
      await execFileAsync('/usr/bin/ditto', ['-xk', zipPath, extractDir]);
      const entries = await readdir(extractDir);
      const apps = entries.filter((e) => e.endsWith('.app'));
      if (apps.length !== 1 || apps[0] === undefined) {
        throw new Error('Archive did not contain exactly one app bundle.');
      }
      this.stagedApp = join(extractDir, apps[0]);
      this.stagedVersion = manifest.version;
      this.setState({ phase: 'staged', version: manifest.version });
    } catch (err) {
      await rmrf(stageDir).catch(() => undefined);
      this.stagedApp = null;
      this.stagedVersion = null;
      this.setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.busy = false;
    }
  }

  /** Swap the running bundle for the staged one and relaunch. Both renames
   *  happen inside the bundle's parent dir (same volume → atomic), with a
   *  rollback if the second one fails. */
  async install(): Promise<void> {
    const staged = this.stagedApp;
    const version = this.stagedVersion;
    if (this.busy || this.state.phase !== 'staged' || !staged || !version) return;
    this.busy = true;
    try {
      const bundle = bundlePathFromExec(process.execPath);
      if (!bundle) {
        throw new Error('Not running from an app bundle — self-update needs the packaged app.');
      }
      if (process.execPath.includes('/AppTranslocation/')) {
        throw new Error(
          'macOS is running this copy from a temporary location. Move BaseHalf to Applications and launch it from there, then try again.',
        );
      }
      const parent = dirname(bundle);
      const stagedHere = join(parent, `.bh-staged-${process.pid}.app`);
      const previous = join(parent, `.bh-previous-${process.pid}.app`);
      await rmrf(stagedHere);
      // Copy into the bundle's own directory first: rename() can't cross
      // volumes, and the temp dir may be on another one.
      await execFileAsync('/usr/bin/ditto', [staged, stagedHere]);
      await rename(bundle, previous);
      try {
        await rename(stagedHere, bundle);
      } catch (err) {
        await rename(previous, bundle); // roll back; the app keeps running
        throw err;
      }
      // The old bundle (which this process is still executing from — fine on
      // macOS, the mapped pages stay valid) is cleaned up by the NEW version's
      // startup sweep; see cleanupUpdateLeftovers().
      app.relaunch();
      app.exit(0);
    } catch (err) {
      this.setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      this.busy = false;
    }
  }
}

const SWEEP_FIRST_PASS_MS = 5_000;
const SWEEP_RETRY_MS = 30_000;

/** Best-effort sweep of swap debris from previous updates: the renamed-aside
 *  old bundle, an orphaned staging copy (crash mid-install), and stale temp
 *  download dirs.
 *
 *  Delayed + retried defensively: right after an update-relaunch the OLD
 *  instance can still be mid-teardown, and a sweep racing it gains nothing.
 *  (The actual deletes go through /bin/rm — see rmrf — because in-process
 *  fs.rm dies on app.asar.) Anything a pass still misses is picked up on the
 *  next launch. */
export function cleanupUpdateLeftovers(): void {
  setTimeout(() => {
    void sweepOnce().then((clean) => {
      if (!clean) setTimeout(() => void sweepOnce(), SWEEP_RETRY_MS);
    });
  }, SWEEP_FIRST_PASS_MS);
}

/** One sweep attempt; resolves false if anything failed to delete. */
async function sweepOnce(): Promise<boolean> {
  const sweeps: Promise<unknown>[] = [];
  const bundle = bundlePathFromExec(process.execPath);
  if (bundle) {
    const parent = dirname(bundle);
    try {
      for (const entry of await readdir(parent)) {
        if (/^\.bh-(previous|staged)-\d+\.app$/.test(entry)) {
          sweeps.push(rmrf(join(parent, entry)));
        }
      }
    } catch {
      // Unreadable parent dir — nothing to sweep.
    }
  }
  try {
    for (const entry of await readdir(tmpdir())) {
      if (/^bh-update-\d+$/.test(entry)) {
        const dir = join(tmpdir(), entry);
        // Another running instance may legitimately own a fresher dir; only
        // sweep ones whose owning pid is gone.
        const pid = Number(entry.slice('bh-update-'.length));
        if (!Number.isInteger(pid) || !isPidAlive(pid)) {
          sweeps.push(rmrf(dir));
        }
      }
    }
  } catch {
    // Unreadable tmpdir — skip.
  }
  const results = await Promise.allSettled(sweeps);
  const failed = results.filter((r) => r.status === 'rejected');
  for (const f of failed) {
    console.warn('[bh-update] leftover sweep failed:', (f as PromiseRejectedResult).reason);
  }
  return failed.length === 0;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** IPC surface for the renderer's update indicator (the title-bar chip) + the
 *  "Check for Updates…" menu item. */
export function registerUpdaterIpc(updater: Updater): void {
  ipcMain.handle('update:get-state', () => updater.getState());
  ipcMain.handle('update:check', async () => {
    await updater.check({ background: false });
  });
  ipcMain.handle('update:download', async () => {
    await updater.download();
  });
  ipcMain.handle('update:install', async () => {
    await updater.install();
  });
}

/** Kick off the background cadence: one early check after launch, then every
 *  few hours. The pref is consulted at FIRE time, so toggling it off in
 *  Settings silences the next tick without a restart. */
export function startBackgroundUpdateChecks(updater: Updater, prefs: PrefsStore): void {
  const tick = (): void => {
    if (!prefs.get().autoUpdateCheck) return;
    void updater.check({ background: true });
  };
  setTimeout(tick, BACKGROUND_FIRST_CHECK_MS);
  setInterval(tick, BACKGROUND_INTERVAL_MS);
}

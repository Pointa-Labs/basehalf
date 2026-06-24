/**
 * Read/write the machine-local `settings.json`. The disk shape is tolerant by
 * design (these are personal prefs, not domain data): a missing file, bad JSON,
 * or an unknown version all degrade to empty defaults rather than wedging the
 * app on a hand-edit. Unknown / forward-version KEYS inside a valid file are
 * preserved on round-trip (a newer build's setting survives an older build);
 * per-key validity is judged at lookup time against the registry, not here.
 *
 * Uses `ctx.fs` only (never `node:fs`) so tests swap a mock. `node:path` is pure
 * and fine to import.
 */

import { join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';
import { EMPTY_SETTINGS, type SettingsFile } from './types.js';

const FILE_NAME = 'settings.json';

function settingsFilePath(configDir: string): string {
  return join(configDir, FILE_NAME);
}

/** Coerce an arbitrary value to a plain `Record<string, SettingValue>`-ish map,
 *  dropping anything that isn't an object. Values are NOT validated here — that
 *  happens per-descriptor at lookup time (so forward-version keys survive). */
function asMap(raw: unknown): Record<string, never> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, never>)
    : {};
}

export async function readSettings(fs: FsLike, configDir: string): Promise<SettingsFile> {
  const raw = await fs.readFile(settingsFilePath(configDir));
  if (raw === null) return EMPTY_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsFile>;
    if (parsed?.version !== 1) return EMPTY_SETTINGS;
    const workspacesRaw = asMap(parsed.workspaces);
    const workspaces: Record<string, Record<string, never>> = {};
    for (const [k, v] of Object.entries(workspacesRaw)) {
      workspaces[k] = asMap(v);
    }
    return { version: 1, global: asMap(parsed.global), workspaces };
  } catch {
    // Corrupt JSON from a hand-edit — fall back to defaults instead of throwing.
    return EMPTY_SETTINGS;
  }
}

export async function writeSettings(
  fs: FsLike,
  configDir: string,
  data: SettingsFile,
): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  const finalPath = settingsFilePath(configDir);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  // Atomic temp-then-rename when the fs supports it (production); legacy mocks
  // without `rename` fall back to a plain write (no concurrent writer in play).
  if (fs.rename) {
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, content);
    await fs.rename(tmpPath, finalPath);
  } else {
    await fs.writeFile(finalPath, content);
  }
}

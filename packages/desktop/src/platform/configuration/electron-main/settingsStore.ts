import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SettingValue } from '../common/configuration.js';

export interface SettingsFile {
  readonly version: 1;
  readonly global: Readonly<Record<string, SettingValue>>;
  readonly workspaces: Readonly<Record<string, Readonly<Record<string, SettingValue>>>>;
}

export const EMPTY_SETTINGS: SettingsFile = Object.freeze({
  version: 1,
  global: Object.freeze({}),
  workspaces: Object.freeze({}),
});

const FILE_NAME = 'settings.json';

function settingsFilePath(configDir: string): string {
  return join(configDir, FILE_NAME);
}

function asMap(raw: unknown): Record<string, never> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, never>)
    : {};
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

export async function readSettings(configDir: string): Promise<SettingsFile> {
  let raw: string;
  try {
    raw = await readFile(settingsFilePath(configDir), 'utf8');
  } catch (err) {
    if (isENOENT(err)) return EMPTY_SETTINGS;
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SettingsFile>;
    if (parsed?.version !== 1) return EMPTY_SETTINGS;
    const workspacesRaw = asMap(parsed.workspaces);
    const workspaces: Record<string, Record<string, never>> = {};
    for (const [key, value] of Object.entries(workspacesRaw)) {
      workspaces[key] = asMap(value);
    }
    return { version: 1, global: asMap(parsed.global), workspaces };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export async function writeSettings(configDir: string, data: SettingsFile): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const finalPath = settingsFilePath(configDir);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmpPath, finalPath);
}

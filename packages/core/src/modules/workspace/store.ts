import { join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';
import { EMPTY_WORKSPACES, type WorkspacesFile } from './types.js';

/**
 * Read/write `workspaces.json` under the kernel's `configDir`. Pure plumbing —
 * no decisions live here; the command handlers compose this with validation.
 */

export function workspacesFilePath(configDir: string): string {
  return join(configDir, 'workspaces.json');
}

export async function readWorkspaces(fs: FsLike, configDir: string): Promise<WorkspacesFile> {
  const raw = await fs.readFile(workspacesFilePath(configDir));
  if (raw === null) return EMPTY_WORKSPACES;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspacesFile>;
    if (parsed?.version !== 1) {
      throw new Error(`Unsupported workspaces.json version: ${String(parsed?.version)}`);
    }
    // Defensive defaults — if the file was hand-edited and lost fields. A legacy
    // `current` field (from a build before the per-window binding) is simply
    // ignored: the active workspace is bound per call now, not stored here.
    return {
      version: 1,
      workspaces: parsed.workspaces ?? {},
    };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`workspaces.json is not valid JSON: ${err.message}`);
    }
    throw err;
  }
}

export async function writeWorkspaces(
  fs: FsLike,
  configDir: string,
  data: WorkspacesFile,
): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  const finalPath = workspacesFilePath(configDir);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  // ATOMIC write: write a temp file then rename it over the target. The config
  // mutex serializes WRITERS, but the user-file ops (readFile/writeFile/createFile/
  // createFolder/deleteEntry/renameEntry) resolve the current workspace via a
  // LOCK-FREE readWorkspaces — a plain writeFile truncates first, so a read landing
  // in that window gets an empty/partial file and throws "Unexpected end of JSON
  // input". rename(2) is atomic on the same filesystem, so a concurrent reader sees
  // either the old or the new complete file, never a torn one. The temp name carries
  // the pid so two app instances don't collide (same-process writers are already
  // serialized by the mutex). Falls back to a direct write for legacy mocks lacking
  // rename.
  if (fs.rename) {
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, content);
    await fs.rename(tmpPath, finalPath);
  } else {
    await fs.writeFile(finalPath, content);
  }
}

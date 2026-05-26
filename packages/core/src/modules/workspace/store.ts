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
    // Defensive defaults — if the file was hand-edited and lost fields.
    return {
      version: 1,
      current: parsed.current ?? null,
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
  await fs.writeFile(workspacesFilePath(configDir), `${JSON.stringify(data, null, 2)}\n`);
}

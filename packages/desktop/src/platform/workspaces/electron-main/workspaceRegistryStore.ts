import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { ViewportState, WorkspaceEntry } from '../common/workspaces.js';

export interface WorkspacesFileEntry {
  readonly path: string;
  readonly addedAt: string;
  readonly lastOpenedAt?: string;
  readonly viewport?: ViewportState;
}

export interface WorkspacesFile {
  readonly version: 1;
  readonly workspaces: Record<string, WorkspacesFileEntry>;
}

export const EMPTY_WORKSPACES: WorkspacesFile = Object.freeze({
  version: 1,
  workspaces: {},
});

export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export const withWorkspacesLock = createKeyedMutex();

export function normalizeWorkspaceRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(root);
}

export function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function boundWorkspaceEntry(
  workspaceRoot: string | null,
  file: WorkspacesFile,
): WorkspaceEntry | null {
  const found = boundWorkspaceFileEntry(workspaceRoot, file);
  if (found === null) return null;
  const [name, entry] = found;
  return workspaceEntry(name, entry);
}

export function boundWorkspaceFileEntry(
  workspaceRoot: string | null,
  file: WorkspacesFile,
): [string, WorkspacesFileEntry] | null {
  if (workspaceRoot === null) return null;
  return (
    Object.entries(file.workspaces).find(([, entry]) => samePath(entry.path, workspaceRoot)) ?? null
  );
}

export function workspaceEntries(file: WorkspacesFile): WorkspaceEntry[] {
  return Object.entries(file.workspaces)
    .map(([name, entry]) => workspaceEntry(name, entry))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function workspacesFilePath(configDir: string): string {
  return join(configDir, 'workspaces.json');
}

export async function readWorkspaces(configDir: string): Promise<WorkspacesFile> {
  let raw: string;
  try {
    raw = await readFile(workspacesFilePath(configDir), 'utf8');
  } catch (err) {
    if (isENOENT(err)) return EMPTY_WORKSPACES;
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspacesFile>;
    if (parsed?.version !== 1) {
      throw new Error(`Unsupported workspaces.json version: ${String(parsed?.version)}`);
    }
    return { version: 1, workspaces: parsed.workspaces ?? {} };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`workspaces.json is not valid JSON: ${err.message}`);
    }
    throw err;
  }
}

export async function writeWorkspaces(configDir: string, data: WorkspacesFile): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const finalPath = workspacesFilePath(configDir);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmpPath, finalPath);
}

function workspaceEntry(name: string, entry: WorkspacesFileEntry): WorkspaceEntry {
  return {
    name,
    path: entry.path,
    addedAt: entry.addedAt,
    ...(entry.lastOpenedAt !== undefined && { lastOpenedAt: entry.lastOpenedAt }),
    ...(entry.viewport !== undefined && { viewport: entry.viewport }),
  };
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

function createKeyedMutex(): <T>(key: string, op: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>();
  return <T>(key: string, op: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve();
    const result = previous.then(op, op);
    chains.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };
}

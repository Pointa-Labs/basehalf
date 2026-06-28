import type { WorkspaceRegistryRecord } from './workspaceRegistryMainService.js';
import {
  normalizeWorkspaceRoot,
  readWorkspaces,
  samePath,
  withWorkspacesLock,
  writeWorkspaces,
} from './workspaceRegistryStore.js';

export interface WorkspaceRegistryBackendProvider {
  listWorkspaces(): Promise<WorkspaceRegistryRecord[]>;
  touchWorkspace(root: string): Promise<void>;
  stopWatcher(root: string): Promise<void>;
}

export interface FileWorkspaceRegistryBackendProviderOptions {
  readonly configDir: string;
  readonly stopWatcher: (root: string) => Promise<void>;
}

/**
 * Main-process workspace history provider, aligned with VS Code's
 * WorkspacesHistoryMainService shape: window/session services read and touch a
 * typed workspace-history store instead of routing through a generic command bus.
 */
export class FileWorkspaceRegistryBackendProvider implements WorkspaceRegistryBackendProvider {
  constructor(private readonly opts: FileWorkspaceRegistryBackendProviderOptions) {}

  async listWorkspaces(): Promise<WorkspaceRegistryRecord[]> {
    const file = await readWorkspaces(this.opts.configDir);
    return Object.entries(file.workspaces)
      .map(([name, entry]) => ({
        name,
        path: entry.path,
        addedAt: entry.addedAt,
        ...(entry.lastOpenedAt !== undefined && { lastOpenedAt: entry.lastOpenedAt }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async touchWorkspace(root: string): Promise<void> {
    const absRoot = normalizeWorkspaceRoot(root);
    await withWorkspacesLock(this.opts.configDir, async () => {
      const file = await readWorkspaces(this.opts.configDir);
      const found = Object.entries(file.workspaces).find(([, entry]) =>
        samePath(entry.path, absRoot),
      );
      if (found === undefined) return;
      const [name, entry] = found;
      await writeWorkspaces(this.opts.configDir, {
        version: 1,
        workspaces: {
          ...file.workspaces,
          [name]: { ...entry, lastOpenedAt: new Date().toISOString() },
        },
      });
    });
  }

  stopWatcher(root: string): Promise<void> {
    return this.opts.stopWatcher(root);
  }
}

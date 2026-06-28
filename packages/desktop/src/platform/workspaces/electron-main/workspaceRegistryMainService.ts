import type { WorkspaceRegistryBackendProvider } from './workspaceRegistryBackendProvider.js';

export interface WorkspaceRegistryRecord {
  readonly name: string;
  readonly path: string;
  readonly addedAt: string;
  readonly lastOpenedAt?: string;
}

export interface WorkspaceRegistryMain {
  listWorkspaces(): Promise<WorkspaceRegistryRecord[]>;
  rootForName(name: unknown): Promise<string | null>;
  registeredPaths(): Promise<string[]>;
  touchWorkspace(root: string | null): Promise<void>;
  stopWatcher(root: string): Promise<void>;
}

export interface WorkspaceRegistryMainServiceOptions {
  readonly backend: WorkspaceRegistryBackendProvider;
}

/**
 * Main-process adapter for the workspace registry. It mirrors VS Code's split
 * where window/session services depend on a typed workspace-history contract
 * while storage/backend details sit behind a service boundary.
 */
export class WorkspaceRegistryMainService implements WorkspaceRegistryMain {
  constructor(private readonly opts: WorkspaceRegistryMainServiceOptions) {}

  async listWorkspaces(): Promise<WorkspaceRegistryRecord[]> {
    return this.opts.backend.listWorkspaces();
  }

  async rootForName(name: unknown): Promise<string | null> {
    if (typeof name !== 'string') return null;
    try {
      const workspaces = await this.listWorkspaces();
      return workspaces.find((w) => w.name === name)?.path ?? null;
    } catch {
      return null;
    }
  }

  async registeredPaths(): Promise<string[]> {
    try {
      const workspaces = await this.listWorkspaces();
      return workspaces.map((w) => w.path);
    } catch {
      return [];
    }
  }

  async touchWorkspace(root: string | null): Promise<void> {
    if (root === null) return;
    await this.opts.backend.touchWorkspace(root);
  }

  async stopWatcher(root: string): Promise<void> {
    await this.opts.backend.stopWatcher(root);
  }
}

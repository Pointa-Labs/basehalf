import { mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  WorkspaceAddArgs,
  WorkspaceAddResult,
  WorkspaceCreateDemoArgs,
  WorkspaceCreateDemoResult,
  WorkspaceCurrentResult,
  WorkspaceEnsureSetupResult,
  WorkspaceGetViewportResult,
  WorkspaceListCanvasArgs,
  WorkspaceListCanvasResult,
  WorkspaceListResult,
  WorkspaceRemoveArgs,
  WorkspaceRemoveResult,
  WorkspaceRenameArgs,
  WorkspaceRenameResult,
  WorkspaceRepathArgs,
  WorkspaceRepathResult,
  WorkspaceSetViewportArgs,
  WorkspaceSetViewportResult,
  WorkspaceTouchArgs,
  WorkspaceTouchResult,
  WorkspaceUseArgs,
  WorkspaceUseResult,
} from '../common/workspaces.js';
import { type WorkspaceDemoMirrorProvider, createWorkspaceDemo } from './workspaceDemo.js';
import {
  NAME_PATTERN,
  type WorkspacesFileEntry,
  boundWorkspaceEntry,
  boundWorkspaceFileEntry,
  normalizeWorkspaceRoot,
  readWorkspaces,
  samePath,
  withWorkspacesLock,
  workspaceEntries,
  writeWorkspaces,
} from './workspaceRegistryStore.js';
import { runWorkspaceSetup } from './workspaceSetup.js';

export interface WorkspaceBackendProvider {
  startWatcher(workspaceRoot: string | null): Promise<void>;
  list(workspaceRoot: string | null): Promise<WorkspaceListResult>;
  use(workspaceRoot: string | null, args: WorkspaceUseArgs): Promise<WorkspaceUseResult>;
  current(workspaceRoot: string | null): Promise<WorkspaceCurrentResult>;
  touch(workspaceRoot: string | null, args: WorkspaceTouchArgs): Promise<WorkspaceTouchResult>;
  ensureSetup(workspaceRoot: string | null): Promise<WorkspaceEnsureSetupResult>;
  add(workspaceRoot: string | null, args: WorkspaceAddArgs): Promise<WorkspaceAddResult>;
  remove(workspaceRoot: string | null, args: WorkspaceRemoveArgs): Promise<WorkspaceRemoveResult>;
  rename(workspaceRoot: string | null, args: WorkspaceRenameArgs): Promise<WorkspaceRenameResult>;
  repath(workspaceRoot: string | null, args: WorkspaceRepathArgs): Promise<WorkspaceRepathResult>;
  createDemo(
    workspaceRoot: string | null,
    args: WorkspaceCreateDemoArgs,
  ): Promise<WorkspaceCreateDemoResult>;
  listCanvas(
    workspaceRoot: string | null,
    args: WorkspaceListCanvasArgs,
  ): Promise<WorkspaceListCanvasResult>;
  getViewport(workspaceRoot: string | null): Promise<WorkspaceGetViewportResult>;
  setViewport(
    workspaceRoot: string | null,
    args: WorkspaceSetViewportArgs,
  ): Promise<WorkspaceSetViewportResult>;
}

export interface DesktopWorkspaceBackendProviderOptions {
  readonly configDir: string;
  readonly fallback?: WorkspaceBackendProvider;
  readonly startWatcher?: (workspaceRoot: string | null) => Promise<void>;
  readonly demo?: WorkspaceDemoMirrorProvider;
  readonly canvasListing?: Pick<WorkspaceBackendProvider, 'listCanvas'>;
}

/**
 * Main-process workspace backend for registry-oriented operations. VS Code keeps
 * workspace history/selection in typed main-process services; BaseHalf now does
 * the same for the workspaces.json command family, setup bootstrap, demo
 * seeding, canvas listing, and viewport storage while platform/files owns
 * workspace-relative file operations.
 */
export class DesktopWorkspaceBackendProvider implements WorkspaceBackendProvider {
  constructor(private readonly opts: DesktopWorkspaceBackendProviderOptions) {}

  startWatcher(workspaceRoot: string | null): Promise<void> {
    if (this.opts.startWatcher !== undefined) {
      return this.opts.startWatcher(workspaceRoot);
    }
    return this.requireFallback('startWatcher').startWatcher(workspaceRoot);
  }

  async list(workspaceRoot: string | null): Promise<WorkspaceListResult> {
    const file = await readWorkspaces(this.opts.configDir);
    const normalizedRoot = workspaceRoot === null ? null : normalizeWorkspaceRoot(workspaceRoot);
    return {
      current: boundWorkspaceEntry(normalizedRoot, file)?.name ?? null,
      workspaces: workspaceEntries(file),
    };
  }

  async use(_workspaceRoot: string | null, args: WorkspaceUseArgs): Promise<WorkspaceUseResult> {
    const file = await readWorkspaces(this.opts.configDir);
    const found = file.workspaces[args.name];
    if (found === undefined) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    return {
      current: {
        name: args.name,
        path: found.path,
        addedAt: found.addedAt,
      },
    };
  }

  async current(workspaceRoot: string | null): Promise<WorkspaceCurrentResult> {
    const file = await readWorkspaces(this.opts.configDir);
    const normalizedRoot = workspaceRoot === null ? null : normalizeWorkspaceRoot(workspaceRoot);
    const entry = boundWorkspaceEntry(normalizedRoot, file);
    return entry === null ? { current: null } : { current: entry };
  }

  async touch(
    _workspaceRoot: string | null,
    args: WorkspaceTouchArgs,
  ): Promise<WorkspaceTouchResult> {
    const absPath = normalizeWorkspaceRoot(args.path);
    return withWorkspacesLock(this.opts.configDir, async () => {
      const file = await readWorkspaces(this.opts.configDir);
      const found = Object.entries(file.workspaces).find(([, entry]) =>
        samePath(entry.path, absPath),
      );
      if (found === undefined) return { touched: false };
      const [name, entry] = found;
      const lastOpenedAt = new Date().toISOString();
      await writeWorkspaces(this.opts.configDir, {
        version: 1,
        workspaces: {
          ...file.workspaces,
          [name]: { ...entry, lastOpenedAt },
        },
      });
      return { touched: true, name, lastOpenedAt };
    });
  }

  async ensureSetup(workspaceRoot: string | null): Promise<WorkspaceEnsureSetupResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    await assertDirectory(root);
    return runWorkspaceSetup(root);
  }

  async add(_workspaceRoot: string | null, args: WorkspaceAddArgs): Promise<WorkspaceAddResult> {
    const absPath = normalizeWorkspaceRoot(args.path);
    await assertDirectory(absPath);

    const requestedName = args.name ?? basename(absPath);
    if (!NAME_PATTERN.test(requestedName)) {
      throw new Error(
        `Invalid workspace name: ${JSON.stringify(requestedName)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
      );
    }

    const addedAt = new Date().toISOString();
    const bhDir = join(absPath, '.bh');
    const { workspace, bhDirCreated, alreadyRegistered } = await withWorkspacesLock(
      this.opts.configDir,
      async () => {
        const file = await readWorkspaces(this.opts.configDir);
        const existing = Object.entries(file.workspaces).find(([, entry]) =>
          samePath(entry.path, absPath),
        );
        if (existing !== undefined) {
          const [name, entry] = existing;
          return {
            workspace: { name, path: entry.path, addedAt: entry.addedAt },
            bhDirCreated: false,
            alreadyRegistered: true,
          };
        }

        const taken = new Set(Object.keys(file.workspaces));
        if (args.name !== undefined && taken.has(args.name)) {
          throw new Error(`Workspace already exists: ${args.name}`);
        }
        const name = uniqueName(requestedName, taken);
        const created = !(await exists(bhDir));
        if (created) {
          await mkdir(bhDir, { recursive: true });
        }
        await writeWorkspaces(this.opts.configDir, {
          version: 1,
          workspaces: { ...file.workspaces, [name]: { path: absPath, addedAt } },
        });
        return {
          workspace: { name, path: absPath, addedAt },
          bhDirCreated: created,
          alreadyRegistered: false,
        };
      },
    );

    const setup = args.setup ? await runWorkspaceSetup(workspace.path) : undefined;
    return {
      workspace,
      bhDirCreated,
      alreadyRegistered,
      ...(setup !== undefined && { setup }),
    };
  }

  remove(_workspaceRoot: string | null, args: WorkspaceRemoveArgs): Promise<WorkspaceRemoveResult> {
    return withWorkspacesLock(this.opts.configDir, async () => {
      const file = await readWorkspaces(this.opts.configDir);
      if (file.workspaces[args.name] === undefined) {
        throw new Error(`No such workspace: ${args.name}`);
      }
      const { [args.name]: _removed, ...rest } = file.workspaces;
      await writeWorkspaces(this.opts.configDir, {
        version: 1,
        workspaces: rest,
      });
      return { removed: args.name };
    });
  }

  rename(_workspaceRoot: string | null, args: WorkspaceRenameArgs): Promise<WorkspaceRenameResult> {
    if (args.from === args.to) {
      throw new Error(`workspace.rename: from and to are the same (${args.from})`);
    }
    if (!NAME_PATTERN.test(args.to)) {
      throw new Error(
        `Invalid workspace name: ${JSON.stringify(args.to)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
      );
    }
    return withWorkspacesLock(this.opts.configDir, async () => {
      const file = await readWorkspaces(this.opts.configDir);
      const source = file.workspaces[args.from];
      if (source === undefined) {
        throw new Error(`No such workspace: ${args.from}`);
      }
      if (file.workspaces[args.to] !== undefined) {
        throw new Error(`Workspace name already taken: ${args.to}`);
      }
      const next: Record<string, WorkspacesFileEntry> = {};
      for (const [name, entry] of Object.entries(file.workspaces)) {
        if (name === args.from) {
          next[args.to] = entry;
        } else {
          next[name] = entry;
        }
      }
      await writeWorkspaces(this.opts.configDir, {
        version: 1,
        workspaces: next,
      });
      return {
        workspace: {
          name: args.to,
          path: source.path,
          addedAt: source.addedAt,
        },
      };
    });
  }

  async repath(
    _workspaceRoot: string | null,
    args: WorkspaceRepathArgs,
  ): Promise<WorkspaceRepathResult> {
    const absPath = normalizeWorkspaceRoot(args.path);
    await assertDirectory(absPath);
    const bhDir = join(absPath, '.bh');
    const { existing, bhDirCreated } = await withWorkspacesLock(this.opts.configDir, async () => {
      const file = await readWorkspaces(this.opts.configDir);
      const found = file.workspaces[args.name];
      if (found === undefined) {
        throw new Error(`No such workspace: ${args.name}`);
      }
      if (found.path === absPath) {
        throw new Error(`Workspace ${args.name} is already at ${absPath}`);
      }
      const collision = Object.entries(file.workspaces).find(
        ([name, entry]) => name !== args.name && samePath(entry.path, absPath),
      );
      if (collision !== undefined) {
        throw new Error(`That folder is already registered as workspace "${collision[0]}".`);
      }
      const created = !(await exists(bhDir));
      if (created) {
        await mkdir(bhDir, { recursive: true });
      }
      await writeWorkspaces(this.opts.configDir, {
        version: 1,
        workspaces: {
          ...file.workspaces,
          [args.name]: { path: absPath, addedAt: found.addedAt },
        },
      });
      return { existing: found, bhDirCreated: created };
    });
    const setup = args.setup ? await runWorkspaceSetup(absPath) : undefined;
    return {
      workspace: { name: args.name, path: absPath, addedAt: existing.addedAt },
      bhDirCreated,
      ...(setup !== undefined && { setup }),
    };
  }

  createDemo(
    workspaceRoot: string | null,
    args: WorkspaceCreateDemoArgs,
  ): Promise<WorkspaceCreateDemoResult> {
    if (this.opts.demo !== undefined) {
      return createWorkspaceDemo(args, {
        configDir: this.opts.configDir,
        mirror: this.opts.demo,
        registerWorkspace: (addArgs) => this.add(workspaceRoot, addArgs),
      });
    }
    return this.requireFallback('createDemo').createDemo(workspaceRoot, args);
  }

  listCanvas(
    workspaceRoot: string | null,
    args: WorkspaceListCanvasArgs,
  ): Promise<WorkspaceListCanvasResult> {
    if (this.opts.canvasListing !== undefined) {
      return this.opts.canvasListing.listCanvas(workspaceRoot, args);
    }
    return this.requireFallback('listCanvas').listCanvas(workspaceRoot, args);
  }

  async getViewport(workspaceRoot: string | null): Promise<WorkspaceGetViewportResult> {
    const file = await readWorkspaces(this.opts.configDir);
    const normalizedRoot = workspaceRoot === null ? null : normalizeWorkspaceRoot(workspaceRoot);
    return boundWorkspaceFileEntry(normalizedRoot, file)?.[1].viewport ?? null;
  }

  async setViewport(
    workspaceRoot: string | null,
    args: WorkspaceSetViewportArgs,
  ): Promise<WorkspaceSetViewportResult> {
    const normalizedRoot = workspaceRoot === null ? null : normalizeWorkspaceRoot(workspaceRoot);
    return withWorkspacesLock(this.opts.configDir, async () => {
      const file = await readWorkspaces(this.opts.configDir);
      const found = boundWorkspaceFileEntry(normalizedRoot, file);
      if (found === null) return {};
      const [name, entry] = found;
      await writeWorkspaces(this.opts.configDir, {
        version: 1,
        workspaces: {
          ...file.workspaces,
          [name]: { ...entry, viewport: args.viewport },
        },
      });
      return {};
    });
  }

  private requireFallback(method: keyof WorkspaceBackendProvider): WorkspaceBackendProvider {
    if (this.opts.fallback !== undefined) return this.opts.fallback;
    throw new Error(`DesktopWorkspaceBackendProvider: ${String(method)} is not configured.`);
  }
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function assertDirectory(path: string): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (err) {
    if (isENOENT(err)) {
      throw new Error(`Path does not exist: ${path}`);
    }
    throw err;
  }
  if (!info.isDirectory()) {
    throw new Error(`Path is not a directory: ${path}`);
  }
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (isENOENT(err)) return false;
    throw err;
  }
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

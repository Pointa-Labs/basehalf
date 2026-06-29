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
import type { WorkspaceBackendProvider } from './workspaceBackendProvider.js';

/**
 * Main-process workspace service consumed by explicit IPC channels. The concrete
 * storage/backend is injected so the service boundary mirrors VS Code's
 * `IWorkspacesService` proxy shape instead of embedding legacy core commands.
 */
export class WorkspaceMainService {
  constructor(private readonly backend: WorkspaceBackendProvider) {}

  startWatcher(workspaceRoot: string | null): Promise<void> {
    return this.backend.startWatcher(workspaceRoot);
  }

  list(workspaceRoot: string | null): Promise<WorkspaceListResult> {
    return this.backend.list(workspaceRoot);
  }

  use(workspaceRoot: string | null, args: WorkspaceUseArgs): Promise<WorkspaceUseResult> {
    return this.backend.use(workspaceRoot, args);
  }

  current(workspaceRoot: string | null): Promise<WorkspaceCurrentResult> {
    return this.backend.current(workspaceRoot);
  }

  touch(workspaceRoot: string | null, args: WorkspaceTouchArgs): Promise<WorkspaceTouchResult> {
    return this.backend.touch(workspaceRoot, args);
  }

  ensureSetup(workspaceRoot: string | null): Promise<WorkspaceEnsureSetupResult> {
    return this.backend.ensureSetup(workspaceRoot);
  }

  add(workspaceRoot: string | null, args: WorkspaceAddArgs): Promise<WorkspaceAddResult> {
    return this.backend.add(workspaceRoot, args);
  }

  remove(workspaceRoot: string | null, args: WorkspaceRemoveArgs): Promise<WorkspaceRemoveResult> {
    return this.backend.remove(workspaceRoot, args);
  }

  rename(workspaceRoot: string | null, args: WorkspaceRenameArgs): Promise<WorkspaceRenameResult> {
    return this.backend.rename(workspaceRoot, args);
  }

  repath(workspaceRoot: string | null, args: WorkspaceRepathArgs): Promise<WorkspaceRepathResult> {
    return this.backend.repath(workspaceRoot, args);
  }

  createDemo(
    workspaceRoot: string | null,
    args: WorkspaceCreateDemoArgs,
  ): Promise<WorkspaceCreateDemoResult> {
    return this.backend.createDemo(workspaceRoot, args);
  }

  listCanvas(
    workspaceRoot: string | null,
    args: WorkspaceListCanvasArgs,
  ): Promise<WorkspaceListCanvasResult> {
    return this.backend.listCanvas(workspaceRoot, args);
  }

  getViewport(workspaceRoot: string | null): Promise<WorkspaceGetViewportResult> {
    return this.backend.getViewport(workspaceRoot);
  }

  setViewport(
    workspaceRoot: string | null,
    args: WorkspaceSetViewportArgs,
  ): Promise<WorkspaceSetViewportResult> {
    return this.backend.setViewport(workspaceRoot, args);
  }
}

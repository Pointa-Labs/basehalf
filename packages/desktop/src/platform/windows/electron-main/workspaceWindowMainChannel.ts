import { BrowserWindow, type WebContents, ipcMain } from 'electron';
import {
  WINDOW_IPC_CHANNELS,
  parseWindowOpenWorkspaceName,
  parseWindowReopenWorkspaceName,
} from '../common/window.js';
import type { WorkspaceWindowRouterMainService } from './workspaceWindowRouterMainService.js';

type WorkspaceWindowIpcHandler = (event: WorkspaceWindowIpcEvent, payload?: unknown) => unknown;
type WorkspaceWindowIpcListener = (event: WorkspaceWindowIpcEvent, payload?: unknown) => void;

export interface IpcMainWorkspaceWindowLike {
  handle(channel: string, listener: WorkspaceWindowIpcHandler): void;
  on(channel: string, listener: WorkspaceWindowIpcListener): void;
}

export interface WorkspaceWindowLocator {
  fromWebContents(sender: WebContents): BrowserWindow | null;
}

interface WorkspaceWindowIpcEvent {
  readonly sender: WebContents;
}

/**
 * IPC channel for workspace/window routing. The router service owns the open,
 * focus, reuse, and reload decisions; this channel only resolves the sender
 * window and exposes the stable renderer IPC surface.
 */
export class WorkspaceWindowMainChannel {
  constructor(
    private readonly router: WorkspaceWindowRouterMainService,
    private readonly windowLocator: WorkspaceWindowLocator = BrowserWindow,
    private readonly ipc: IpcMainWorkspaceWindowLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(WINDOW_IPC_CHANNELS.workspaceOpen, (event, name) =>
      this.router.openWorkspaceFromWindow(
        this.windowLocator.fromWebContents(event.sender),
        parseWindowOpenWorkspaceName(name),
      ),
    );

    this.ipc.handle(WINDOW_IPC_CHANNELS.workspaceReopen, async (event, name): Promise<void> => {
      await this.router.reopenWorkspaceInWindow(
        this.windowLocator.fromWebContents(event.sender),
        parseWindowReopenWorkspaceName(name),
      );
    });

    this.ipc.handle(WINDOW_IPC_CHANNELS.newWindow, async (): Promise<void> => {
      await this.router.createEmptyWindow();
    });

    this.ipc.handle(WINDOW_IPC_CHANNELS.openWorkspaces, () => this.router.getOpenWorkspaceRoots());
    this.ipc.on(WINDOW_IPC_CHANNELS.workspacesChanged, () =>
      this.router.refreshWorkspaceSurfaces(),
    );
  }
}

import { type WebContents, ipcMain } from 'electron';
import {
  CANVAS_IPC_CHANNELS,
  asCanvasConnectArgs,
  asCanvasDisconnectArgs,
  asCanvasGetArgs,
  asCanvasPurgeNodeArgs,
  asCanvasReconnectArgs,
  asCanvasRelocateArgs,
  asCanvasRemoveCardArgs,
  asCanvasSetCardArgs,
  asCanvasSetSizeArgs,
} from '../common/canvas.js';
import type { CanvasMainService } from './canvasMainService.js';

type CanvasIpcHandler = (event: CanvasIpcEvent, payload?: unknown) => unknown;

export interface IpcMainCanvasLike {
  handle(channel: string, listener: CanvasIpcHandler): void;
}

export type CanvasWorkspaceRootResolver = (sender: WebContents) => string | null;

interface CanvasIpcEvent {
  readonly sender: WebContents;
}

export class CanvasMainChannel {
  constructor(
    private readonly canvas: CanvasMainService,
    private readonly getWorkspaceRoot: CanvasWorkspaceRootResolver,
    private readonly ipc: IpcMainCanvasLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(CANVAS_IPC_CHANNELS.get, async (event, args) =>
      this.canvas.get(this.root(event), asCanvasGetArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.setCard, async (event, args) =>
      this.canvas.setCard(this.root(event), asCanvasSetCardArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.removeCard, async (event, args) =>
      this.canvas.removeCard(this.root(event), asCanvasRemoveCardArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.setSize, async (event, args) =>
      this.canvas.setSize(this.root(event), asCanvasSetSizeArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.connect, async (event, args) =>
      this.canvas.connect(this.root(event), asCanvasConnectArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.disconnect, async (event, args) =>
      this.canvas.disconnect(this.root(event), asCanvasDisconnectArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.reconnect, async (event, args) =>
      this.canvas.reconnect(this.root(event), asCanvasReconnectArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.revision, (event) =>
      this.canvas.revision(this.root(event)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.relocate, async (event, args) =>
      this.canvas.relocate(this.root(event), asCanvasRelocateArgs(args)),
    );
    this.ipc.handle(CANVAS_IPC_CHANNELS.purgeNode, async (event, args) =>
      this.canvas.purgeNode(this.root(event), asCanvasPurgeNodeArgs(args)),
    );
  }

  private root(event: CanvasIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}

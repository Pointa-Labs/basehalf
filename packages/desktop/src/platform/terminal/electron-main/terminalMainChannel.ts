import { type WebContents, ipcMain, webContents } from 'electron';
import { TERMINAL_IPC_CHANNELS, type TerminalSpawnOpts } from '../common/terminal.js';
import type { TerminalMainService } from '../node/terminalMainService.js';

type TerminalIpcHandler = (event: TerminalIpcEvent, payload?: unknown) => unknown;

export interface IpcMainTerminalLike {
  handle(channel: string, listener: TerminalIpcHandler): void;
  on(channel: string, listener: TerminalIpcHandler): void;
}

export interface TerminalWebContentsLike {
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, payload: unknown) => void;
}

export interface TerminalWebContentsRegistry {
  fromId(id: number): TerminalWebContentsLike | undefined;
}

export type TerminalWorkspaceRootResolver = (sender: WebContents) => string | null;

interface TerminalIpcEvent {
  readonly sender: WebContents;
}

interface TerminalWritePayload {
  readonly id: string;
  readonly data: string;
}

interface TerminalResizePayload {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
}

interface TerminalKillPayload {
  readonly id: string;
}

/**
 * Electron IPC channel around the node pty service. This follows VS Code's
 * terminal split: pty ownership remains in the node service, while this layer
 * translates renderer messages and routes process events back to the owning
 * WebContents.
 */
export class TerminalMainChannel {
  constructor(
    private readonly terminal: TerminalMainService,
    private readonly getWorkspaceRoot: TerminalWorkspaceRootResolver,
    private readonly ipc: IpcMainTerminalLike = ipcMain,
    private readonly wcRegistry: TerminalWebContentsRegistry = webContents,
  ) {}

  register(): void {
    this.terminal.onDidWriteData(({ ownerWcId, id, data }) => {
      this.sendToOwner(ownerWcId, TERMINAL_IPC_CHANNELS.data, { id, data });
    });
    this.terminal.onDidExit(({ ownerWcId, id, exitCode }) => {
      this.sendToOwner(ownerWcId, TERMINAL_IPC_CHANNELS.exit, { id, exitCode });
    });

    this.ipc.handle(TERMINAL_IPC_CHANNELS.spawn, async (event, rawOpts) =>
      this.terminal.spawnTerminal(
        event.sender.id,
        this.getWorkspaceRoot(event.sender),
        (rawOpts ?? {}) as TerminalSpawnOpts,
      ),
    );

    this.ipc.on(TERMINAL_IPC_CHANNELS.write, (event, rawPayload) => {
      const payload = rawPayload as TerminalWritePayload;
      this.terminal.writeTerminal(event.sender.id, payload.id, payload.data);
    });

    this.ipc.on(TERMINAL_IPC_CHANNELS.resize, (event, rawPayload) => {
      const payload = rawPayload as TerminalResizePayload;
      this.terminal.resizeTerminal(event.sender.id, payload.id, payload.cols, payload.rows);
    });

    this.ipc.on(TERMINAL_IPC_CHANNELS.kill, (event, rawPayload) => {
      const payload = rawPayload as TerminalKillPayload;
      this.terminal.killTerminal(event.sender.id, payload.id);
    });
  }

  private sendToOwner(ownerWcId: number, channel: string, payload: unknown): void {
    const wc = this.wcRegistry.fromId(ownerWcId);
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }
}

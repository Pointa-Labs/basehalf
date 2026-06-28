import { type WebContents, ipcMain, webContents } from 'electron';
import {
  TERMINAL_IPC_CHANNELS,
  type TerminalKillPayload,
  type TerminalResizePayload,
  type TerminalSpawnOptions,
  type TerminalWritePayload,
} from '../common/terminal.js';
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
        asTerminalSpawnOptions(rawOpts),
      ),
    );

    this.ipc.on(TERMINAL_IPC_CHANNELS.write, (event, rawPayload) => {
      const payload = asTerminalWritePayload(rawPayload);
      if (payload === null) return;
      this.terminal.writeTerminal(event.sender.id, payload.id, payload.data);
    });

    this.ipc.on(TERMINAL_IPC_CHANNELS.resize, (event, rawPayload) => {
      const payload = asTerminalResizePayload(rawPayload);
      if (payload === null) return;
      this.terminal.resizeTerminal(event.sender.id, payload.id, payload.cols, payload.rows);
    });

    this.ipc.on(TERMINAL_IPC_CHANNELS.kill, (event, rawPayload) => {
      const payload = asTerminalKillPayload(rawPayload);
      if (payload === null) return;
      this.terminal.killTerminal(event.sender.id, payload.id);
    });
  }

  private sendToOwner(ownerWcId: number, channel: string, payload: unknown): void {
    const wc = this.wcRegistry.fromId(ownerWcId);
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }
}

function asTerminalSpawnOptions(raw: unknown): TerminalSpawnOptions {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const out: { cols?: number; rows?: number; cwd?: string } = {};
  if (typeof record.cols === 'number') out.cols = record.cols;
  if (typeof record.rows === 'number') out.rows = record.rows;
  if (typeof record.cwd === 'string') out.cwd = record.cwd;
  return out;
}

function asTerminalWritePayload(raw: unknown): TerminalWritePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.data === 'string'
    ? { id: record.id, data: record.data }
    : null;
}

function asTerminalResizePayload(raw: unknown): TerminalResizePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  return typeof record.id === 'string' &&
    typeof record.cols === 'number' &&
    typeof record.rows === 'number'
    ? { id: record.id, cols: record.cols, rows: record.rows }
    : null;
}

function asTerminalKillPayload(raw: unknown): TerminalKillPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  return typeof record.id === 'string' ? { id: record.id } : null;
}

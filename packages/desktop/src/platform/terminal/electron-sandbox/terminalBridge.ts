import type { Disposable, IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  TERMINAL_IPC_CHANNELS,
  type TerminalChannelBridge,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalKillPayload,
  type TerminalRawSpawnResult,
  type TerminalResizePayload,
  type TerminalSpawnOptions,
  type TerminalSpawnResult,
  type TerminalWritePayload,
  normalizeTerminalSpawnResult,
} from '../common/terminal.js';

export interface TerminalBridge extends Omit<TerminalChannelBridge, 'onData' | 'onExit'> {
  spawn(opts?: TerminalSpawnOptions): Promise<TerminalSpawnResult>;
  onData(handler: (id: string, data: string) => void): Disposable;
  onExit(handler: (id: string, exitCode: number) => void): Disposable;
}

export function createTerminalBridge(ipcRenderer: IpcRendererLike): TerminalBridge {
  return {
    spawn: async (opts = {}) =>
      normalizeTerminalSpawnResult(
        (await ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.spawn, opts)) as TerminalRawSpawnResult,
      ),
    write: (id, data) => {
      const payload: TerminalWritePayload = { id, data };
      ipcRenderer.send(TERMINAL_IPC_CHANNELS.write, payload);
    },
    resize: (id, cols, rows) => {
      const payload: TerminalResizePayload = { id, cols, rows };
      ipcRenderer.send(TERMINAL_IPC_CHANNELS.resize, payload);
    },
    kill: (id) => {
      const payload: TerminalKillPayload = { id };
      ipcRenderer.send(TERMINAL_IPC_CHANNELS.kill, payload);
    },
    onData: (handler) => {
      const wrapped = (_e: unknown, raw: unknown): void => {
        const payload = asTerminalDataEvent(raw);
        if (payload === null) return;
        handler(payload.id, payload.data);
      };
      ipcRenderer.on(TERMINAL_IPC_CHANNELS.data, wrapped);
      return () => ipcRenderer.off(TERMINAL_IPC_CHANNELS.data, wrapped);
    },
    onExit: (handler) => {
      const wrapped = (_e: unknown, raw: unknown): void => {
        const payload = asTerminalExitEvent(raw);
        if (payload === null) return;
        handler(payload.id, payload.exitCode);
      };
      ipcRenderer.on(TERMINAL_IPC_CHANNELS.exit, wrapped);
      return () => ipcRenderer.off(TERMINAL_IPC_CHANNELS.exit, wrapped);
    },
  };
}

function asTerminalDataEvent(raw: unknown): TerminalDataEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.data === 'string'
    ? { id: record.id, data: record.data }
    : null;
}

function asTerminalExitEvent(raw: unknown): TerminalExitEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.exitCode === 'number'
    ? { id: record.id, exitCode: record.exitCode }
    : null;
}

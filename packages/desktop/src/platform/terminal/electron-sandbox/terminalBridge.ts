import type { Disposable, IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import { TERMINAL_IPC_CHANNELS, type TerminalSpawnResult } from '../common/terminal.js';

export interface TerminalBridge {
  spawn(opts?: { cols?: number; rows?: number; cwd?: string }): Promise<TerminalSpawnResult>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  onData(handler: (id: string, data: string) => void): Disposable;
  onExit(handler: (id: string, exitCode: number) => void): Disposable;
}

export function createTerminalBridge(ipcRenderer: IpcRendererLike): TerminalBridge {
  return {
    spawn: (opts = {}) =>
      ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.spawn, opts) as Promise<TerminalSpawnResult>,
    write: (id, data) => {
      ipcRenderer.send(TERMINAL_IPC_CHANNELS.write, { id, data });
    },
    resize: (id, cols, rows) => {
      ipcRenderer.send(TERMINAL_IPC_CHANNELS.resize, { id, cols, rows });
    },
    kill: (id) => {
      ipcRenderer.send(TERMINAL_IPC_CHANNELS.kill, { id });
    },
    onData: (handler) => {
      const wrapped = (_e: unknown, raw: unknown): void => {
        const payload = raw as { id: string; data: string };
        handler(payload.id, payload.data);
      };
      ipcRenderer.on(TERMINAL_IPC_CHANNELS.data, wrapped);
      return () => ipcRenderer.off(TERMINAL_IPC_CHANNELS.data, wrapped);
    },
    onExit: (handler) => {
      const wrapped = (_e: unknown, raw: unknown): void => {
        const payload = raw as { id: string; exitCode: number };
        handler(payload.id, payload.exitCode);
      };
      ipcRenderer.on(TERMINAL_IPC_CHANNELS.exit, wrapped);
      return () => ipcRenderer.off(TERMINAL_IPC_CHANNELS.exit, wrapped);
    },
  };
}

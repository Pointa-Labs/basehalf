import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type {
  TerminalSpawnOptions,
  TerminalSpawnResult,
  TerminalSubscription,
} from './terminalService.js';

export interface TerminalChannel {
  spawn(opts?: TerminalSpawnOptions): Promise<TerminalSpawnResult>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  onData(handler: (id: string, data: string) => void): TerminalSubscription;
  onExit(handler: (id: string, exitCode: number) => void): TerminalSubscription;
}

export function createTerminalChannel(bridge: BaseHalfSandboxApi): TerminalChannel {
  return {
    spawn: (opts) => bridge.terminal.spawn(opts),
    write: (id, data) => bridge.terminal.write(id, data),
    resize: (id, cols, rows) => bridge.terminal.resize(id, cols, rows),
    kill: (id) => bridge.terminal.kill(id),
    onData: (handler) => bridge.terminal.onData(handler),
    onExit: (handler) => bridge.terminal.onExit(handler),
  };
}

export const terminalChannel: TerminalChannel = createLazySandboxChannel(createTerminalChannel);

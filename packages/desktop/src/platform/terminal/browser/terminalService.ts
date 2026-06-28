import { type TerminalChannel, terminalChannel } from './terminalChannel.js';

export type TerminalSubscription = () => void;

export interface TerminalSpawnOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly cwd?: string;
}

export type TerminalSpawnResult =
  | string
  | {
      readonly id: string;
      readonly cwd: string;
    };

export interface TerminalService {
  spawn(opts?: TerminalSpawnOptions): Promise<TerminalSpawnResult>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  onData(handler: (id: string, data: string) => void): TerminalSubscription;
  onExit(handler: (id: string, exitCode: number) => void): TerminalSubscription;
}

export function createTerminalService(channel: TerminalChannel): TerminalService {
  return {
    spawn: (opts) => channel.spawn(opts),
    write: (id, data) => channel.write(id, data),
    resize: (id, cols, rows) => channel.resize(id, cols, rows),
    kill: (id) => channel.kill(id),
    onData: (handler) => channel.onData(handler),
    onExit: (handler) => channel.onExit(handler),
  };
}

export const terminalService = createTerminalService(terminalChannel);

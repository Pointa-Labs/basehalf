export interface TerminalSpawnOpts {
  readonly cols?: number;
  readonly rows?: number;
  readonly cwd?: string;
}

export interface TerminalSpawnResult {
  readonly id: string;
  readonly cwd: string;
}

export interface TerminalDataEvent {
  readonly id: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly id: string;
  readonly exitCode: number;
}

export const TERMINAL_IPC_CHANNELS = {
  spawn: 'terminal:spawn',
  write: 'terminal:write',
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  data: 'terminal:data',
  exit: 'terminal:exit',
} as const;

export type TerminalIpcChannel = (typeof TERMINAL_IPC_CHANNELS)[keyof typeof TERMINAL_IPC_CHANNELS];

export type TerminalSubscription = () => void;

export interface TerminalSpawnOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly cwd?: string;
}

export interface TerminalSpawnResult {
  readonly id: string;
  readonly cwd?: string;
}

export type TerminalRawSpawnResult = string | TerminalSpawnResult;

export function normalizeTerminalSpawnResult(raw: TerminalRawSpawnResult): TerminalSpawnResult {
  return typeof raw === 'string' ? { id: raw } : raw;
}

export interface TerminalDataEvent {
  readonly id: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly id: string;
  readonly exitCode: number;
}

export interface TerminalWritePayload {
  readonly id: string;
  readonly data: string;
}

export interface TerminalResizePayload {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalKillPayload {
  readonly id: string;
}

export interface TerminalChannelBridge {
  spawn(opts?: TerminalSpawnOptions): Promise<TerminalSpawnResult>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  onData(handler: (id: string, data: string) => void): TerminalSubscription;
  onExit(handler: (id: string, exitCode: number) => void): TerminalSubscription;
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

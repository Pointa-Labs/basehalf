export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate'; version: string }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; received: number; total: number }
  | { phase: 'staged'; version: string }
  | { phase: 'error'; message: string };

export interface JustInstalled {
  readonly version: string;
  readonly notes: string;
}

export const UPDATE_IPC_CHANNELS = {
  getState: 'update:get-state',
  check: 'update:check',
  download: 'update:download',
  install: 'update:install',
  justInstalled: 'update:just-installed',
  state: 'update:state',
} as const;

export type UpdateIpcChannel = (typeof UPDATE_IPC_CHANNELS)[keyof typeof UPDATE_IPC_CHANNELS];

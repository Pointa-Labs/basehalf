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

export type UpdateDisposable = () => void;

export interface UpdateChannelBridge {
  getState(): Promise<UpdateState>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  justInstalled(): Promise<JustInstalled | null>;
  onState(handler: (state: UpdateState) => void): UpdateDisposable;
}

export interface UpdateService extends UpdateChannelBridge {}

export interface UpdateSandboxBridge {
  updateGetState(): Promise<UpdateState>;
  updateCheck(): Promise<void>;
  updateDownload(): Promise<void>;
  updateInstall(): Promise<void>;
  updateJustInstalled(): Promise<JustInstalled | null>;
  onUpdateState(handler: (state: UpdateState) => void): UpdateDisposable;
}

export interface UpdateMainService {
  getState(): UpdateState;
  check(opts: { readonly background: boolean }): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  consumeJustInstalled(): JustInstalled | null;
}

export function asUpdateState(raw: unknown): UpdateState {
  if (typeof raw !== 'object' || raw === null) return { phase: 'idle' };
  const value = raw as Record<string, unknown>;
  switch (value.phase) {
    case 'idle':
      return { phase: 'idle' };
    case 'checking':
      return { phase: 'checking' };
    case 'upToDate':
      return typeof value.version === 'string'
        ? { phase: 'upToDate', version: value.version }
        : { phase: 'idle' };
    case 'available':
      return typeof value.version === 'string'
        ? { phase: 'available', version: value.version }
        : { phase: 'idle' };
    case 'downloading':
      return typeof value.version === 'string' &&
        typeof value.received === 'number' &&
        typeof value.total === 'number'
        ? {
            phase: 'downloading',
            version: value.version,
            received: value.received,
            total: value.total,
          }
        : { phase: 'idle' };
    case 'staged':
      return typeof value.version === 'string'
        ? { phase: 'staged', version: value.version }
        : { phase: 'idle' };
    case 'error':
      return typeof value.message === 'string'
        ? { phase: 'error', message: value.message }
        : { phase: 'idle' };
    default:
      return { phase: 'idle' };
  }
}

export function asJustInstalled(raw: unknown): JustInstalled | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.version === 'string' &&
    typeof value.notes === 'string' &&
    value.notes.length > 0
  ) {
    return { version: value.version, notes: value.notes };
  }
  return null;
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

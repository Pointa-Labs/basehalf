// Desktop watcher event contract. Main/browser forwarding depends on this common
// boundary instead of a generic command bus.
export type WatcherEventType = 'add' | 'change' | 'unlink' | 'rename';

export interface WatcherFsEvent {
  readonly type: 'add' | 'change' | 'unlink';
  readonly absPath: string;
  readonly relPath: string;
  readonly isDir: boolean;
}

export interface WatcherRenameEvent {
  readonly type: 'rename';
  readonly fromRelPath: string;
  readonly toRelPath: string;
  readonly isDir: boolean;
}

export type WatcherEvent = WatcherFsEvent | WatcherRenameEvent;
export type WatcherHostEvent = WatcherEvent & { readonly workspaceRoot: string };

export type WorkspaceFileEvent =
  | {
      readonly type: 'add' | 'change' | 'unlink';
      readonly relPath: string;
      readonly isDir: boolean;
    }
  | {
      readonly type: 'rename';
      readonly fromRelPath: string;
      readonly toRelPath: string;
      readonly isDir: boolean;
    };

export type FileEventSubscription = () => void;

export interface FileEventChannelBridge {
  onDidChangeFiles(handler: (event: WorkspaceFileEvent) => void): FileEventSubscription;
}

export interface FileEventService extends FileEventChannelBridge {}

export interface FileEventBridge {
  onFileEvent(handler: (event: WorkspaceFileEvent) => void): FileEventSubscription;
}

export function asWorkspaceFileEvent(event: unknown): WorkspaceFileEvent | null {
  if (typeof event !== 'object' || event === null) return null;
  const raw = event as Record<string, unknown>;
  const isDir = typeof raw.isDir === 'boolean' ? raw.isDir : null;
  if (isDir === null) return null;
  if (raw.type === 'add' || raw.type === 'change' || raw.type === 'unlink') {
    return typeof raw.relPath === 'string' && isSafeRelativePath(raw.relPath)
      ? { type: raw.type, relPath: raw.relPath, isDir }
      : null;
  }
  if (raw.type === 'rename') {
    return typeof raw.fromRelPath === 'string' &&
      typeof raw.toRelPath === 'string' &&
      isSafeRelativePath(raw.fromRelPath) &&
      isSafeRelativePath(raw.toRelPath)
      ? {
          type: 'rename',
          fromRelPath: raw.fromRelPath,
          toRelPath: raw.toRelPath,
          isDir,
        }
      : null;
  }
  return null;
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\0')) return false;
  if (/^([a-zA-Z]:|[\\/])/.test(path)) return false;
  return !path
    .split(/[\\/]/)
    .some((segment) => segment === '' || segment === '.' || segment === '..');
}

export const WATCHER_IPC_CHANNELS = {
  fileEvent: 'bh:file-event',
} as const;

export type WatcherIpcChannel = (typeof WATCHER_IPC_CHANNELS)[keyof typeof WATCHER_IPC_CHANNELS];

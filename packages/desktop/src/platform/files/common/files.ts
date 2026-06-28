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
  readonly toAbsPath: string;
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
      readonly toAbsPath: string;
      readonly isDir: boolean;
    };

export const WATCHER_IPC_CHANNELS = {
  fileEvent: 'bh:file-event',
} as const;

export type WatcherIpcChannel = (typeof WATCHER_IPC_CHANNELS)[keyof typeof WATCHER_IPC_CHANNELS];

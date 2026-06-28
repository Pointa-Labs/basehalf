import type { Disposable, IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import { WATCHER_IPC_CHANNELS, type WorkspaceFileEvent } from '../common/files.js';

export type { WorkspaceFileEvent };

export interface FileEventBridge {
  onFileEvent(handler: (event: WorkspaceFileEvent) => void): Disposable;
}

export function createFileEventBridge(ipcRenderer: IpcRendererLike): FileEventBridge {
  return {
    onFileEvent: (handler) => {
      const wrapped = (_e: unknown, event: unknown): void => {
        const sanitized = sanitizeWorkspaceFileEvent(event);
        if (sanitized) handler(sanitized);
      };
      ipcRenderer.on(WATCHER_IPC_CHANNELS.fileEvent, wrapped);
      return () => ipcRenderer.off(WATCHER_IPC_CHANNELS.fileEvent, wrapped);
    },
  };
}

function sanitizeWorkspaceFileEvent(event: unknown): WorkspaceFileEvent | null {
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
      typeof raw.toAbsPath === 'string' &&
      isSafeRelativePath(raw.fromRelPath) &&
      isSafeRelativePath(raw.toRelPath)
      ? {
          type: 'rename',
          fromRelPath: raw.fromRelPath,
          toRelPath: raw.toRelPath,
          toAbsPath: raw.toAbsPath,
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

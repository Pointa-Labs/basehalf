import { BrowserWindow, type WebContents } from 'electron';
import { WATCHER_IPC_CHANNELS, type WatcherHostEvent } from '../common/files.js';

export interface WatcherEventSource {
  on(event: 'event', listener: (event: WatcherHostEvent) => void): unknown;
}

export interface WatcherEventForwarderMainServiceOptions {
  readonly events: WatcherEventSource;
  readonly getWorkspaceRoot: (wc: WebContents) => string | null;
}

/**
 * Routes file watcher events only to windows bound to the originating workspace.
 * This keeps the file-observer bridge separate from app startup, matching the
 * VS Code pattern of narrow main-process services connected by events.
 */
export class WatcherEventForwarderMainService {
  constructor(private readonly opts: WatcherEventForwarderMainServiceOptions) {}

  register(): void {
    this.opts.events.on('event', (event) => this.forward(event));
  }

  forward(event: WatcherHostEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      if (this.opts.getWorkspaceRoot(win.webContents) === event.workspaceRoot) {
        win.webContents.send(WATCHER_IPC_CHANNELS.fileEvent, event);
      }
    }
  }
}

import { type WebContents, ipcMain } from 'electron';
import { SETTINGS_IPC_CHANNELS, asSettingsSetPayload } from '../common/configuration.js';
import type { SettingsMainService } from './configurationMainService.js';

type SettingsIpcHandler = (event: SettingsIpcEvent, payload?: unknown) => unknown;

export interface IpcMainSettingsLike {
  handle(channel: string, listener: SettingsIpcHandler): void;
}

export type SettingsWorkspaceRootResolver = (sender: WebContents) => string | null;

interface SettingsIpcEvent {
  readonly sender: WebContents;
}

/**
 * Electron IPC channel for app settings and window zoom commands. It keeps the
 * renderer protocol stable while making the main-process settings behavior a
 * small service, aligned with VS Code's service/channel boundary.
 */
export class SettingsMainChannel {
  constructor(
    private readonly settings: SettingsMainService,
    private readonly getWorkspaceRoot: SettingsWorkspaceRootResolver,
    private readonly ipc: IpcMainSettingsLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(SETTINGS_IPC_CHANNELS.appVersion, () => this.settings.getAppVersion());
    this.ipc.handle(SETTINGS_IPC_CHANNELS.prefsGet, () => this.settings.getPrefs());
    this.ipc.handle(SETTINGS_IPC_CHANNELS.prefsSet, (_event, patch: unknown) =>
      this.settings.setPrefs(patch),
    );
    this.ipc.handle(SETTINGS_IPC_CHANNELS.windowZoom, (_event, action: unknown): void => {
      this.settings.zoomWindow(action);
    });
    this.ipc.handle(SETTINGS_IPC_CHANNELS.describe, (event) =>
      this.settings.describe(this.root(event)),
    );
    this.ipc.handle(SETTINGS_IPC_CHANNELS.inspect, (event, key) =>
      this.settings.inspect(this.root(event), key as string),
    );
    this.ipc.handle(SETTINGS_IPC_CHANNELS.get, (event, key) =>
      this.settings.get(this.root(event), key as string),
    );
    this.ipc.handle(SETTINGS_IPC_CHANNELS.setGlobal, (event, payload) => {
      const p = asSettingsSetPayload(payload);
      if (p === null) throw new Error('Invalid settings:set-global payload');
      return this.settings.setGlobal(this.root(event), p.key, p.value);
    });
    this.ipc.handle(SETTINGS_IPC_CHANNELS.setWorkspace, (event, payload) => {
      const p = asSettingsSetPayload(payload);
      if (p === null) throw new Error('Invalid settings:set-workspace payload');
      return this.settings.setWorkspace(this.root(event), p.key, p.value);
    });
    this.ipc.handle(SETTINGS_IPC_CHANNELS.clearWorkspace, (event, key) =>
      this.settings.clearWorkspace(this.root(event), key as string),
    );
  }

  private root(event: SettingsIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}

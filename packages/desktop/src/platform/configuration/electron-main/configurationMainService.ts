import packageJson from '../../../../package.json' with { type: 'json' };
import type { Prefs } from '../../storage/electron-main/prefsStore.js';
import type { WindowZoomHooks } from '../../windows/electron-main/windowZoomMainService.js';
import type {
  SettingInspect,
  SettingValue,
  SettingsDescribeResult,
  SettingsGetResult,
} from '../common/configuration.js';
import type { SettingsRegistryProvider } from './configurationRegistryProvider.js';

export interface SettingsPrefsStore {
  get(): Prefs;
  set(patch: unknown): Prefs;
}

export interface SettingsMainServiceOptions {
  readonly appVersion?: string;
  readonly prefs: SettingsPrefsStore;
  readonly registry: SettingsRegistryProvider;
  readonly zoom: WindowZoomHooks;
}

/**
 * Main-process user settings service. Mirrors VS Code's configuration-service
 * shape at BaseHalf scale: IPC asks a service to read/update settings, while
 * the service owns app preference semantics and window zoom commands.
 */
export class SettingsMainService {
  private readonly appVersion: string;
  private readonly prefs: SettingsPrefsStore;
  private readonly registry: SettingsRegistryProvider;
  private readonly zoom: WindowZoomHooks;

  constructor(opts: SettingsMainServiceOptions) {
    this.appVersion = opts.appVersion ?? packageJson.version;
    this.prefs = opts.prefs;
    this.registry = opts.registry;
    this.zoom = opts.zoom;
  }

  getAppVersion(): string {
    return this.appVersion;
  }

  getPrefs(): Prefs {
    return this.prefs.get();
  }

  setPrefs(patch: unknown): Prefs {
    return this.prefs.set(patch);
  }

  describe(workspaceRoot: string | null): Promise<SettingsDescribeResult> {
    return this.registry.describe(workspaceRoot);
  }

  inspect(workspaceRoot: string | null, key: string): Promise<SettingInspect> {
    return this.registry.inspect(workspaceRoot, key);
  }

  get(workspaceRoot: string | null, key: string): Promise<SettingsGetResult> {
    return this.registry.get(workspaceRoot, key);
  }

  setGlobal(
    workspaceRoot: string | null,
    key: string,
    value: SettingValue,
  ): Promise<SettingInspect> {
    return this.registry.setGlobal(workspaceRoot, key, value);
  }

  setWorkspace(
    workspaceRoot: string | null,
    key: string,
    value: SettingValue,
  ): Promise<SettingInspect> {
    return this.registry.setWorkspace(workspaceRoot, key, value);
  }

  clearWorkspace(workspaceRoot: string | null, key: string): Promise<SettingInspect> {
    return this.registry.clearWorkspace(workspaceRoot, key);
  }

  zoomWindow(action: unknown): void {
    if (action === 'in') this.zoom.applyZoomLevel(this.zoom.getZoomLevel() + 1);
    else if (action === 'out') this.zoom.applyZoomLevel(this.zoom.getZoomLevel() - 1);
    else if (action === 'reset') this.zoom.applyZoomLevel(0);
  }
}

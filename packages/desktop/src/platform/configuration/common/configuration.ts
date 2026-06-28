export type SettingScope = 'global' | 'workspace';
export type SettingType = 'boolean';
export type SettingValue = boolean;

export interface SettingDescriptor {
  readonly key: string;
  readonly scope: SettingScope;
  readonly type: SettingType;
  readonly default: SettingValue;
  readonly label: string;
  readonly description: string;
}

export interface SettingInspect {
  readonly key: string;
  readonly scope: SettingScope;
  readonly type: SettingType;
  readonly defaultValue: SettingValue;
  readonly globalValue?: SettingValue;
  readonly workspaceValue?: SettingValue;
  readonly value: SettingValue;
}

export type SettingsDescribeResult = readonly SettingDescriptor[];
export type SettingsGetResult = SettingValue;

export const SETTINGS_IPC_CHANNELS = {
  appVersion: 'app:version',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  windowZoom: 'window:zoom',
  describe: 'settings:describe',
  inspect: 'settings:inspect',
  get: 'settings:get',
  setGlobal: 'settings:set-global',
  setWorkspace: 'settings:set-workspace',
  clearWorkspace: 'settings:clear-workspace',
} as const;

export type SettingsIpcChannel = (typeof SETTINGS_IPC_CHANNELS)[keyof typeof SETTINGS_IPC_CHANNELS];

export interface SettingsChannelBridge {
  describe(): Promise<SettingsDescribeResult>;
  inspect(key: string): Promise<SettingInspect>;
  get(key: string): Promise<SettingsGetResult>;
  setGlobal(key: string, value: SettingValue): Promise<SettingInspect>;
  setWorkspace(key: string, value: SettingValue): Promise<SettingInspect>;
  clearWorkspace(key: string): Promise<SettingInspect>;
}

export interface SettingsService extends SettingsChannelBridge {}

export interface SettingsBridge {
  readonly settings: SettingsChannelBridge;
}

export interface SettingsSetPayload {
  readonly key: string;
  readonly value: SettingValue;
}

export function asSettingsSetPayload(raw: unknown): SettingsSetPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.key === 'string' && typeof value.value === 'boolean') {
    return { key: value.key, value: value.value };
  }
  return null;
}

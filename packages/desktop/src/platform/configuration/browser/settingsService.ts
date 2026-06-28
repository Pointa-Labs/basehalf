import type {
  SettingInspect,
  SettingValue,
  SettingsDescribeResult,
  SettingsGetResult,
} from '../common/configuration.js';
import { type SettingsChannel, settingsChannel } from './settingsChannel.js';

export interface SettingsService {
  describe(): Promise<SettingsDescribeResult>;
  inspect(key: string): Promise<SettingInspect>;
  get(key: string): Promise<SettingsGetResult>;
  setGlobal(key: string, value: SettingValue): Promise<SettingInspect>;
  setWorkspace(key: string, value: SettingValue): Promise<SettingInspect>;
  clearWorkspace(key: string): Promise<SettingInspect>;
}

export function createSettingsService(channel: SettingsChannel): SettingsService {
  return {
    describe: () => channel.describe(),
    inspect: (key) => channel.inspect(key),
    get: (key) => channel.get(key),
    setGlobal: (key, value) => channel.setGlobal(key, value),
    setWorkspace: (key, value) => channel.setWorkspace(key, value),
    clearWorkspace: (key) => channel.clearWorkspace(key),
  };
}

export const settingsService = createSettingsService(settingsChannel);

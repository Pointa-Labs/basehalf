import type { SettingsService as SettingsServiceContract } from '../common/configuration.js';
import { type SettingsChannel, settingsChannel } from './settingsChannel.js';

export type { SettingsService } from '../common/configuration.js';

export function createSettingsService(channel: SettingsChannel): SettingsServiceContract {
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

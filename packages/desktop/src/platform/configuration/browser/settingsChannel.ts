import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { SettingsChannelBridge } from '../common/configuration.js';

export interface SettingsChannel extends SettingsChannelBridge {}

export function createSettingsChannel(bridge: BaseHalfSandboxApi): SettingsChannel {
  return bridge.settings;
}

export const settingsChannel: SettingsChannel = createLazySandboxChannel(createSettingsChannel);

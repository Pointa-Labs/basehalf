import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { UpdateChannelBridge } from '../common/update.js';

export interface UpdateChannel extends UpdateChannelBridge {}

export function createUpdateChannel(bridge: BaseHalfSandboxApi): UpdateChannel {
  return {
    getState: () => bridge.updateGetState(),
    check: () => bridge.updateCheck(),
    download: () => bridge.updateDownload(),
    install: () => bridge.updateInstall(),
    justInstalled: () => bridge.updateJustInstalled(),
    onState: (handler) => bridge.onUpdateState(handler),
  };
}

export const updateChannel: UpdateChannel = createLazySandboxChannel(createUpdateChannel);

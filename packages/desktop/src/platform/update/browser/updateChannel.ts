import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';

type Disposable = () => void;

export interface UpdateChannel {
  getState(): Promise<unknown>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  justInstalled(): Promise<unknown>;
  onState(handler: (state: unknown) => void): Disposable;
}

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

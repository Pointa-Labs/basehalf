import { type UpdateChannel, updateChannel } from './updateChannel.js';

type Disposable = () => void;

export interface UpdateService {
  getState(): Promise<unknown>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  justInstalled(): Promise<unknown>;
  onState(handler: (state: unknown) => void): Disposable;
}

export function createUpdateService(channel: UpdateChannel): UpdateService {
  return {
    getState: () => channel.getState(),
    check: () => channel.check(),
    download: () => channel.download(),
    install: () => channel.install(),
    justInstalled: () => channel.justInstalled(),
    onState: (handler) => channel.onState(handler),
  };
}

export const updateService = createUpdateService(updateChannel);

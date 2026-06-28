import type { UpdateService as UpdateServiceContract } from '../common/update.js';
import { type UpdateChannel, updateChannel } from './updateChannel.js';

export type { UpdateService } from '../common/update.js';

export function createUpdateService(channel: UpdateChannel): UpdateServiceContract {
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

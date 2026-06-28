import type { AdhdService as AdhdServiceContract } from '../common/adhd.js';
import { type AdhdChannel, adhdChannel } from './adhdChannel.js';

export type { AdhdService } from '../common/adhd.js';

export function createAdhdService(channel: AdhdChannel): AdhdServiceContract {
  return {
    get: (file) => channel.get(file),
    addKeyword: (file, keyword) => channel.addKeyword({ file, keyword }),
    removeKeyword: (file, keyword) => channel.removeKeyword({ file, keyword }),
    markRead: (file, { start, end }) => channel.markRead({ file, start, end }),
    markUnread: (file, { start, end }) => channel.markUnread({ file, start, end }),
    set: (file, state) => channel.set({ file, ...state }),
  };
}

export const adhdService = createAdhdService(adhdChannel);

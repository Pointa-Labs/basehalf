import type { BadgeService as BadgeServiceContract } from '../common/badge.js';
import { type BadgeChannel, badgeChannel } from './badgeChannel.js';

export type { BadgeService } from '../common/badge.js';

export function createBadgeService(channel: BadgeChannel): BadgeServiceContract {
  return {
    get: (file, kind) => channel.get(kind === undefined ? { file } : { file, kind }),
    set: (file, patch) => channel.set(patch === undefined ? { file } : { file, patch }),
    list: async (args = {}) => {
      const result = await channel.list(args);
      return result.badges;
    },
    addReference: (file, to, kind) =>
      channel.addRef(kind === undefined ? { file, to } : { file, to, kind }),
    removeReference: (file, to, kind) =>
      channel.removeRef(kind === undefined ? { file, to } : { file, to, kind }),
    pruneDangling: () => channel.pruneDangling(),
    revision: () => channel.revision(),
  };
}

export const badgeService = createBadgeService(badgeChannel);

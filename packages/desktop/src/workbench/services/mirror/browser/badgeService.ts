import type {
  BadgeFile,
  BadgeGetResult,
  BadgeKind,
  BadgePatch,
  BadgePruneDanglingResult,
  BadgeRevisionResult,
} from '../common/badge.js';
import { type BadgeChannel, badgeChannel } from './badgeChannel.js';

export interface BadgeService {
  get(file: string, kind?: BadgeKind): Promise<BadgeGetResult>;
  set(file: string, patch?: BadgePatch): Promise<BadgeFile>;
  list(args?: { kind?: BadgeKind; query?: string }): Promise<readonly BadgeFile[]>;
  addReference(file: string, to: string, kind?: BadgeKind): Promise<BadgeFile>;
  removeReference(file: string, to: string, kind?: BadgeKind): Promise<BadgeFile>;
  pruneDangling(): Promise<BadgePruneDanglingResult>;
  revision(): Promise<BadgeRevisionResult>;
}

export function createBadgeService(channel: BadgeChannel): BadgeService {
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

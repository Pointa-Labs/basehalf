import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type { BadgeChannelBridge } from '../common/badge.js';

export interface BadgeChannel extends BadgeChannelBridge {}

export function createBadgeChannel(bridge: BaseHalfSandboxApi): BadgeChannel {
  return bridge.badge;
}

export const badgeChannel: BadgeChannel = createLazySandboxChannel(createBadgeChannel);

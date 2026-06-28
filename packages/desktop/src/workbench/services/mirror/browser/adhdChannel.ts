import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type { AdhdChannelBridge } from '../common/adhd.js';

export interface AdhdChannel extends AdhdChannelBridge {}

export function createAdhdChannel(bridge: BaseHalfSandboxApi): AdhdChannel {
  return bridge.adhd;
}

export const adhdChannel: AdhdChannel = createLazySandboxChannel(createAdhdChannel);

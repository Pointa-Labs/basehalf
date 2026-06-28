import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type { SearchChannelBridge } from '../common/search.js';

export interface SearchChannel extends SearchChannelBridge {}

export function createSearchChannel(bridge: BaseHalfSandboxApi): SearchChannel {
  return bridge.search;
}

export const searchChannel: SearchChannel = createLazySandboxChannel(createSearchChannel);

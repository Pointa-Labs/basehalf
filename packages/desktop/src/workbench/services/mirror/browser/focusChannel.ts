import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type { FocusChannelBridge } from '../common/focus.js';

export interface FocusChannel extends FocusChannelBridge {}

export function createFocusChannel(bridge: BaseHalfSandboxApi): FocusChannel {
  return bridge.focus;
}

export const focusChannel: FocusChannel = createLazySandboxChannel(createFocusChannel);

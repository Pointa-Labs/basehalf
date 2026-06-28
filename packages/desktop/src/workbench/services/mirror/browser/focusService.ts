import type { FocusNode, FocusPruneDanglingResult, FocusSetArgs } from '../common/focus.js';
import { type FocusChannel, focusChannel } from './focusChannel.js';

export interface FocusService {
  set(args: FocusSetArgs): Promise<FocusNode>;
  pruneDangling(): Promise<FocusPruneDanglingResult>;
}

export function createFocusService(channel: FocusChannel): FocusService {
  return {
    set: (args) => channel.set(args),
    pruneDangling: () => channel.pruneDangling(),
  };
}

export const focusService = createFocusService(focusChannel);

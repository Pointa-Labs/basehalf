import type { FocusService as FocusServiceContract } from '../common/focus.js';
import { type FocusChannel, focusChannel } from './focusChannel.js';

export type { FocusService } from '../common/focus.js';

export function createFocusService(channel: FocusChannel): FocusServiceContract {
  return {
    set: (args) => channel.set(args),
    pruneDangling: () => channel.pruneDangling(),
  };
}

export const focusService = createFocusService(focusChannel);

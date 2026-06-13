// The single home for badge-metadata WRITES from the renderer (references +
// prompt). Every mutation goes through here and emits on the badge bus
// automatically — so no call site can forget to notify the other views. That
// omission is exactly how the canvas→panel sync used to silently break: the
// panel hand-called emitBadgeChange() after each write, the canvas didn't.
//
// Reads stay on `window.bh.run` directly; only writes carry a change signal.
// Canvas position writes (badge.set on drag) are deliberately NOT here — a
// position isn't shown in another view, so it needs no cross-view notification.
import type {
  BadgeAddRefArgs,
  BadgeFile,
  BadgeKind,
  BadgeReconnectRefArgs,
  BadgeReconnectRefResult,
  BadgeRemoveRefArgs,
} from '@basehalf/core';
import { type BadgeChangeOrigin, emitBadgeChange } from './badgeBus.js';

async function mutate<T>(command: string, args: unknown, origin: BadgeChangeOrigin): Promise<T> {
  const result = (await window.bh.run(command, args)) as T;
  emitBadgeChange(origin); // only on success — a throw skips the notify
  return result;
}

export const badgeMutations = {
  addRef: (args: BadgeAddRefArgs, origin: BadgeChangeOrigin): Promise<BadgeFile> =>
    mutate('badge.addRef', args, origin),

  removeRef: (args: BadgeRemoveRefArgs, origin: BadgeChangeOrigin): Promise<BadgeFile> =>
    mutate('badge.removeRef', args, origin),

  reconnectRef: (
    args: BadgeReconnectRefArgs,
    origin: BadgeChangeOrigin,
  ): Promise<BadgeReconnectRefResult> => mutate('badge.reconnectRef', args, origin),

  setPrompt: (
    file: string,
    prompt: string,
    origin: BadgeChangeOrigin,
    kind: BadgeKind = 'file',
  ): Promise<BadgeFile> => mutate('badge.set', { file, patch: { kind, prompt } }, origin),
};

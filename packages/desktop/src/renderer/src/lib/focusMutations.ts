// The single home for FOCUS WRITES from the renderer (the agent-context set +
// turn intent). Mirrors lib/badgeMutations: every mutation emits on the shared
// bus automatically, so no call site can forget to notify the other views. That
// omission is exactly how the canvas→panel sync broke: a card multi-select or a
// "Clear" wrote focus.md but never signalled, so an open file's badge panel kept
// showing "Remove from Context" on a file no longer in the brief — and clicking
// that stale button (which reads authoritative state) did the OPPOSITE. Routing
// every focus write through here keeps `isFocused` consistent across surfaces.
//
// Reads stay on `window.bh.run` directly; only writes carry a change signal.
import type { FocusSetResult } from '@basehalf/core';
import { type BadgeChangeOrigin, emitBadgeChange } from './badgeBus.js';

async function mutate<T>(command: string, args: unknown, origin: BadgeChangeOrigin): Promise<T> {
  const result = (await window.bh.run(command, args)) as T;
  emitBadgeChange(origin); // only on success — a throw skips the notify
  return result;
}

export const focusMutations = {
  setFiles: (files: readonly string[], origin: BadgeChangeOrigin): Promise<FocusSetResult> =>
    mutate('focus.set', { files }, origin),

  setFolder: (folder: string, origin: BadgeChangeOrigin): Promise<FocusSetResult> =>
    mutate('focus.set', { folder }, origin),

  clear: (origin: BadgeChangeOrigin): Promise<{ cleared: boolean }> =>
    mutate('focus.clear', {}, origin),

  setIntent: (
    intent: string | undefined,
    origin: BadgeChangeOrigin,
  ): Promise<{ intent: string | null; skipped?: boolean }> =>
    mutate('focus.setIntent', intent === undefined ? {} : { intent }, origin),

  toggleActiveFile: (
    file: string,
    origin: BadgeChangeOrigin,
  ): Promise<{ active: string[]; isFocused: boolean }> =>
    mutate('focus.toggleActiveFile', { file }, origin),
};

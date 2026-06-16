// The single home for badge + canvas WRITES from the renderer. Every mutation
// goes through here and emits on the badge bus automatically — so no call site
// can forget to notify the other views. That omission is exactly how the
// canvas→panel sync used to silently break: the panel hand-called
// emitBadgeChange() after each write, the canvas didn't.
//
// Reads stay on `window.bh.run` directly; only writes carry a change signal.
// Canvas position writes (canvas.setCard on drag) are deliberately NOT routed
// through the bus — a position isn't shown in another view, so it needs no
// cross-view notification (see Canvas.persistCanvas/persistSize, which call
// canvas.setCard directly).
//
// The reference graph now lives in TWO layers kept in lockstep by core: the
// semantic `badge.references` (plain paths) and the visual `canvas` edge
// (anchors + label). The canvas draws/edits via canvas.connect/disconnect/
// reconnect, which write BOTH; the badge panel edits the semantic side via
// badge.addRef/removeRef. Both still ripple the inbound (`referenced_by`) graph.
import type {
  BadgeAddRefArgs,
  BadgeFile,
  BadgeKind,
  BadgeRemoveRefArgs,
  CanvasConnectArgs,
  CanvasDisconnectArgs,
  CanvasFile,
  CanvasReconnectArgs,
  CanvasSetCardArgs,
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

  // The badge's human-authored description (was `prompt`). `kind` is required only
  // on the first set() that materializes the badge; passing it always is harmless.
  setDescription: (
    file: string,
    description: string,
    origin: BadgeChangeOrigin,
    kind: BadgeKind = 'file',
  ): Promise<BadgeFile> => mutate('badge.set', { file, patch: { kind, description } }, origin),

  // Draw an edge: writes the canvas edge AND the badge.references link in lockstep.
  connect: (args: CanvasConnectArgs, origin: BadgeChangeOrigin): Promise<CanvasFile> =>
    mutate('canvas.connect', args, origin),

  // Delete an edge: drops the canvas edge AND the badge reference.
  disconnect: (args: CanvasDisconnectArgs, origin: BadgeChangeOrigin): Promise<CanvasFile> =>
    mutate('canvas.disconnect', args, origin),

  // Move/relabel an edge: rewrites the canvas edge and (when endpoints change)
  // moves the badge reference.
  reconnect: (args: CanvasReconnectArgs, origin: BadgeChangeOrigin): Promise<CanvasFile> =>
    mutate('canvas.reconnect', args, origin),

  // Persist a card's position/size to the folder's canvas.yaml. NOT bus-emitting:
  // a position isn't surfaced in another view (callers pass a no-op origin only to
  // satisfy the shared signature — see Canvas.persistCanvas, which calls
  // canvas.setCard directly without the bus).
  setCard: (args: CanvasSetCardArgs): Promise<CanvasFile> =>
    window.bh.run('canvas.setCard', args) as Promise<CanvasFile>,
};

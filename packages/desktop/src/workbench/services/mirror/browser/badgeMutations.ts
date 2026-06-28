// The single home for badge + canvas WRITES from the renderer. Every mutation
// goes through here and emits on the badge bus automatically — so no call site
// can forget to notify the other views. That omission is exactly how the
// canvas→panel sync used to silently break: the panel hand-called
// emitBadgeChange() after each write, the canvas didn't.
//
// Only writes carry a change signal. Canvas position writes (canvas.setCard on
// drag) are deliberately NOT routed through the bus — a position isn't shown in
// another view, so it needs no cross-view notification.
//
// The reference graph now lives in TWO layers kept in lockstep by core: the
// semantic `badge.references` (plain paths) and the visual `canvas` edge
// (anchors + label). The canvas draws/edits via canvas.connect/disconnect/
// reconnect, which write BOTH; the badge panel edits the semantic side via
// badge.addRef/removeRef. Both still ripple the inbound (`referenced_by`) graph.
import type { BadgeAddRefArgs, BadgeFile, BadgeKind, BadgeRemoveRefArgs } from '../common/badge.js';
import type {
  CanvasConnectArgs,
  CanvasDisconnectArgs,
  CanvasFile,
  CanvasReconnectArgs,
  CanvasSetCardArgs,
} from '../common/canvas.js';
import { type BadgeChangeOrigin, emitBadgeChange } from './badgeBus.js';
import { badgeService } from './badgeService.js';
import { canvasMirrorService } from './canvasMirrorService.js';

async function mutate<T>(fn: () => Promise<T>, origin: BadgeChangeOrigin): Promise<T> {
  const result = await fn();
  emitBadgeChange(origin); // only on success — a throw skips the notify
  return result;
}

export const badgeMutations = {
  addRef: (args: BadgeAddRefArgs, origin: BadgeChangeOrigin): Promise<BadgeFile> =>
    mutate(() => badgeService.addReference(args.file, args.to, args.kind), origin),

  removeRef: (args: BadgeRemoveRefArgs, origin: BadgeChangeOrigin): Promise<BadgeFile> =>
    mutate(() => badgeService.removeReference(args.file, args.to, args.kind), origin),

  // The badge's human-authored description (was `prompt`). `kind` is required only
  // on the first set() that materializes the badge; passing it always is harmless.
  setDescription: (
    file: string,
    description: string,
    origin: BadgeChangeOrigin,
    kind: BadgeKind = 'file',
  ): Promise<BadgeFile> => mutate(() => badgeService.set(file, { kind, description }), origin),

  // Draw an edge: writes the canvas edge AND the badge.references link in lockstep.
  connect: (args: CanvasConnectArgs, origin: BadgeChangeOrigin): Promise<CanvasFile> =>
    mutate(() => canvasMirrorService.connect(args), origin),

  // Delete an edge: drops the canvas edge AND the badge reference.
  disconnect: (args: CanvasDisconnectArgs, origin: BadgeChangeOrigin): Promise<CanvasFile> =>
    mutate(() => canvasMirrorService.disconnect(args), origin),

  // Move/relabel an edge: rewrites the canvas edge and (when endpoints change)
  // moves the badge reference.
  reconnect: (args: CanvasReconnectArgs, origin: BadgeChangeOrigin): Promise<CanvasFile> =>
    mutate(() => canvasMirrorService.reconnect(args), origin),

  // Persist a card's position/size to the folder's canvas.yaml. NOT bus-emitting:
  // a position isn't surfaced in another view (callers pass a no-op origin only to
  // satisfy the shared signature — see Canvas.persistCanvas, which calls
  // canvas.setCard directly without the bus).
  setCard: (args: CanvasSetCardArgs): Promise<CanvasFile> =>
    canvasMirrorService.setCard(args.folder, args.card),
};

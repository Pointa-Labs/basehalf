/**
 * Canvas card level-of-detail policy — PURE, no React, unit-tested in isolation.
 * One rule, one place, one test.
 *
 * Two tiers, deliberately few. Every extra tier is another half-empty in-between
 * state to design and a place for layout bugs to hide (e.g. a header + a bare item
 * count sitting above an empty body):
 *   - 'full': the card carries its real payload — a file's content preview, or a
 *     folder's item count + contents list.
 *   - 'mini': it collapses to a centred glyph + name chip. No count, no contents,
 *     no half-filled body. The item count is shown ONLY alongside the contents it
 *     counts; a lone "6 ITEMS" over empty space reads as broken.
 *
 * 'full' requires TWO independent things to be true, because they answer two
 * different questions:
 *   1. INTRINSIC fit — is the card's own (flow) height tall enough to actually
 *      seat the header + a few contents rows? A card the user shrank to a sliver
 *      can NEVER fit them, so it stays 'mini' no matter how far you zoom IN.
 *      (Zooming in makes a short card big on screen, but it still has no room — so
 *      an on-screen-size-only rule would wrongly flip it to 'full' and paint a
 *      count over an empty body.)
 *   2. ON-SCREEN size — even a tall card, once zoomed OUT far enough to be a few
 *      pixels on screen, isn't worth (and shouldn't pay for) rendering its full
 *      payload. This is the perf gate for a fully-framed large workspace.
 * Fail EITHER and the card is 'mini'.
 */
export type CardLod = 'full' | 'mini';

/** Minimum INTRINSIC (flow-unit) height for 'full': enough to seat the header plus
 *  a few contents rows. Below this a card can't fit its payload at any zoom, so it
 *  stays a name chip — this is what "shrink it and the items disappear" means. */
export const CARD_LOD_MIN_HEIGHT_PX = 150;

/** Minimum EFFECTIVE (on-screen) height for 'full' = flow height × zoom. ~110px ≈
 *  a default file card at the old 0.5 zoom gate, so a framed large workspace still
 *  drops every card's heavy payload at the same point. */
export const CARD_LOD_MIN_EFFECTIVE_PX = 110;

/** On-screen height of a card = its flow height × the canvas zoom. */
export const effectiveCardHeightPx = (heightPx: number, zoom: number): number => heightPx * zoom;

/** The single LOD decision: which tier a card of `heightPx` flow-units renders at
 *  under the current `zoom`. Non-finite / non-positive inputs (a node measured
 *  before layout) fail both gates → 'mini'. */
export const cardLodForHeight = (heightPx: number, zoom: number): CardLod => {
  if (!Number.isFinite(heightPx) || heightPx < CARD_LOD_MIN_HEIGHT_PX) return 'mini';
  const eff = effectiveCardHeightPx(heightPx, zoom);
  return Number.isFinite(eff) && eff >= CARD_LOD_MIN_EFFECTIVE_PX ? 'full' : 'mini';
};

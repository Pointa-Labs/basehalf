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
 *      count over an empty body.) This gate is per-card and zoom-independent.
 *   2. CANVAS ZOOM — once the canvas is zoomed OUT past a single shared threshold,
 *      EVERY full-eligible card drops its heavy payload at the SAME moment. The
 *      gate is canvas-wide (zoom only), NOT per-card on-screen size, so cards no
 *      longer pop from full to mini one-by-one as you zoom out — the overview vs
 *      detail switch is one synchronized flip.
 *        (We used to gate on EFFECTIVE on-screen height = flow height × zoom, which
 *        made each card flip at zoom = threshold / itsHeight. Because card heights
 *        differ, tall cards lingered in 'full' while short ones collapsed early and
 *        the canvas changed raggedly. A single zoom threshold is what "make the
 *        transition synchronized" means.)
 *      This is also the perf gate for a fully-framed large workspace.
 * Fail EITHER and the card is 'mini'.
 */
export type CardLod = 'full' | 'mini';

/** Minimum INTRINSIC (flow-unit) height for 'full': enough to seat the header plus
 *  a few contents rows. Below this a card can't fit its payload at any zoom, so it
 *  stays a name chip — this is what "shrink it and the items disappear" means. */
export const CARD_LOD_MIN_HEIGHT_PX = 150;

/** Minimum canvas zoom for 'full'. At or above it every full-eligible card shows
 *  its payload; below it they ALL collapse to 'mini' together. 0.5 ≈ where a
 *  default-sized file card used to drop its payload under the old effective-height
 *  gate, so the framed-large-workspace perf point is preserved — but now it's the
 *  same point for every card, so the switch is synchronized. */
export const CARD_LOD_MIN_ZOOM = 0.5;

/** The single LOD decision: which tier a card of `heightPx` flow-units renders at
 *  under the current `zoom`. Non-finite / non-positive inputs (a node measured
 *  before layout, or a zoom read before the canvas mounts) fail a gate → 'mini'. */
export const cardLodForHeight = (heightPx: number, zoom: number): CardLod => {
  if (!Number.isFinite(heightPx) || heightPx < CARD_LOD_MIN_HEIGHT_PX) return 'mini';
  return Number.isFinite(zoom) && zoom >= CARD_LOD_MIN_ZOOM ? 'full' : 'mini';
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Mini chip label sizing — "clamped counter-scale".
 *
 * A 'mini' card is just a glyph + name. The canvas scales the whole card by the
 * zoom, so a name shown at a fixed flow size shrinks to a few unreadable pixels
 * once you zoom out — defeating the chip's one job (identity at a glance).
 *
 * Counter-scaling the font toward a CONSTANT on-screen size fixes legibility, but
 * a free counter-scale overflows: the card keeps shrinking while the font refuses
 * to, so the text grows relative to the card and spills / clips. So we CAP the
 * font at a fraction of the card's OWN height — past the cap the label resumes
 * shrinking WITH the card, which is exactly why it can never overflow. Net:
 *   - mid zoom: name holds a constant, readable on-screen size;
 *   - far out:  name is bounded by the card and shrinks with it (you're not
 *               reading individual names at that scale anyway).
 * The CSS in BadgeNode mirrors this with clamp(); THIS is the testable spec.
 * ──────────────────────────────────────────────────────────────────────────── */

/** On-screen size (px) the mini name aims to hold while zoomed out. */
export const MINI_LABEL_TARGET_SCREEN_PX = 13;
/** Floor in FLOW units — never smaller than the old caption, so we never regress
 *  the at-rest (zoom ≈ 1) size. */
export const MINI_LABEL_MIN_FLOW_PX = 12;
/** Anti-overflow cap: the name's flow font never exceeds this fraction of the
 *  card's flow height, so a shrinking card can't be overrun by its own label. */
export const MINI_LABEL_CARD_HEIGHT_FRACTION = 0.18;

/** FLOW-unit font size for a mini chip's name on a `cardHeightPx`-tall card under
 *  `zoom`. On screen it renders at this × zoom. Counter-scales toward a constant
 *  on-screen target, floored at the caption size and capped at a fraction of the
 *  card height. Non-finite / non-positive zoom degrades to the floor. */
export const miniLabelFlowFontPx = (cardHeightPx: number, zoom: number): number => {
  const cap = Math.max(
    MINI_LABEL_MIN_FLOW_PX,
    (Number.isFinite(cardHeightPx) ? cardHeightPx : 0) * MINI_LABEL_CARD_HEIGHT_FRACTION,
  );
  if (!Number.isFinite(zoom) || zoom <= 0) return MINI_LABEL_MIN_FLOW_PX;
  const desired = MINI_LABEL_TARGET_SCREEN_PX / zoom;
  return Math.min(cap, Math.max(MINI_LABEL_MIN_FLOW_PX, desired));
};

import { describe, expect, it } from 'vitest';
import {
  CARD_LOD_MIN_HEIGHT_PX,
  CARD_LOD_MIN_ZOOM,
  type CardLod,
  MINI_LABEL_CARD_HEIGHT_FRACTION,
  MINI_LABEL_MIN_FLOW_PX,
  MINI_LABEL_TARGET_SCREEN_PX,
  cardLodForHeight,
  miniLabelFlowFontPx,
} from '../src/workbench/contrib/basehalfCanvas/browser/badge-node/cardLod.js';

describe('cardLod — size-aware level-of-detail policy', () => {
  it('needs BOTH enough intrinsic height AND enough canvas zoom to be full', () => {
    const tall = CARD_LOD_MIN_HEIGHT_PX + 20; // clears the intrinsic gate
    const cases: ReadonlyArray<{ h: number; z: number; tier: CardLod; why: string }> = [
      { h: tall, z: 1, tier: 'full', why: 'tall enough + full zoom' },
      {
        h: tall,
        z: CARD_LOD_MIN_ZOOM - 0.01,
        tier: 'mini',
        why: 'tall but just below the zoom gate',
      },
      // The bug this fixes: a SHORT card stays mini no matter how far you zoom IN —
      // it can never seat the contents, so it must not flip to a count-over-empty.
      { h: 90, z: 1, tier: 'mini', why: 'short card, normal zoom' },
      { h: 90, z: 4, tier: 'mini', why: 'short card zoomed WAY in — still mini' },
      { h: CARD_LOD_MIN_HEIGHT_PX - 1, z: 5, tier: 'mini', why: 'just under intrinsic gate' },
      // On the intrinsic boundary, the canvas-zoom gate then decides.
      {
        h: CARD_LOD_MIN_HEIGHT_PX,
        z: CARD_LOD_MIN_ZOOM,
        tier: 'full',
        why: 'on intrinsic boundary, on the zoom gate',
      },
      {
        h: CARD_LOD_MIN_HEIGHT_PX,
        z: CARD_LOD_MIN_ZOOM - 0.01,
        tier: 'mini',
        why: 'on intrinsic boundary but just under the zoom gate',
      },
    ];
    for (const { h, z, tier, why } of cases) {
      expect(cardLodForHeight(h, z), `h=${h} z=${z} (${why})`).toBe(tier);
    }
  });

  it('the zoom gate is the SAME for every card height — cards flip in sync', () => {
    // Two very different heights cross the gate at the identical zoom, so they
    // change tier together rather than one-by-one (the desync this fix removes).
    const short = CARD_LOD_MIN_HEIGHT_PX + 10;
    const tall = CARD_LOD_MIN_HEIGHT_PX + 400;
    for (const h of [short, tall]) {
      expect(cardLodForHeight(h, CARD_LOD_MIN_ZOOM), `h=${h} at gate`).toBe('full');
      expect(cardLodForHeight(h, CARD_LOD_MIN_ZOOM - 0.01), `h=${h} below gate`).toBe('mini');
    }
  });

  it('degrades a not-yet-measured / degenerate size to mini rather than NaN', () => {
    expect(cardLodForHeight(Number.NaN, 1)).toBe('mini');
    expect(cardLodForHeight(0, 1)).toBe('mini');
    expect(cardLodForHeight(200, Number.NaN)).toBe('mini');
  });
});

describe('miniLabelFlowFontPx — clamped counter-scale for the mini name', () => {
  const onScreen = (h: number, z: number) => miniLabelFlowFontPx(h, z) * z;

  it('holds a roughly constant on-screen size while the card has room (mid zoom)', () => {
    // A default-height card (220) caps at 220 × 0.18 ≈ 39.6 flow. At zoom 0.4 the
    // constant-size target (13 / 0.4 = 32.5) is under the cap, so the name keeps
    // its readable on-screen size instead of shrinking with the canvas.
    const h = 220;
    expect(miniLabelFlowFontPx(h, 0.4)).toBeCloseTo(MINI_LABEL_TARGET_SCREEN_PX / 0.4, 5);
    expect(onScreen(h, 0.4)).toBeCloseTo(MINI_LABEL_TARGET_SCREEN_PX, 5);
  });

  it('never exceeds the card-height cap — so it can never overflow the card', () => {
    const h = 220;
    const cap = h * MINI_LABEL_CARD_HEIGHT_FRACTION;
    // Way zoomed out: the constant-size target (13 / 0.2 = 65) blows past the cap,
    // so the font is pinned to the cap and the on-screen size shrinks WITH the card.
    expect(miniLabelFlowFontPx(h, 0.2)).toBeCloseTo(cap, 5);
    expect(miniLabelFlowFontPx(h, 0.2)).toBeLessThanOrEqual(cap);
    // A short card caps lower (proportionally), so it stays contained too.
    const shortCap = 160 * MINI_LABEL_CARD_HEIGHT_FRACTION;
    expect(miniLabelFlowFontPx(160, 0.2)).toBeCloseTo(shortCap, 5);
  });

  it('never drops below the caption floor (no regression at rest / zoomed in)', () => {
    expect(miniLabelFlowFontPx(220, 1)).toBeGreaterThanOrEqual(MINI_LABEL_MIN_FLOW_PX);
    // Zoomed IN, the constant-size target falls below the floor → clamped up to it.
    expect(miniLabelFlowFontPx(220, 4)).toBe(MINI_LABEL_MIN_FLOW_PX);
  });

  it('degrades a degenerate zoom / height to the floor rather than NaN/∞', () => {
    expect(miniLabelFlowFontPx(220, 0)).toBe(MINI_LABEL_MIN_FLOW_PX);
    expect(miniLabelFlowFontPx(220, Number.NaN)).toBe(MINI_LABEL_MIN_FLOW_PX);
    expect(miniLabelFlowFontPx(Number.NaN, 0.3)).toBe(MINI_LABEL_MIN_FLOW_PX);
  });
});

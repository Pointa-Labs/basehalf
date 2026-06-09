import { describe, expect, it } from 'vitest';
import {
  CARD_LOD_MIN_EFFECTIVE_PX,
  CARD_LOD_MIN_HEIGHT_PX,
  type CardLod,
  cardLodForHeight,
  effectiveCardHeightPx,
} from '../src/renderer/src/lib/cardLod.js';

describe('cardLod — size-aware level-of-detail policy', () => {
  it('effective height is flow height × zoom', () => {
    expect(effectiveCardHeightPx(200, 1)).toBe(200);
    expect(effectiveCardHeightPx(200, 0.5)).toBe(100);
    expect(effectiveCardHeightPx(80, 1.5)).toBe(120);
  });

  it('needs BOTH enough intrinsic height AND enough on-screen size to be full', () => {
    const tall = CARD_LOD_MIN_HEIGHT_PX + 20; // clears the intrinsic gate
    const cases: ReadonlyArray<{ h: number; z: number; tier: CardLod; why: string }> = [
      { h: tall, z: 1, tier: 'full', why: 'tall enough + full zoom' },
      { h: tall, z: 0.4, tier: 'mini', why: 'tall but zoomed out below the on-screen gate' },
      // The bug this fixes: a SHORT card stays mini no matter how far you zoom IN —
      // it can never seat the contents, so it must not flip to a count-over-empty.
      { h: 90, z: 1, tier: 'mini', why: 'short card, normal zoom' },
      { h: 90, z: 4, tier: 'mini', why: 'short card zoomed WAY in — still mini' },
      { h: CARD_LOD_MIN_HEIGHT_PX - 1, z: 5, tier: 'mini', why: 'just under intrinsic gate' },
      // On the intrinsic boundary, the on-screen gate then decides.
      {
        h: CARD_LOD_MIN_HEIGHT_PX,
        z: 1,
        tier: 'full',
        why: 'on intrinsic boundary, big on screen',
      },
      {
        h: CARD_LOD_MIN_HEIGHT_PX,
        z: CARD_LOD_MIN_EFFECTIVE_PX / CARD_LOD_MIN_HEIGHT_PX - 0.01,
        tier: 'mini',
        why: 'on intrinsic boundary but just under on-screen gate',
      },
    ];
    for (const { h, z, tier, why } of cases) {
      expect(cardLodForHeight(h, z), `h=${h} z=${z} (${why})`).toBe(tier);
    }
  });

  it('degrades a not-yet-measured / degenerate size to mini rather than NaN', () => {
    expect(cardLodForHeight(Number.NaN, 1)).toBe('mini');
    expect(cardLodForHeight(0, 1)).toBe('mini');
    expect(cardLodForHeight(200, Number.NaN)).toBe('mini');
  });
});

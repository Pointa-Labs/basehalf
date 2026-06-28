import type { JSX } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { welcomeCopy } from './copy.js';

/**
 * The three plain beats shown on first run — the product's value chain
 * (spatial → curate → AI-sees) in three scannable lines. Deliberately NOT the
 * old four numbered steps with `.bh/` / `CLAUDE.md` code snippets: the welcome
 * page is not a manual, and implementation detail belongs at the moment of
 * action, not on the hero. The real teaching happens in the product.
 */
export const HowItWorks = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
    {welcomeCopy.beats.map((beat, i) => (
      <div key={beat.title} style={{ display: 'flex', gap: space[3], alignItems: 'baseline' }}>
        <div
          aria-hidden
          style={{
            flexShrink: 0,
            width: 20,
            fontSize: font.size.caption,
            fontWeight: font.weight.semibold,
            color: color.accent,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {i + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0, fontSize: font.size.caption, lineHeight: 1.55 }}>
          <span style={{ color: color.textPrimary, fontWeight: font.weight.medium }}>
            {beat.title}
          </span>{' '}
          <span style={{ color: color.textSecondary }}>— {beat.body}</span>
        </div>
      </div>
    ))}
  </div>
);

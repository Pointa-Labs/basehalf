import type { JSX } from 'react';
import { color, font } from '../../design.js';

/**
 * CountBadge — VS Code's `.monaco-count-badge` pill, themed. Used on the SCM
 * section/group headers (the "12" beside Changes). Grounds its geometry in VS
 * Code's badge CSS: border-radius 11px, padding 3px 6px, min-width 18px,
 * font-size 11px — just swapping the palette for ours.
 */
export const CountBadge = ({ count }: { count: number }): JSX.Element => (
  <span
    style={{
      display: 'inline-block',
      boxSizing: 'border-box',
      minWidth: 18,
      padding: '1px 6px',
      borderRadius: 11,
      background: color.accentSofter,
      color: color.accent,
      fontFamily: font.sans,
      fontSize: 11,
      lineHeight: '15px',
      fontWeight: font.weight.medium,
      textAlign: 'center',
    }}
  >
    {count}
  </span>
);

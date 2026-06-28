import type { JSX } from 'react';
import { font } from '../../style/design.js';

/**
 * CountBadge — VS Code's `.monaco-count-badge` pill, themed. Used on the SCM
 * section/group headers (the "12" beside Changes). Grounds its geometry and
 * palette in VS Code Dark Modern: badge.background #616161, badge.foreground
 * #f8f8f8, border-radius 11px, min-width 18px, font-size 11px.
 */
export const CountBadge = ({ count }: { count: number }): JSX.Element => (
  <span
    style={{
      display: 'inline-block',
      boxSizing: 'border-box',
      minWidth: 18,
      padding: '1px 6px',
      borderRadius: 11,
      background: '#616161',
      color: '#f8f8f8',
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

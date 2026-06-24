import type { JSX } from 'react';
import { color, font, radius, space } from '../../design.js';
import { welcomeCopy } from './copy.js';

const isMac = window.bh.platform === 'darwin';

/**
 * The quiet aside at the bottom of every welcome state: the pairing thesis (the
 * "other half" wedge) + the two shortcuts that work anywhere. Sits below a
 * divider so the eye lands on action first and this reads as a footnote, not a
 * pitch. The welcome page can't deliver the agent-side aha alone, so this plants
 * the next move: open your agent on the other half.
 */
export const PairingFooter = (): JSX.Element => (
  <div
    style={{
      marginTop: space[6],
      paddingTop: space[4],
      borderTop: `1px solid ${color.divider}`,
      fontSize: font.size.caption,
      color: color.textTertiary,
      lineHeight: 1.55,
    }}
  >
    {welcomeCopy.footer}
    <div style={{ marginTop: space[3], display: 'flex', gap: space[3], alignItems: 'center' }}>
      <ShortcutChip keys={isMac ? '⌘O' : 'Ctrl+O'} label="open a folder" />
      <ShortcutChip keys={isMac ? '⌘K' : 'Ctrl+K'} label="everything" />
    </div>
  </div>
);

const ShortcutChip = ({ keys, label }: { keys: string; label: string }): JSX.Element => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[1.5] }}>
    <kbd
      style={{
        fontFamily: font.sans,
        fontSize: font.size.micro,
        fontWeight: font.weight.medium,
        lineHeight: 1.6,
        color: color.textSecondary,
        background: 'rgba(255, 255, 255, 0.07)',
        borderRadius: radius.sm,
        padding: '1px 6px',
      }}
    >
      {keys}
    </kbd>
    <span style={{ fontSize: font.size.micro, color: color.textTertiary }}>{label}</span>
  </span>
);

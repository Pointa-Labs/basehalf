import type { JSX, ReactNode } from 'react';
import { color, font, space, transition } from '../../design.js';
import { CountBadge } from './CountBadge.js';

/**
 * Disclosure — a collapsible section with a VS Code-style header: a ▸/▾ chevron,
 * an uppercase title, an optional count badge, and right-aligned header actions
 * (shown only while the section is open). Controlled (open + onToggle) so several
 * sections can coexist in one scroll column the way VS Code's Source Control view
 * stacks Changes / Graph.
 */
export const Disclosure = ({
  title,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  /** Header-right controls (e.g. Stage all) — rendered only when open. */
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element => (
  <div>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[1],
        padding: `${space[1]}px ${space[3]}px ${space[1]}px ${space[2]}px`,
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: space[1],
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: color.textTertiary,
          fontFamily: font.sans,
          fontSize: font.size.micro,
          fontWeight: font.weight.semibold,
          letterSpacing: font.trackedCaps,
          textTransform: 'uppercase',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 12,
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: transition(['transform']),
            color: color.textTertiary,
          }}
        >
          ▸
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {count !== undefined && count > 0 && <CountBadge count={count} />}
      </button>
      {open && actions !== undefined && (
        <span style={{ display: 'flex', alignItems: 'center', gap: space[1] }}>{actions}</span>
      )}
    </div>
    {open && children}
  </div>
);

import type { JSX } from 'react';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export const ErrorBanner = ({ message, onDismiss }: ErrorBannerProps): JSX.Element => (
  <div
    style={{
      position: 'fixed',
      bottom: space[4],
      left: space[4],
      right: space[4],
      padding: `${space[3]}px ${space[4]}px`,
      background: color.surface,
      border: `1px solid ${color.danger}33`,
      borderLeft: `3px solid ${color.danger}`,
      borderRadius: radius.md,
      color: color.textPrimary,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      display: 'flex',
      alignItems: 'center',
      gap: space[3],
      boxShadow: shadow.raised,
      animation: `bh-banner-in ${motion.normal}`,
      zIndex: 50,
    }}
  >
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color.danger,
        flexShrink: 0,
      }}
    />
    <span
      style={{
        flex: 1,
        fontFamily: font.mono,
        fontSize: font.size.caption,
        color: color.textSecondary,
        wordBreak: 'break-word',
      }}
    >
      {message}
    </span>
    <button
      type="button"
      onClick={onDismiss}
      style={{
        background: 'transparent',
        border: 'none',
        color: color.textTertiary,
        padding: `${space[1]}px ${space[2]}px`,
        cursor: 'pointer',
        fontSize: font.size.caption,
        borderRadius: radius.sm,
        fontFamily: font.sans,
        transition: transition(['color', 'background']),
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = color.textPrimary;
        e.currentTarget.style.background = color.divider;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = color.textTertiary;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      Dismiss
    </button>
  </div>
);

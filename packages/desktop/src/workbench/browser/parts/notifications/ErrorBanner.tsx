import type { JSX } from 'react';
import { color, font, motion, radius, shadow, space, transition } from '../../style/design.js';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  /** 'error' (default) demands attention and a manual dismiss; 'info' is the
   *  calm confirmation variant (accent edge, sans body) used for transient
   *  notices like "Copied … into …" — same banner anatomy, lower alarm. */
  tone?: 'error' | 'info';
}

export const ErrorBanner = ({
  message,
  onDismiss,
  tone = 'error',
}: ErrorBannerProps): JSX.Element => {
  const edge = tone === 'error' ? color.danger : color.accent;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: space[4],
        left: space[4],
        right: space[4],
        padding: `${space[3]}px ${space[4]}px`,
        background: color.surface,
        border: `1px solid ${edge}33`,
        borderLeft: `3px solid ${edge}`,
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
          background: edge,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          // Errors keep the mono "diagnostic" voice; notices read as UI copy.
          fontFamily: tone === 'error' ? font.mono : font.sans,
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
};

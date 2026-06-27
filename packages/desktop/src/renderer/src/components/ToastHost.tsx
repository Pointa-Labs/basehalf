import type { JSX } from 'react';
import { color, font, radius, shadow, space } from '../design.js';
import { type ToastTone, useToastStore } from '../store/toast.js';

/**
 * ToastHost — renders the global toast stack (see store/toast). A fixed column at
 * the bottom-right, above the status bar, each card tinted by tone and dismissible.
 * Mounted once at the App root alongside the other hosts.
 */

const TONE_COLOR: Record<ToastTone, string> = {
  error: color.danger,
  info: color.accent,
  success: color.success,
};

export const ToastHost = (): JSX.Element | null => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        right: space[3],
        bottom: space[4],
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        gap: space[2],
        maxWidth: 360,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            gap: space[2],
            padding: `${space[2]}px ${space[3]}px`,
            background: color.surface,
            borderLeft: `3px solid ${TONE_COLOR[t.tone]}`,
            border: `1px solid ${color.borderStrong}`,
            borderLeftWidth: 3,
            borderRadius: radius.md,
            boxShadow: shadow.floating,
            color: color.textPrimary,
            fontFamily: font.sans,
            fontSize: font.size.caption,
            animation: 'bh-banner-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{t.message}</span>
          <button
            type="button"
            title="关闭"
            aria-label="关闭通知"
            onClick={() => dismiss(t.id)}
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              color: color.textTertiary,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              fontSize: font.size.body,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};

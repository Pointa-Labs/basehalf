import type { JSX, ReactNode } from 'react';
import { color, font, space } from '../../design.js';

export const Centered = ({ children }: { children: ReactNode }): JSX.Element => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: space[5],
      textAlign: 'center',
      fontFamily: font.sans,
      fontSize: font.size.caption,
      color: color.textTertiary,
    }}
  >
    {children}
  </div>
);

export const ErrorLine = ({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss?: () => void;
}): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: space[2],
      padding: `${space[2]}px ${space[3]}px`,
      background: `${color.danger}14`,
      color: color.danger,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      flexShrink: 0,
      wordBreak: 'break-word',
    }}
  >
    <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    {onDismiss !== undefined && (
      <button
        type="button"
        title="Dismiss"
        aria-label="Dismiss error"
        onClick={onDismiss}
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          color: color.danger,
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    )}
  </div>
);

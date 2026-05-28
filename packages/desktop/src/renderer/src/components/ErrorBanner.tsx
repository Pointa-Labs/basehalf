import type { JSX } from 'react';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export const ErrorBanner = ({ message, onDismiss }: ErrorBannerProps): JSX.Element => (
  <div
    style={{
      position: 'fixed',
      bottom: 16,
      left: 16,
      right: 16,
      padding: '8px 12px',
      background: '#fff0f0',
      border: '1px solid #fcc',
      borderRadius: 4,
      color: '#a00',
      fontFamily: 'system-ui, sans-serif',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    }}
  >
    <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      style={{
        background: 'transparent',
        border: '1px solid #fcc',
        color: '#a00',
        padding: '2px 8px',
        cursor: 'pointer',
        fontSize: 12,
        borderRadius: 3,
      }}
    >
      dismiss
    </button>
  </div>
);

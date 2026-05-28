/**
 * Custom canvas controls — replaces react-flow's default `<Controls />`
 * which renders blue squarish buttons that don't match the rest of the
 * chrome.
 *
 * Three buttons stacked vertically in the bottom-right of the canvas:
 * zoom in, zoom out, fit-view. Each uses the in-house Button styling
 * cues (surface bg, subtle border, accent on hover).
 */

import { useReactFlow } from '@xyflow/react';
import { type CSSProperties, type JSX, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';

const containerStyle: CSSProperties = {
  position: 'absolute',
  bottom: space[4],
  right: space[4],
  display: 'flex',
  flexDirection: 'column',
  gap: space[1],
  background: color.surface,
  borderRadius: radius.md,
  padding: space[1],
  border: `1px solid ${color.border}`,
  boxShadow: shadow.card,
  zIndex: 5,
};

const ZoomIn = (): JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
    <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const ZoomOut = (): JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
    <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const FitView = (): JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
    <path
      d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconButton = ({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        width: 28,
        height: 28,
        border: 'none',
        background: hover ? color.divider : 'transparent',
        borderRadius: radius.sm,
        cursor: 'pointer',
        color: hover ? color.textPrimary : color.textSecondary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font.sans,
        transition: transition(['background', 'color']),
      }}
    >
      {children}
    </button>
  );
};

export const CanvasControls = (): JSX.Element => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div style={containerStyle} className="bh-canvas-controls">
      <IconButton onClick={() => zoomIn()} title="Zoom in">
        <ZoomIn />
      </IconButton>
      <IconButton onClick={() => zoomOut()} title="Zoom out">
        <ZoomOut />
      </IconButton>
      <IconButton onClick={() => fitView({ duration: 200, padding: 0.2 })} title="Fit to view">
        <FitView />
      </IconButton>
    </div>
  );
};

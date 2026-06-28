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
import { type CSSProperties, type JSX, type ReactNode, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';

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

const IconButton = ({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const active = hover || focus;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      title={title}
      aria-label={title}
      style={{
        width: 28,
        height: 28,
        border: 'none',
        background: active ? color.divider : 'transparent',
        borderRadius: radius.sm,
        cursor: 'pointer',
        color: active ? color.textPrimary : color.textSecondary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font.sans,
        outline: 'none',
        boxShadow: focus ? shadow.focus : 'none',
        transition: transition(['background', 'color', 'box-shadow']),
      }}
    >
      {children}
    </button>
  );
};

export const CanvasControls = (): JSX.Element => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div
      style={containerStyle}
      className="bh-canvas-controls nodrag nopan nowheel"
      role="toolbar"
      aria-label="Canvas controls"
    >
      <IconButton onClick={() => zoomIn()} title="Zoom in">
        <Codicon name="zoom-in" size={14} />
      </IconButton>
      <IconButton onClick={() => zoomOut()} title="Zoom out">
        <Codicon name="zoom-out" size={14} />
      </IconButton>
      <IconButton onClick={() => fitView({ duration: 200, padding: 0.2 })} title="Fit to view">
        <Codicon name="screen-full" size={14} />
      </IconButton>
    </div>
  );
};

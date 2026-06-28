import { ViewportPortal, useViewport } from '@xyflow/react';
import type { JSX } from 'react';
import { color } from '../../../browser/style/design.js';
import type { CanvasSnapGuide } from './canvasSnap.js';

export const CanvasSnapGuides = ({
  guides,
}: { guides: readonly CanvasSnapGuide[] }): JSX.Element | null => {
  const viewport = useViewport();
  if (guides.length === 0) return null;
  const zoom = Math.max(0.2, viewport.zoom);
  const thickness = 1 / zoom;
  const pad = 10 / zoom;
  const dash = 5 / zoom;
  const gap = 5 / zoom;
  const guideColor = `${color.accent}99`;
  return (
    <ViewportPortal>
      <div
        aria-hidden
        style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 14 }}
      >
        {guides.map((guide, index) => {
          const key =
            guide.orientation === 'vertical'
              ? `v:${guide.x}:${guide.y1}:${guide.y2}:${index}`
              : `h:${guide.y}:${guide.x1}:${guide.x2}:${index}`;
          if (guide.orientation === 'vertical') {
            return (
              <div
                key={key}
                data-testid="canvas-snap-guide"
                style={{
                  position: 'absolute',
                  left: guide.x - thickness / 2,
                  top: guide.y1 - pad,
                  width: thickness,
                  height: guide.y2 - guide.y1 + pad * 2,
                  opacity: 0.48,
                  backgroundImage: `repeating-linear-gradient(to bottom, ${guideColor} 0, ${guideColor} ${dash}px, transparent ${dash}px, transparent ${dash + gap}px)`,
                }}
              />
            );
          }
          return (
            <div
              key={key}
              data-testid="canvas-snap-guide"
              style={{
                position: 'absolute',
                left: guide.x1 - pad,
                top: guide.y - thickness / 2,
                width: guide.x2 - guide.x1 + pad * 2,
                height: thickness,
                opacity: 0.48,
                backgroundImage: `repeating-linear-gradient(to right, ${guideColor} 0, ${guideColor} ${dash}px, transparent ${dash}px, transparent ${dash + gap}px)`,
              }}
            />
          );
        })}
      </div>
    </ViewportPortal>
  );
};

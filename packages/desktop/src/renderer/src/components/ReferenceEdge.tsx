import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';
import { type JSX, useState } from 'react';
import { color, font, motion, radius, shadow, space } from '../design.js';

// A reference edge between two badges. The LINE is always visible (the
// relationship), but the note — the "why" of the connection — reveals on
// hover or selection rather than sitting pinned to the edge midpoint.
//
// Why: always-on midpoint labels collide whenever several edges share an
// endpoint (the common hub-and-spoke shape, e.g. one entry-point file
// referencing three others). Their backgrounds clip each other into an
// unreadable pile. Progressive disclosure — line always, note on demand —
// is how the best canvas tools handle this: zero clutter, zero collision,
// and the note feels like a considered detail instead of noise. The note
// still lives in the badge panel + `.bh/` for the agent regardless.
export const ReferenceEdge = ({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  label,
  selected,
  markerEnd,
}: EdgeProps): JSX.Element => {
  const [hover, setHover] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const active = hover || selected === true;
  const note = typeof label === 'string' && label.length > 0 ? label : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: active ? color.accent : color.textGhost,
          strokeWidth: active ? 2 : 1.5,
          transition: `stroke ${motion.fast}, stroke-width ${motion.fast}`,
        }}
      />
      {/* Wide, invisible hit path so hovering NEAR the line reveals the note.
          pointer-events: stroke captures the transparent stroke region. */}
      <path
        className="bh-edge-hit"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {note !== undefined && active && (
        <EdgeLabelRenderer>
          <div
            // pointer-events: none — the pill sits on the line midpoint, which
            // the fat hit path above already covers, so it never needs to catch
            // the mouse itself (and so it can't steal hover and flicker).
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              padding: `${space[0.5]}px ${space[2]}px`,
              borderRadius: radius.sm,
              background: color.surface,
              border: `1px solid ${color.border}`,
              boxShadow: shadow.card,
              fontSize: font.size.micro,
              fontFamily: font.sans,
              fontWeight: font.weight.medium,
              color: color.textSecondary,
              whiteSpace: 'nowrap',
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {note}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

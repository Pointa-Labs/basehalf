import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { JSX } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { FileGlyph, badgeType } from './FileGlyph.js';

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
  /** True when this file is in the current focus set — i.e. it's part of what
   *  the AI agent reads from .bh/focus.md right now. Rendered as a persistent
   *  accent ring + corner dot so the human can SEE the context they handed the
   *  agent (the curation payoff was otherwise invisible). */
  focused?: boolean;
}

// Handles sit on the L/R edges. Default react-flow renders them as small
// black circles which look like terminal dots. Custom-style them so they
// recede until you hover the badge (no clutter on a busy canvas) and
// turn into a clear "drag from here" affordance on hover.
const handleStyle = {
  background: color.surface,
  border: `1.5px solid ${color.textTertiary}`,
  width: 9,
  height: 9,
  transition: transition(['background', 'border-color', 'transform']),
};

export const BadgeNode = ({ data, selected }: NodeProps): JSX.Element => {
  const d = data as unknown as BadgeNodeData;
  const isFolder = d.kind === 'folder';
  const orphan = d.orphan === true;
  const focused = d.focused === true;
  const lastSlash = d.label.lastIndexOf('/');
  const basename = lastSlash === -1 ? d.label : d.label.slice(lastSlash + 1);
  const dirname = lastSlash === -1 ? '' : d.label.slice(0, lastSlash);
  const type = badgeType(d.label, isFolder);

  // Orphan = file referenced but missing on disk. We want the badge to read
  // as "placeholder" rather than "error": muted background + dashed danger
  // border + danger basename + MISSING chip. Three signals max, all
  // pointing the same way — not four overlapping ones.
  const baseBg = orphan ? color.surfaceMuted : isFolder ? color.folder : color.surface;
  const baseBorder = orphan ? color.danger : isFolder ? color.folderBorder : color.borderStrong;
  const borderStyle = orphan ? 'dashed' : 'solid';
  // Glyph tone: muted grey for files (calm on a busy canvas), warm for the
  // folder kind, danger when the target is missing.
  const glyphTone = orphan ? color.danger : isFolder ? '#9a7d12' : color.textTertiary;

  const tooltip = focused
    ? `${d.label} — in focus; your AI agent reads this now`
    : isFolder
      ? `${d.label} — double-click to enter this folder`
      : orphan
        ? `${d.label} — referenced but missing on disk`
        : d.label;

  // Focus is the load-bearing agent signal but was invisible. Render it as a
  // persistent accent ring (distinct from react-flow's transient `selected`)
  // so the focus set stays visible even after the user clicks elsewhere.
  const boxShadow = focused
    ? `${shadow.focus}, ${shadow.card}`
    : selected
      ? shadow.selectedNode
      : shadow.card;

  return (
    <div
      title={tooltip}
      style={{
        position: 'relative',
        background: baseBg,
        border: `1px ${borderStyle} ${focused || selected ? color.accent : baseBorder}`,
        borderRadius: radius.lg,
        padding: `${space[2]}px ${space[3]}px`,
        minWidth: 160,
        maxWidth: 240,
        fontFamily: font.sans,
        boxShadow,
        transition: transition(['box-shadow', 'border-color']),
        cursor: 'grab',
      }}
    >
      {focused && (
        // The unambiguous "in focus" marker — a filled accent dot with a halo,
        // so a focused badge is recognizable at a glance even when unselected.
        <span
          aria-hidden
          title="In focus — your AI agent reads this file"
          style={{
            position: 'absolute',
            top: -5,
            right: -5,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color.accent,
            border: `2px solid ${color.surface}`,
            boxShadow: shadow.focus,
          }}
        />
      )}
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={{ display: 'flex', gap: space[2], alignItems: 'flex-start' }}>
        {/* Fixed 20px box so the glyph optically centers against the
            basename's first line regardless of how many lines follow. */}
        <span
          aria-hidden
          style={{ display: 'flex', alignItems: 'center', height: 20, flexShrink: 0 }}
        >
          <FileGlyph type={type} tone={glyphTone} size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[1.5] }}>
            <span
              style={{
                fontWeight: font.weight.semibold,
                fontSize: font.size.body,
                color: orphan ? color.danger : color.textPrimary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
                letterSpacing: -0.1,
              }}
            >
              {basename}
            </span>
            {orphan && <KindChip label="MISSING" tone="danger" />}
          </div>
          {dirname && (
            <div
              style={{
                fontSize: font.size.micro,
                color: color.textTertiary,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: font.mono,
                letterSpacing: -0.2,
              }}
            >
              {dirname}/
            </div>
          )}
          {d.prompt && (
            <div
              style={{
                marginTop: space[1.5],
                fontSize: font.size.caption,
                color: color.textSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                lineHeight: 1.4,
              }}
            >
              {d.prompt}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
};

const KindChip = ({
  label,
  tone,
}: {
  label: string;
  tone: 'folder' | 'danger';
}): JSX.Element => (
  <span
    style={{
      fontSize: 9,
      fontWeight: font.weight.semibold,
      color: tone === 'danger' ? color.danger : '#8a6c00',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      background: tone === 'danger' ? color.dangerSoft : 'rgba(0,0,0,0.04)',
      padding: '1px 5px',
      borderRadius: radius.sm,
      flexShrink: 0,
    }}
  >
    {label}
  </span>
);

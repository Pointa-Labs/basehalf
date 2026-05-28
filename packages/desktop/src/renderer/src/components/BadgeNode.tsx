import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { JSX } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
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
  const lastSlash = d.label.lastIndexOf('/');
  const basename = lastSlash === -1 ? d.label : d.label.slice(lastSlash + 1);
  const dirname = lastSlash === -1 ? '' : d.label.slice(0, lastSlash);

  // Orphan = file referenced but missing on disk. We want the badge to read
  // as "placeholder" rather than "error": muted background + dashed danger
  // border + danger basename + MISSING chip. Three signals max, all
  // pointing the same way — not four overlapping ones.
  const baseBg = orphan ? color.surfaceMuted : isFolder ? color.folder : color.surface;
  const baseBorder = orphan ? color.danger : isFolder ? color.folderBorder : color.borderStrong;
  const borderStyle = orphan ? 'dashed' : 'solid';

  const tooltip = isFolder
    ? `${d.label} — double-click to enter this folder`
    : orphan
      ? `${d.label} — referenced but missing on disk`
      : d.label;

  return (
    <div
      title={tooltip}
      style={{
        background: baseBg,
        border: `1px ${borderStyle} ${selected ? color.accent : baseBorder}`,
        borderRadius: radius.lg,
        padding: `${space[2]}px ${space[3]}px`,
        minWidth: 160,
        maxWidth: 240,
        fontFamily: font.sans,
        boxShadow: selected ? shadow.selectedNode : shadow.card,
        transition: transition(['box-shadow', 'border-color']),
        cursor: 'grab',
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space[1.5] }}>
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
        {isFolder && !orphan && <KindChip label="DIR" tone="folder" />}
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

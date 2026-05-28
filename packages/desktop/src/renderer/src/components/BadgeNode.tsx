import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { JSX } from 'react';

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
}

export const BadgeNode = ({ data, selected }: NodeProps): JSX.Element => {
  // NodeProps' data is typed as Record<string, unknown>; safe cast below.
  const d = data as unknown as BadgeNodeData;
  const isFolder = d.kind === 'folder';
  const baseBg = d.orphan ? '#fff0f0' : isFolder ? '#fff8e1' : '#ffffff';
  const baseBorder = d.orphan ? '#fcc' : isFolder ? '#e8d77a' : '#d0d0d0';

  return (
    <div
      style={{
        background: baseBg,
        border: `1px solid ${selected ? '#4a90e2' : baseBorder}`,
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 120,
        maxWidth: 200,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: d.orphan ? '#a00' : '#222',
        boxShadow: selected ? '0 0 0 2px rgba(74,144,226,0.2)' : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#888' }}>{isFolder ? '[dir]' : '[file]'}</span>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {d.label}
        </span>
        {d.orphan && <span style={{ fontSize: 10, color: '#a00' }}>(orphan)</span>}
      </div>
      {d.prompt && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: '#666',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {d.prompt}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

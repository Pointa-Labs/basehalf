import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { JSX } from 'react';

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
}

export const BadgeNode = ({ data, selected }: NodeProps): JSX.Element => {
  const d = data as unknown as BadgeNodeData;
  const isFolder = d.kind === 'folder';
  const orphan = d.orphan === true;
  const lastSlash = d.label.lastIndexOf('/');
  const basename = lastSlash === -1 ? d.label : d.label.slice(lastSlash + 1);
  const dirname = lastSlash === -1 ? '' : d.label.slice(0, lastSlash);

  const baseBg = orphan ? '#fff0f0' : isFolder ? '#fdf7e3' : '#ffffff';
  const baseBorder = orphan ? '#fcc' : isFolder ? '#e8d77a' : '#d8d8d8';

  const tooltip = isFolder ? `${d.label} — double-click to enter this folder` : d.label;

  return (
    <div
      title={tooltip}
      style={{
        background: baseBg,
        border: `1px solid ${selected ? '#4a90e2' : baseBorder}`,
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 140,
        maxWidth: 220,
        fontFamily: 'system-ui, sans-serif',
        boxShadow: selected ? '0 0 0 2px rgba(74,144,226,0.25)' : '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: orphan ? '#a00' : '#222',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {basename}
        </span>
        {isFolder && !orphan && (
          <span
            style={{
              fontSize: 9,
              color: '#a07a00',
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            dir
          </span>
        )}
        {orphan && (
          <span
            style={{
              fontSize: 9,
              color: '#a00',
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            orphan
          </span>
        )}
      </div>
      {dirname && (
        <div
          style={{
            fontSize: 10,
            color: '#999',
            marginTop: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {dirname}/
        </div>
      )}
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

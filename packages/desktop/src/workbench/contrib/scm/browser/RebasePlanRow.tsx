import type { JSX } from 'react';
import { color, font, radius, space } from '../../../browser/style/design.js';
import type {
  RebasePlanAction,
  RebasePlanRow as RebasePlanRowModel,
} from './rebasePlannerModel.js';
import { REBASE_ACTION_LABEL } from './rebasePlannerModel.js';

export const RebasePlanRow = ({
  index,
  last,
  row,
  canFixup,
  onActionChange,
  onMove,
}: {
  readonly index: number;
  readonly last: boolean;
  readonly row: RebasePlanRowModel;
  readonly canFixup: boolean;
  readonly onActionChange: (index: number, action: RebasePlanAction) => void;
  readonly onMove: (index: number, direction: -1 | 1) => void;
}): JSX.Element => (
  <div
    data-testid="rebase-row"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      padding: `${space[1]}px ${space[2]}px`,
      opacity: row.action === 'drop' ? 0.5 : 1,
    }}
  >
    <span style={{ display: 'flex', flexDirection: 'column' }}>
      <Arrow label="▲" onClick={() => onMove(index, -1)} disabled={index === 0} />
      <Arrow label="▼" onClick={() => onMove(index, 1)} disabled={last} />
    </span>
    <select
      value={row.action}
      onChange={(event) => onActionChange(index, event.target.value as RebasePlanAction)}
      style={{
        flexShrink: 0,
        background: color.bg,
        color: color.textPrimary,
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
        fontSize: font.size.micro,
        padding: '2px 4px',
      }}
    >
      {(['pick', 'drop', 'fixup', 'reword'] as RebasePlanAction[]).map((action) => (
        <option key={action} value={action} disabled={action === 'fixup' && !canFixup}>
          {REBASE_ACTION_LABEL[action]}
        </option>
      ))}
    </select>
    <span
      style={{
        color: color.textGhost,
        fontFamily: font.mono,
        fontSize: font.size.micro,
      }}
    >
      {row.commit.shortHash}
    </span>
    <span
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: color.textSecondary,
        fontSize: font.size.caption,
        textDecoration: row.action === 'drop' ? 'line-through' : 'none',
      }}
    >
      {row.action === 'reword' && row.message ? row.message : row.commit.subject}
    </span>
  </div>
);

const Arrow = ({
  label,
  onClick,
  disabled,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      width: 16,
      height: 12,
      lineHeight: '10px',
      padding: 0,
      background: 'none',
      border: 'none',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? color.textGhost : color.textTertiary,
      fontSize: 8,
    }}
  >
    {label}
  </button>
);

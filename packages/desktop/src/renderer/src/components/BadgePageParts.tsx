import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';

// Presentational atoms for the badge editor (now the in-card badge face,
// CardBadgeFace). No data/IO — pure render + local input state. Kept here so the
// badge face reads as layout.

export const sectionStyle = {
  padding: `${space[4]}px ${space[5]}px`,
  borderBottom: `1px solid ${color.border}`,
} as const;

const listStyle = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: space[1],
} as const;

export const SectionTitle = ({
  title,
  detail,
  trailing,
}: {
  title: string;
  detail?: string;
  trailing?: JSX.Element;
}): JSX.Element => (
  <div
    style={{
      marginBottom: space[2],
      display: 'flex',
      alignItems: 'baseline',
      gap: space[1.5],
    }}
  >
    <div
      style={{
        color: color.textSecondary,
        fontSize: font.size.caption,
        fontWeight: font.weight.semibold,
      }}
    >
      {title}
    </div>
    {detail && (
      <div style={{ color: color.textTertiary, fontSize: font.size.caption }}>{detail}</div>
    )}
    {trailing && <div style={{ marginLeft: 'auto' }}>{trailing}</div>}
  </div>
);

// Quiet autosave receipt next to the note label. Tertiary tone — present enough
// to reassure, faint enough not to compete with the note itself.
export const SaveIndicator = ({ state }: { state: 'saving' | 'saved' }): JSX.Element => (
  <span style={{ fontSize: font.size.caption, color: color.textTertiary }}>
    {state === 'saving' ? 'Saving…' : 'Saved'}
  </span>
);

export const EmptyLine = ({ children }: { children: string }): JSX.Element => (
  <div style={{ color: color.textTertiary, fontSize: font.size.caption, lineHeight: 1.5 }}>
    {children}
  </div>
);

export const ErrorNote = ({ message }: { message: string }): JSX.Element => (
  <div
    role="alert"
    style={{
      marginTop: space[2],
      padding: `${space[1.5]}px ${space[3]}px`,
      fontSize: font.size.caption,
      color: color.danger,
      background: `${color.danger}14`,
      border: `1px solid ${color.danger}33`,
      borderRadius: radius.md,
    }}
  >
    {message}
  </div>
);

// Editable outbound row: open the target, edit its note inline, or remove it.
export const ReferenceRow = ({
  to,
  note,
  onOpen,
  onRemove,
  onNoteCommit,
}: {
  to: string;
  note: string;
  onOpen: () => void;
  onRemove: () => void;
  onNoteCommit: (note: string) => void;
}): JSX.Element => {
  const [local, setLocal] = useState(note);
  const [hovered, setHovered] = useState(false);
  useEffect(() => setLocal(note), [note]);
  return (
    <li
      data-testid="file-badge-reference-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={rowStyle}
    >
      <span aria-hidden style={arrowStyle}>
        →
      </span>
      <button type="button" onClick={onOpen} title={`Open ${to}`} style={pathButtonStyle}>
        {to}
      </button>
      <input
        data-testid="file-badge-reference-note"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={() => {
          if (local !== note) onNoteCommit(local);
        }}
        placeholder="note"
        style={noteInputStyle}
      />
      <button
        type="button"
        onClick={onRemove}
        title="Remove reference"
        aria-label={`Remove reference to ${to}`}
        style={xButton(hovered)}
      >
        ×
      </button>
    </li>
  );
};

// Read-only inbound row: navigation only, nothing to edit here — so it reads
// lighter than the editable References rows (no filled box).
export const InboundRow = ({
  entry,
  onOpen,
}: {
  entry: { from: string; note?: string };
  onOpen: () => void;
}): JSX.Element => (
  <li data-testid="file-badge-inbound-row" style={inboundRowStyle}>
    <span aria-hidden style={arrowStyle}>
      ←
    </span>
    <button type="button" onClick={onOpen} title={`Open ${entry.from}`} style={pathButtonStyle}>
      {entry.from}
    </button>
    {entry.note && (
      <span
        style={{
          color: color.textTertiary,
          fontSize: font.size.caption,
          fontStyle: 'italic',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
      >
        {entry.note}
      </span>
    )}
  </li>
);

// Shared list + row styling. `List` wraps the rows so callers don't repeat it.
export const List = ({ children }: { children: ReactNode }): JSX.Element => (
  <ul style={listStyle}>{children}</ul>
);

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: space[1.5],
  padding: `${space[1.5]}px ${space[2]}px`,
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
} as const;

// Inbound rows are read-only: lighter than the editable References box above.
const inboundRowStyle = {
  ...rowStyle,
  background: 'transparent',
  border: '1px solid transparent',
} as const;

const arrowStyle = {
  color: color.textTertiary,
  fontSize: font.size.caption,
  flexShrink: 0,
} as const;

const pathButtonStyle = {
  flex: '0 1 180px',
  minWidth: 0,
  background: 'transparent',
  border: 'none',
  padding: 0,
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: font.mono,
  fontSize: font.size.caption,
  color: color.accent,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  letterSpacing: 0,
} as const;

const noteInputStyle = {
  flex: 1,
  minWidth: 64,
  padding: `${space[0.5]}px ${space[1.5]}px`,
  fontSize: font.size.caption,
  fontFamily: font.sans,
  color: color.textPrimary,
  border: '1px solid transparent',
  borderRadius: radius.sm,
  background: 'transparent',
  outline: 'none',
} as const;

const xButton = (hovered: boolean) =>
  ({
    flexShrink: 0,
    background: 'transparent',
    border: 'none',
    color: hovered ? color.danger : color.textGhost,
    cursor: 'pointer',
    fontSize: 16,
    padding: `0 ${space[1]}px`,
    lineHeight: 1,
    transition: transition(['color']),
  }) as const;

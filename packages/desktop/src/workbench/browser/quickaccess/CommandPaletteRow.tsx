import type { JSX } from 'react';
import type { CommandPaletteAction, IMatch } from '../../common/quickaccess/commandPaletteModel.js';
import { color, font, radius, space, transition } from '../style/design.js';
import { highlightSegments } from './highlightSegments.js';

function renderHighlighted(text: string, query: string): JSX.Element {
  const segments = highlightSegments(text, query);
  let offset = 0;
  const nodes = segments.map((seg) => {
    const key = offset;
    offset += seg.text.length;
    return seg.match ? (
      <mark
        key={key}
        style={{
          background: 'transparent',
          color: color.accent,
          fontWeight: font.weight.semibold,
        }}
      >
        {seg.text}
      </mark>
    ) : (
      <span key={key}>{seg.text}</span>
    );
  });
  return <>{nodes}</>;
}

function renderFuzzyHighlighted(text: string, matches: IMatch[]): JSX.Element {
  if (matches.length === 0) return <>{text}</>;
  const nodes: JSX.Element[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) nodes.push(<span key={pos}>{text.slice(pos, m.start)}</span>);
    nodes.push(
      <mark
        key={m.start}
        style={{ background: 'transparent', color: color.accent, fontWeight: font.weight.semibold }}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    pos = m.end;
  }
  if (pos < text.length) nodes.push(<span key={pos}>{text.slice(pos)}</span>);
  return <>{nodes}</>;
}

export const CommandPaletteRow = ({
  action,
  idx,
  id,
  selected,
  query,
  labelMatches,
  onHover,
  onClick,
}: {
  action: CommandPaletteAction;
  idx: number;
  id: string;
  selected: boolean;
  query: string;
  labelMatches?: IMatch[];
  onHover: () => void;
  onClick: () => void;
}): JSX.Element => (
  <button
    id={id}
    type="button"
    role="option"
    aria-selected={selected}
    tabIndex={-1}
    data-bh-palette-idx={idx}
    onMouseEnter={onHover}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      padding: `${space[1.5]}px ${space[2]}px`,
      background: selected ? color.accentSofter : 'transparent',
      border: 'none',
      borderRadius: radius.sm,
      cursor: 'pointer',
      textAlign: 'left',
      fontFamily: font.sans,
      fontSize: font.size.ui,
      color: color.textPrimary,
      transition: transition(['background']),
    }}
  >
    <span
      style={{
        fontSize: font.size.micro,
        color: color.textTertiary,
        letterSpacing: font.trackedCaps,
        textTransform: 'uppercase',
        fontWeight: font.weight.medium,
        minWidth: 72,
      }}
    >
      {action.category}
    </span>
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: selected ? color.accent : color.textPrimary,
          fontWeight: selected ? font.weight.medium : font.weight.regular,
        }}
      >
        {labelMatches !== undefined
          ? renderFuzzyHighlighted(action.label, labelMatches)
          : renderHighlighted(action.label, query)}
      </span>
      {action.sub && (
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: color.textTertiary,
            fontSize: font.size.micro,
            fontFamily: font.mono,
          }}
        >
          {renderHighlighted(action.sub, query)}
        </span>
      )}
    </span>
    {action.hint && (
      <span
        style={{
          color: color.textTertiary,
          fontSize: font.size.caption,
          fontFamily:
            action.category === 'File' || action.category === 'Workspace' ? font.mono : font.sans,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 240,
          flexShrink: 0,
        }}
      >
        {action.hint}
      </span>
    )}
    {action.shortcut && (
      <span
        style={{
          color: color.textSecondary,
          fontSize: font.size.micro,
          fontFamily: font.sans,
          fontWeight: font.weight.medium,
          background: color.surfaceMuted,
          border: `1px solid ${color.divider}`,
          padding: '2px 6px',
          borderRadius: radius.sm,
          flexShrink: 0,
          letterSpacing: 0.3,
        }}
      >
        {action.shortcut}
      </span>
    )}
  </button>
);

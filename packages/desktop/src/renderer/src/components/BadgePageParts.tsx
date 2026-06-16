import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';

// Presentational atoms for the badge editor, shared by BOTH surfaces that edit a
// badge: the document Badge zone (NoteBadge, under the note title) and the canvas
// card's flip face (CardBadgeFace). One visual language, one code path — no boxed
// fields, no side rules: the prompt reads as text, references are light line
// items, "Add to Context" is a quiet pill. No data/IO here — pure render + local
// input state. The surfaces differ only in copy + density, passed as props.

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

const listStyle = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: space[0.5],
} as const;

// Quiet autosave receipt. Tertiary tone — present enough to reassure, faint
// enough not to compete with the note itself.
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
  <div role="alert" style={{ fontSize: font.size.caption, color: color.danger }}>
    {message}
  </div>
);

/** The prompt — a borderless, auto-growing line of text (reads like a document
 *  subtitle, not an input). A hairline appears under it on focus; no box. */
export const BadgePrompt = ({
  value,
  onChange,
  onFlush,
  placeholder,
  testId,
  size = 'body',
}: {
  value: string;
  onChange: (value: string) => void;
  onFlush: () => void;
  placeholder: string;
  testId?: string;
  /** 'body' (document zone) or 'caption' (the denser canvas card). */
  size?: 'body' | 'caption';
}): JSX.Element => {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Re-fit height when the value changes — incl. the async badge load and a sync
  // from the other surface. Reading `value` in the body (not just the deps) keeps
  // the fit tied to the value the linter can see it depends on.
  useEffect(() => {
    const el = ref.current;
    if (el && value.length >= 0) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="bh-badge-prompt"
      data-testid={testId}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      rows={1}
      onChange={(e) => {
        onChange(e.target.value);
        const el = e.currentTarget;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderBottomColor = color.borderStrong;
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderBottomColor = 'transparent';
        onFlush();
      }}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        resize: 'none',
        overflow: 'hidden',
        minHeight: size === 'body' ? 22 : 20,
        padding: `0 0 ${space[1]}px`,
        border: 'none',
        borderBottom: '1px solid transparent',
        background: 'transparent',
        color: color.textSecondary,
        fontFamily: font.sans,
        fontSize: size === 'body' ? font.size.body : font.size.caption,
        lineHeight: 1.6,
        outline: 'none',
        transition: transition(['border-color']),
      }}
    />
  );
};

/** A reference as a light line item — `→ name  ×` — no box. References are plain
 *  paths now (the per-edge note + anchors moved to the canvas layer), so this row
 *  is open-or-remove only. */
export const RefLine = ({
  to,
  onOpen,
  onRemove,
}: {
  to: string;
  onOpen: () => void;
  onRemove: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <li
      data-testid="badge-reference-row"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[1.5],
        fontSize: font.size.caption,
      }}
    >
      <span aria-hidden style={{ color: color.textGhost, flexShrink: 0 }}>
        →
      </span>
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${to}`}
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          padding: 0,
          cursor: 'pointer',
          color: color.accent,
          fontFamily: font.mono,
          fontSize: font.size.caption,
        }}
      >
        {basename(to)}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove reference to ${basename(to)}`}
        title="Remove reference"
        style={{
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: hover ? color.danger : color.textGhost,
          fontSize: 14,
          lineHeight: 1,
          padding: `0 ${space[0.5]}px`,
          transition: transition(['color']),
        }}
      >
        ×
      </button>
    </li>
  );
};

/** A ghost "+ add reference" affordance. Copy passed in per surface. */
export const AddRefButton = ({
  label,
  onClick,
  spaced,
}: {
  label: string;
  onClick: () => void;
  /** Add top margin when references precede it. */
  spaced?: boolean;
}): JSX.Element => (
  <button
    type="button"
    data-testid="badge-add-ref"
    onClick={onClick}
    style={{
      alignSelf: 'flex-start',
      marginTop: spaced ? space[1] : 0,
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: color.textTertiary,
      cursor: 'pointer',
      fontSize: font.size.caption,
      transition: transition(['color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.color = color.textSecondary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.color = color.textTertiary;
    }}
  >
    {label}
  </button>
);

/** The "Add to Context" state — a quiet pill, not a boxed row. Active shows an
 *  accent dot + the active label; inactive shows the add label. */
export const ContextPill = ({
  active,
  onToggle,
  activeLabel,
  addLabel,
  disabled,
  testId,
}: {
  active: boolean;
  onToggle: () => void;
  activeLabel: string;
  addLabel: string;
  disabled?: boolean;
  testId?: string;
}): JSX.Element => (
  <button
    type="button"
    data-testid={testId}
    disabled={disabled}
    onClick={onToggle}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: space[1.5],
      padding: 0,
      border: 'none',
      background: 'transparent',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.7 : 1,
      fontSize: font.size.caption,
      color: active ? color.textSecondary : color.textTertiary,
      transition: transition(['color']),
    }}
  >
    {active ? (
      <>
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: radius.pill, background: color.accent }}
        />
        {activeLabel}
      </>
    ) : (
      `+ ${addLabel}`
    )}
  </button>
);

/** The faint, read-only "referenced by" toggle line. */
export const InboundToggle = ({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={expanded}
    style={{
      padding: 0,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: font.size.caption,
      color: color.textGhost,
      textAlign: 'left',
    }}
  >
    {label}
  </button>
);

// Read-only inbound row: navigation only, nothing to edit — lighter than the
// editable reference lines (no box, no remove). Backlinks are plain paths now.
export const InboundRow = ({
  from,
  onOpen,
}: {
  from: string;
  onOpen: () => void;
}): JSX.Element => (
  <li
    data-testid="badge-inbound-row"
    style={{ display: 'flex', alignItems: 'center', gap: space[1.5], fontSize: font.size.caption }}
  >
    <span aria-hidden style={{ color: color.textGhost, flexShrink: 0 }}>
      ←
    </span>
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${from}`}
      style={{
        flex: 1,
        minWidth: 0,
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textAlign: 'left',
        border: 'none',
        background: 'transparent',
        padding: 0,
        cursor: 'pointer',
        color: color.accent,
        fontFamily: font.mono,
        fontSize: font.size.caption,
      }}
    >
      {basename(from)}
    </button>
  </li>
);

/** Shared list wrapper for reference / inbound rows. */
export const List = ({ children }: { children: ReactNode }): JSX.Element => (
  <ul style={listStyle}>{children}</ul>
);

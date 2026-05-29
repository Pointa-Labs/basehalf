/**
 * ViewFilePicker — add files to a saved view.
 *
 * Saved views were a dead end: you could create one but had no UI to put
 * anything in it (the only view.addMember call was in-canvas repositioning,
 * and the empty-view hint told you to "drag from the main canvas" which
 * isn't visible while you're in the view). This is the missing door — a
 * searchable, multi-select picker of the workspace's badges not yet in the
 * view. Modeled on the command palette so it feels like one product.
 */

import { type CSSProperties, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { Button } from './primitives/Button.js';

interface BadgeListEntry {
  readonly file: string;
  readonly kind: 'file' | 'folder';
}

interface ViewFilePickerProps {
  readonly viewId: string;
  /** Files already in the view — excluded from the list. */
  readonly existing: ReadonlySet<string>;
  readonly onClose: () => void;
  /** Called after members were added so the canvas can refresh. */
  readonly onAdded: () => void;
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: color.backdrop,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 100,
  zIndex: 120,
  animation: `bh-fade-in ${motion.fast}`,
};

const cardStyle: CSSProperties = {
  background: color.surface,
  borderRadius: radius.xl,
  boxShadow: shadow.floating,
  width: 520,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 200px)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: font.sans,
  animation: `bh-dialog-in ${motion.normal}`,
};

export const ViewFilePicker = ({
  viewId,
  existing,
  onClose,
  onAdded,
}: ViewFilePickerProps): JSX.Element => {
  const [all, setAll] = useState<readonly BadgeListEntry[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await window.bh.run('badge.list')) as { badges: BadgeListEntry[] };
        if (!cancelled) setAll(result.badges);
      } catch {
        // Leave the list empty; the picker still closes cleanly.
      }
    })();
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((b) => !existing.has(b.file))
      .filter((b) => (q ? b.file.toLowerCase().includes(q) : true))
      .sort((a, b) => a.file.localeCompare(b.file));
  }, [all, existing, query]);

  const toggle = (file: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const add = async (): Promise<void> => {
    if (selected.size === 0) return;
    setBusy(true);
    // Lay new members out in a grid offset past existing ones so they don't
    // stack on top of each other (or on current members) at the origin.
    const base = existing.size;
    let i = 0;
    for (const file of selected) {
      const idx = base + i;
      const x = 60 + (idx % 4) * 220;
      const y = 60 + Math.floor(idx / 4) * 140;
      try {
        await window.bh.run('view.addMember', { id: viewId, file, position: { x, y } });
      } catch {
        // Skip individual failures; keep adding the rest.
      }
      i += 1;
    }
    setBusy(false);
    onAdded();
    onClose();
  };

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add files to view"
    >
      <div style={cardStyle}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add files to this view…"
          data-testid="view-picker-input"
          style={{
            border: 'none',
            outline: 'none',
            padding: `${space[3]}px ${space[4]}px`,
            fontSize: font.size.body,
            fontFamily: font.sans,
            color: color.textPrimary,
            background: 'transparent',
            borderBottom: `1px solid ${color.divider}`,
          }}
        />
        <div style={{ overflowY: 'auto', flex: 1, padding: space[1] }}>
          {candidates.length === 0 ? (
            <div
              style={{
                padding: `${space[5]}px ${space[4]}px`,
                textAlign: 'center',
                color: color.textTertiary,
                fontSize: font.size.caption,
              }}
            >
              {all.length > existing.size
                ? `No files match "${query}"`
                : 'Every file is already in this view.'}
            </div>
          ) : (
            candidates.map((b) => {
              const isSel = selected.has(b.file);
              const slash = b.file.lastIndexOf('/');
              const name = slash === -1 ? b.file : b.file.slice(slash + 1);
              const dir = slash === -1 ? '' : b.file.slice(0, slash);
              return (
                <button
                  key={b.file}
                  type="button"
                  onClick={() => toggle(b.file)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: space[2],
                    padding: `${space[1.5]}px ${space[2]}px`,
                    background: isSel ? color.accentSofter : 'transparent',
                    border: 'none',
                    borderRadius: radius.sm,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: font.sans,
                    fontSize: font.size.ui,
                    transition: transition(['background']),
                  }}
                >
                  <FileGlyph
                    type={badgeType(b.file, b.kind === 'folder')}
                    tone={isSel ? color.accent : color.textTertiary}
                    size={14}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: isSel ? color.accent : color.textPrimary,
                      fontWeight: isSel ? font.weight.medium : font.weight.regular,
                    }}
                  >
                    {name}
                    {dir && (
                      <span style={{ color: color.textTertiary, fontWeight: font.weight.regular }}>
                        {'  '}
                        {dir}/
                      </span>
                    )}
                  </span>
                  {isSel && (
                    <svg width={14} height={14} viewBox="0 0 12 12" aria-hidden>
                      <path
                        d="M2.5 6.5l2.5 2.5 5-5.5"
                        fill="none"
                        stroke={color.accent}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: space[2],
            padding: `${space[2]}px ${space[3]}px`,
            borderTop: `1px solid ${color.divider}`,
          }}
        >
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0 || busy}
            onClick={() => void add()}
          >
            {selected.size === 0
              ? 'Add files'
              : `Add ${selected.size} file${selected.size === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

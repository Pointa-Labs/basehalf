import type { BadgeKind } from '@basehalf/core';
import { type JSX, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import {
  EmptyLine,
  ErrorNote,
  InboundRow,
  List,
  ReferenceRow,
  SaveIndicator,
  SectionTitle,
} from './BadgePageParts.js';
import { useFileBadge } from './useFileBadge.js';

// The badge face shown INSIDE a canvas card (BadgeNode) when the user flips it
// over with the card's badge toggle. It is the full badge editor — the same
// prompt + references + inbound + focus controls that used to live in the
// right-panel BadgePage — but laid out for the card's narrow body. Reuses the
// SAME controller (useFileBadge) and the SAME presentational rows
// (BadgePageParts), so there is one badge-editing code path, not two.
//
// Layout differences from the old panel page: no header (the card already shows
// the glyph + name + path above this face), tighter section padding, and a
// scrollable body so a busy badge never overflows the card. Autosave + flush +
// badge-bus sync all come from the hook unchanged.

const cardSection = {
  padding: `${space[3]}px ${space[3]}px`,
  borderBottom: `1px solid ${color.border}`,
} as const;

export const CardBadgeFace = ({
  file,
  kind,
  paneId,
}: {
  file: string;
  kind: BadgeKind;
  paneId: string;
}): JSX.Element => {
  const fb = useFileBadge(file, paneId, kind);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const [inboundExpanded, setInboundExpanded] = useState(false);

  // Folders can't be partially focused: their "Add to Context" sets the whole
  // folder. A file toggles in/out. The copy reflects that asymmetry.
  const focusedNow = fb.isFocused;
  const focusActionLabel =
    kind === 'folder'
      ? focusedNow
        ? 'In context'
        : 'Add to Context'
      : focusedNow
        ? 'Remove'
        : 'Add to Context';

  return (
    <div
      data-testid={`card-badge-face-${file}`}
      className="nodrag nopan nowheel"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: color.surface,
        cursor: 'default',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* What agents should know — the prompt. */}
        <section style={cardSection}>
          <label style={{ display: 'block' }}>
            <SectionTitle
              title="What agents should know"
              trailing={
                fb.saveState === 'idle' ? undefined : <SaveIndicator state={fb.saveState} />
              }
            />
            <textarea
              data-testid="card-badge-prompt"
              spellCheck={false}
              value={fb.prompt}
              onChange={(e) => fb.onPromptChange(e.target.value)}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = color.borderStrong;
                e.currentTarget.style.boxShadow = 'none';
                void fb.flushPrompt();
              }}
              placeholder={
                kind === 'folder'
                  ? 'e.g. Chapter 3 supporting material — read first.'
                  : 'e.g. This is the proof card for theorem 2. Read notes/proof.md first.'
              }
              rows={4}
              style={{
                width: '100%',
                minHeight: 84,
                boxSizing: 'border-box',
                padding: `${space[2]}px`,
                fontSize: font.size.caption,
                fontFamily: font.sans,
                color: color.textPrimary,
                border: `1px solid ${color.borderStrong}`,
                borderRadius: radius.md,
                resize: 'vertical',
                background: color.bg,
                outline: 'none',
                transition: transition(['border-color', 'box-shadow']),
                lineHeight: 1.5,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = color.accent;
                e.currentTarget.style.boxShadow = shadow.focus;
              }}
            />
          </label>
          {fb.saveError && <ErrorNote message={fb.saveError} />}
        </section>

        {/* Agent-context toggle. */}
        <section style={cardSection}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[2],
              padding: `${space[1.5]}px ${space[2]}px`,
              borderRadius: radius.md,
              border: `1px solid ${focusedNow ? color.accentSoft : color.border}`,
              background: focusedNow ? `${color.accent}14` : color.bg,
              transition: transition(['border-color', 'background']),
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: font.size.caption,
                  fontWeight: font.weight.semibold,
                  color: focusedNow ? color.accent : color.textPrimary,
                }}
              >
                {focusedNow ? "In this turn's brief" : 'Not in the brief yet'}
              </div>
            </div>
            <button
              type="button"
              data-testid="card-badge-focus-toggle"
              disabled={kind === 'folder' && focusedNow}
              onClick={() => void fb.toggleFocus()}
              style={{
                flexShrink: 0,
                padding: `${space[1]}px ${space[2]}px`,
                fontSize: font.size.caption,
                fontWeight: font.weight.medium,
                fontFamily: font.sans,
                border: `1px solid ${focusedNow ? color.border : color.accent}`,
                borderRadius: radius.md,
                background: focusedNow ? 'transparent' : color.accent,
                color: focusedNow ? color.textSecondary : '#fff',
                cursor: kind === 'folder' && focusedNow ? 'default' : 'pointer',
                opacity: kind === 'folder' && focusedNow ? 0.7 : 1,
                transition: transition(['background', 'color', 'border-color']),
              }}
            >
              {focusActionLabel}
            </button>
          </div>
        </section>

        {/* References (outbound) + Referenced-by (inbound). */}
        <section style={cardSection}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
            <SectionTitle
              title="References"
              detail={fb.refs.length > 0 ? String(fb.refs.length) : undefined}
            />
            <button
              type="button"
              data-testid="card-badge-add-ref"
              onClick={() => void fb.addReference()}
              style={{
                marginLeft: 'auto',
                padding: `${space[0.5]}px ${space[1.5]}px`,
                fontSize: font.size.caption,
                fontFamily: font.sans,
                border: 'none',
                background: 'transparent',
                color: color.accent,
                cursor: 'pointer',
                borderRadius: radius.sm,
              }}
            >
              + Add
            </button>
          </div>
          {fb.refs.length === 0 ? (
            <EmptyLine>Nothing yet — link the files this one builds on.</EmptyLine>
          ) : (
            <List>
              {fb.refs.map((ref) => (
                <ReferenceRow
                  key={ref.to}
                  to={ref.to}
                  note={ref.note ?? ''}
                  onOpen={() => openInPanel(ref.to)}
                  onRemove={() => void fb.removeRef(ref.to)}
                  onNoteCommit={(note) => void fb.updateRefNote(ref.to, note)}
                />
              ))}
            </List>
          )}

          <div style={{ marginTop: space[4] }}>
            {fb.inbound.length === 0 ? (
              <>
                <SectionTitle title="Referenced by" />
                <EmptyLine>Nothing points here yet.</EmptyLine>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setInboundExpanded((v) => !v)}
                  aria-expanded={inboundExpanded}
                  aria-label={`Referenced by ${fb.inbound.length} ${fb.inbound.length === 1 ? 'file' : 'files'} — toggle list`}
                  data-testid="card-badge-inbound-toggle"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space[1.5],
                    width: '100%',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <SectionTitle title="Referenced by" detail={String(fb.inbound.length)} />
                  <span
                    aria-hidden
                    style={{
                      color: color.textTertiary,
                      fontSize: 10,
                      transform: inboundExpanded ? 'rotate(180deg)' : 'none',
                      transition: transition(['transform']),
                    }}
                  >
                    ▾
                  </span>
                </button>
                {inboundExpanded ? (
                  <List>
                    {fb.inbound.map((entry) => (
                      <InboundRow
                        key={entry.from}
                        entry={entry}
                        onOpen={() => openInPanel(entry.from)}
                      />
                    ))}
                  </List>
                ) : (
                  <EmptyLine>
                    {`← referenced by ${fb.inbound.length} ${fb.inbound.length === 1 ? 'file' : 'files'}`}
                  </EmptyLine>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

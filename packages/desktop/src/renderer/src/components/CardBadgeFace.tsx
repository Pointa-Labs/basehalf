import type { BadgeKind } from '@basehalf/core';
import { type JSX, useState } from 'react';
import { color, space } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import {
  AddRefButton,
  BadgePrompt,
  ContextPill,
  ErrorNote,
  InboundRow,
  InboundToggle,
  List,
  RefLine,
} from './BadgePageParts.js';
import { useFileBadge } from './useFileBadge.js';

// The badge face shown INSIDE a canvas card (BadgeNode) when the user flips it
// over with the card's badge toggle. It is the full badge editor — prompt +
// references + inbound + focus — laid out for the card's narrow body. Reuses the
// SAME controller (useFileBadge) and the SAME light presentational atoms
// (BadgePageParts) as the document Badge zone (NoteBadge), so there is one
// badge-editing code path AND one visual language, not two.
//
// Differences from the document zone are structural, not stylistic: the card
// already shows its glyph + name + path above this face (so no Badge label /
// collapse here), the body scrolls so a busy badge never overflows the tile, and
// the prompt uses the denser caption size. Copy is English to match the card's
// existing chrome. Autosave + flush + badge-bus sync come from the hook unchanged.

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
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: space[3] }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {/* What agents should know — the prompt, as text. */}
          <BadgePrompt
            value={fb.prompt}
            onChange={fb.onPromptChange}
            onFlush={() => void fb.flushPrompt()}
            placeholder={
              kind === 'folder'
                ? 'What agents should know about this folder…'
                : 'What agents should know about this file…'
            }
            testId="card-badge-prompt"
            size="caption"
          />

          {/* References (outbound). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[0.5] }}>
            {fb.refs.length > 0 && (
              <List>
                {fb.refs.map((ref) => (
                  <RefLine
                    key={ref.to}
                    to={ref.to}
                    note={ref.note ?? ''}
                    notePlaceholder="note"
                    onOpen={() => openInPanel(ref.to)}
                    onRemove={() => void fb.removeRef(ref.to)}
                    onNoteCommit={(note) => void fb.updateRefNote(ref.to, note)}
                  />
                ))}
              </List>
            )}
            <AddRefButton
              label="+ Add reference"
              onClick={() => void fb.addReference()}
              spaced={fb.refs.length > 0}
            />
          </div>

          {/* Agent-context state + referenced-by (read-only). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
              <ContextPill
                active={fb.isFocused}
                onToggle={() => void fb.toggleFocus()}
                activeLabel="In context"
                addLabel="Add to Context"
                // A folder IS the grouping — once added it can't be partially removed here.
                disabled={kind === 'folder' && fb.isFocused}
                testId="card-badge-focus-toggle"
              />
              {fb.inbound.length > 0 && (
                <span style={{ marginLeft: 'auto' }}>
                  <InboundToggle
                    label={`← ${fb.inbound.length} referenced by`}
                    expanded={inboundExpanded}
                    onToggle={() => setInboundExpanded((v) => !v)}
                  />
                </span>
              )}
            </div>
            {inboundExpanded && fb.inbound.length > 0 && (
              <div style={{ paddingLeft: space[2] }}>
                <List>
                  {fb.inbound.map((entry) => (
                    <InboundRow
                      key={entry.from}
                      entry={entry}
                      onOpen={() => openInPanel(entry.from)}
                    />
                  ))}
                </List>
              </div>
            )}
          </div>

          {fb.saveError && <ErrorNote message={fb.saveError} />}
        </div>
      </div>
    </div>
  );
};

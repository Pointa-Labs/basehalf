import { type JSX, useMemo, useState } from 'react';
import { color, font, space, transition } from '../design.js';
import { useLayoutStore } from '../store/layout.js';
import { useWorkspaceStore } from '../store/workspace.js';
import {
  AddRefButton,
  BadgePrompt,
  ErrorNote,
  InboundRow,
  InboundToggle,
  List,
  RefLine,
} from './BadgePageParts.js';
import { FileGlyph } from './FileGlyph.js';
import { useFileBadge } from './useFileBadge.js';

const GUTTER = 54;

/**
 * The open note's Badge — its agent "backpack": a prompt and references to other
 * files, edited inline below the title (collapsible; state remembered globally).
 *
 * Same DATA path as the canvas card's badge face (both drive `useFileBadge`) AND
 * the same presentational atoms (BadgePageParts) — one badge editor, two homes.
 * The layout here reads as part of the document: the badge glyph is the zone's
 * quiet identity, the prompt is a borderless line of text, references are light
 * rows, "Add to Context" + inbound are a faint footer. An accent-toned glyph and
 * a collapsed preview signal "this file already carries a note" at a glance.
 */
export const NoteBadge = ({ file, paneId }: { file: string; paneId: string }): JSX.Element => {
  const open = useLayoutStore((s) => s.badgePanelOpen);
  const toggle = useLayoutStore((s) => s.toggleBadgePanel);
  // A distinct flush key (…::badge) so registering this controller's flusher
  // never clobbers the body editor's flusher under the bare paneId.
  const fb = useFileBadge(file, `${paneId}::badge`, 'file');
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const [inboundOpen, setInboundOpen] = useState(false);

  const hasContent = fb.prompt.trim() !== '' || fb.refs.length > 0;

  const summary = useMemo(() => {
    const parts: string[] = [];
    const p = fb.prompt.trim();
    if (p) parts.push(p.length > 26 ? `${p.slice(0, 26)}…` : p);
    if (fb.refs.length > 0) parts.push(`${fb.refs.length} refs`);
    return parts.join(' · ');
  }, [fb.prompt, fb.refs.length]);

  return (
    <div style={{ marginBottom: space[6], fontFamily: font.sans }}>
      {/* Toggle bar: the badge glyph is the zone's identity (no boxed chrome, no
          side rule). The chevron hugs the label; collapsed, a quiet preview
          trails after. The glyph turns accent once the file has a note/ref. */}
      <button
        type="button"
        onClick={toggle}
        data-testid="note-badge-toggle"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[1.5],
          width: '100%',
          padding: `${space[1]}px ${GUTTER}px`,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <FileGlyph type="badge" tone={hasContent ? color.accent : color.textGhost} size={15} />
        <span style={{ fontSize: font.size.caption, color: color.textTertiary }}>Badge</span>
        <span
          aria-hidden
          style={{
            color: color.textGhost,
            fontSize: 10,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: transition(['transform']),
          }}
        >
          ▾
        </span>
        {!open && summary && (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              marginLeft: space[1],
              fontSize: font.size.caption,
              color: color.textGhost,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {summary}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            padding: `${space[2]}px ${GUTTER}px 0`,
            display: 'flex',
            flexDirection: 'column',
            gap: space[3],
          }}
        >
          <BadgePrompt
            value={fb.prompt}
            onChange={fb.onPromptChange}
            onFlush={() => void fb.flushPrompt()}
            placeholder="A note to agents: what this is, what to read first"
            testId="note-badge-prompt"
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: space[0.5] }}>
            {fb.refs.length > 0 && (
              <List>
                {fb.refs.map((to) => (
                  <RefLine
                    key={to}
                    to={to}
                    onOpen={() => openInPanel(to)}
                    onRemove={() => void fb.removeRef(to)}
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
              {fb.inbound.length > 0 && (
                <span style={{ marginLeft: 'auto' }}>
                  <InboundToggle
                    label={`← ${fb.inbound.length} file(s) reference this`}
                    expanded={inboundOpen}
                    onToggle={() => setInboundOpen((v) => !v)}
                  />
                </span>
              )}
            </div>
            {inboundOpen && fb.inbound.length > 0 && (
              <div style={{ paddingLeft: space[2] }}>
                <List>
                  {fb.inbound.map((from) => (
                    <InboundRow key={from} from={from} onOpen={() => openInPanel(from)} />
                  ))}
                </List>
              </div>
            )}
          </div>

          {fb.saveError && <ErrorNote message={fb.saveError} />}
        </div>
      )}
    </div>
  );
};

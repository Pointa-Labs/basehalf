import type { JSX } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { badgeTabId } from '../lib/panelTab.js';
import { useWorkspaceStore } from '../store/workspace.js';
import {
  EmptyLine,
  ErrorNote,
  InboundRow,
  List,
  ReferenceRow,
  SaveIndicator,
  SectionTitle,
  sectionStyle,
} from './BadgePageParts.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { Button } from './primitives/Button.js';
import { useFileBadge } from './useFileBadge.js';

const basenameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

export const BadgePage = ({ file, paneId }: { file: string; paneId: string }): JSX.Element => {
  const fb = useFileBadge(file, paneId);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const openBadgeInPanel = useWorkspaceStore((s) => s.openBadgeInPanel);

  const type = badgeType(file, false);
  // Subtitle carries only the *folder* the file lives in — at root there is none,
  // so we drop the line rather than repeat the basename already in the title.
  const lastSlash = file.lastIndexOf('/');
  const dirname = lastSlash === -1 ? '' : file.slice(0, lastSlash);

  return (
    <div
      data-testid="file-badge-page"
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: color.surface,
        fontFamily: font.sans,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          padding: `${space[4]}px ${space[5]}px ${space[3]}px`,
          borderBottom: `1px solid ${color.border}`,
          background: color.surfaceMuted,
        }}
      >
        <div
          style={{
            fontSize: font.size.micro,
            color: color.textTertiary,
            textTransform: 'uppercase',
            letterSpacing: font.trackedCaps,
            fontWeight: font.weight.medium,
          }}
        >
          File Badge
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
            marginTop: space[1],
            minWidth: 0,
          }}
        >
          <span aria-hidden style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <FileGlyph type={type} tone={color.textSecondary} size={17} />
          </span>
          <h2
            title={file}
            style={{
              margin: 0,
              fontSize: font.size.display,
              lineHeight: 1.25,
              color: color.textPrimary,
              fontWeight: font.weight.semibold,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {basenameOf(file)}
          </h2>
          {fb.isFocused && (
            <span
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: space[1],
                fontSize: font.size.micro,
                fontWeight: font.weight.medium,
                color: color.accent,
              }}
            >
              {/* color is not the only signal — the dot is paired with a label. */}
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: '50%', background: color.accent }}
              />
              In context
            </span>
          )}
        </div>
        {dirname && (
          <div
            title={file}
            style={{
              marginTop: space[1.5],
              color: color.textTertiary,
              fontSize: font.size.caption,
              fontFamily: font.mono,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {dirname}/
          </div>
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <section style={sectionStyle}>
          <label style={{ display: 'block' }}>
            <SectionTitle
              title="What agents should know"
              trailing={
                fb.saveState === 'idle' ? undefined : <SaveIndicator state={fb.saveState} />
              }
            />
            <textarea
              data-testid="file-badge-prompt"
              spellCheck={false}
              value={fb.prompt}
              onChange={(e) => fb.onPromptChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  void (async () => {
                    if (await fb.flushPrompt()) closeTab(paneId, badgeTabId(file));
                  })();
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = color.borderStrong;
                e.currentTarget.style.boxShadow = 'none';
                void fb.flushPrompt();
              }}
              placeholder="e.g. This is the proof card for theorem 2. Read notes/proof.md first."
              rows={8}
              style={{
                width: '100%',
                minHeight: 156,
                boxSizing: 'border-box',
                padding: `${space[3]}px`,
                fontSize: font.size.body,
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

        {/* The note's payoff. Writing it is step one; sending it to the turn brief
            is step two — co-located so the cause→effect reads. This is the screen's
            single primary action (Add to Context); everything else is secondary. */}
        <section style={sectionStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[3],
              padding: `${space[2]}px ${space[3]}px`,
              borderRadius: radius.md,
              border: `1px solid ${fb.isFocused ? color.accentSoft : color.border}`,
              background: fb.isFocused ? `${color.accent}14` : color.bg,
              transition: transition(['border-color', 'background']),
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: font.size.caption,
                  fontWeight: font.weight.semibold,
                  color: fb.isFocused ? color.accent : color.textPrimary,
                }}
              >
                {fb.isFocused ? "In this turn's brief" : 'Not in the brief yet'}
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: font.size.caption,
                  color: color.textTertiary,
                  lineHeight: 1.45,
                }}
              >
                {fb.isFocused
                  ? 'Your agent reads this note when it works this turn.'
                  : 'Add it so your agent reads this note when it works this turn.'}
              </div>
            </div>
            <Button
              variant={fb.isFocused ? 'ghost' : 'default'}
              size="sm"
              onClick={() => void fb.toggleFocus()}
            >
              {fb.isFocused ? 'Remove' : 'Add to Context'}
            </Button>
          </div>
        </section>

        {/* Both halves of one idea — this file's connections (outbound + inbound).
            Grouped in a single section, separated by space not a hard divider, so
            they read as a pair rather than two equal-weight form rows. */}
        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
            <SectionTitle
              title="References"
              detail={fb.refs.length > 0 ? String(fb.refs.length) : undefined}
            />
            <div style={{ marginLeft: 'auto' }}>
              <Button variant="ghost" size="sm" onClick={() => void fb.addReference()}>
                + Add
              </Button>
            </div>
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
                  onOpenBadge={() => openBadgeInPanel(ref.to)}
                  onRemove={() => void fb.removeRef(ref.to)}
                  onNoteCommit={(note) => void fb.updateRefNote(ref.to, note)}
                />
              ))}
            </List>
          )}

          <div style={{ marginTop: space[5] }}>
            <SectionTitle
              title="Referenced by"
              detail={fb.inbound.length > 0 ? String(fb.inbound.length) : undefined}
            />
            {fb.inbound.length === 0 ? (
              <EmptyLine>Nothing points here yet.</EmptyLine>
            ) : (
              <List>
                {fb.inbound.map((entry) => (
                  <InboundRow
                    key={entry.from}
                    entry={entry}
                    onOpen={() => openInPanel(entry.from)}
                    onOpenBadge={() => openBadgeInPanel(entry.from)}
                  />
                ))}
              </List>
            )}
          </div>
        </section>

        <div
          style={{
            padding: `${space[3]}px ${space[5]}px`,
            color: color.textGhost,
            fontSize: font.size.caption,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fb.loading ? 'Loading…' : fb.modified ? `Modified ${fb.modified}` : ''}
        </div>
      </div>
    </div>
  );
};

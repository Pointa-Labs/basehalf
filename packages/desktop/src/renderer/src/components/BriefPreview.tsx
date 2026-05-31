/**
 * BriefPreview — an in-app peek at the curated turn brief, anchored to the focus
 * chip. The chip claims "your agent reads …" but only ever named files; this
 * shows what the agent ACTUALLY reads — the turn `intent:`, and per focused file
 * its `prompt:` + reference-notes — so curation stops being an act of faith and
 * becomes a feedback loop ("that note is stale, let me fix it before I hand it
 * over"). It closes the loop the whole product is built around: click badges →
 * SEE the brief assemble → copy / let your in-repo agent read it.
 *
 * Read-only and self-contained: it re-reads the EXISTING `focus.brief` core
 * command each time it opens (so badge/focus edits are reflected) and renders the
 * EXISTING cleaned brief — no new core command, no write path, no `.bh/` writes.
 */

import { type JSX, useEffect, useState } from 'react';
import { color, font, radius, space } from '../design.js';
import { type BriefDisplay, briefForClipboard, parseBriefForDisplay } from '../lib/focusBrief.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { Button } from './primitives/Button.js';
import { type PopoverController, PopoverSurface } from './primitives/Popover.js';

interface BriefPreviewProps {
  readonly controller: PopoverController;
  /** Reuse the chip's clipboard action so "look, then send" lives in one place. */
  readonly onCopy: () => void;
  readonly copied: boolean;
}

const splitPath = (file: string): { base: string; dir: string } => {
  const i = file.lastIndexOf('/');
  return i >= 0 ? { base: file.slice(i + 1), dir: file.slice(0, i) } : { base: file, dir: '' };
};

export const BriefPreview = ({
  controller,
  onCopy,
  copied,
}: BriefPreviewProps): JSX.Element | null => {
  const { open, coords, floatingRef } = controller;
  const [brief, setBrief] = useState<BriefDisplay | null>(null);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');

  // Re-read on every open so the preview reflects the latest badge/focus edits.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    void (async () => {
      try {
        const { brief: text } = (await window.bh.run('focus.brief', {})) as { brief: string };
        if (cancelled) return;
        setRaw(briefForClipboard(text));
        setBrief(parseBriefForDisplay(text));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  // Parser drift → fall back to the raw cleaned brief (monospaced) rather than a
  // blank panel; the content is still there, just unstyled.
  const parsedNothing = brief !== null && !brief.intent && brief.items.length === 0 && !brief.empty;
  const showRaw = parsedNothing && raw.trim().length > 0;

  return (
    <PopoverSurface
      coords={coords}
      floatingRef={floatingRef}
      role="dialog"
      style={{
        width: 380,
        maxWidth: '90vw',
        maxHeight: '62vh',
        overflowY: 'auto',
        padding: 0,
      }}
    >
      <div
        style={{ fontFamily: font.sans, fontSize: font.size.caption, color: color.textSecondary }}
      >
        <div
          style={{
            padding: `${space[2]}px ${space[3]}px`,
            borderBottom: `1px solid ${color.divider}`,
            fontSize: 11,
            fontWeight: font.weight.semibold,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: color.textTertiary,
          }}
        >
          What your agent reads
        </div>

        {error ? (
          <div style={{ padding: `${space[3]}px`, color: color.warning }}>
            Couldn't load the brief — {error}
          </div>
        ) : brief === null ? (
          <div style={{ padding: `${space[3]}px`, color: color.textTertiary }}>Loading…</div>
        ) : showRaw ? (
          <pre
            style={{
              margin: 0,
              padding: `${space[3]}px`,
              fontFamily: font.mono,
              fontSize: font.size.caption,
              color: color.textSecondary,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {raw}
          </pre>
        ) : (
          <div
            style={{
              padding: `${space[3]}px`,
              display: 'flex',
              flexDirection: 'column',
              gap: space[3],
            }}
          >
            {/* Intent — the turn's question. The most load-bearing line; show it
                first, or nudge if it's empty. */}
            {brief.intent ? (
              <div
                style={{
                  background: color.accentSofter,
                  border: `1px solid ${color.accentSoft}`,
                  borderRadius: radius.md,
                  padding: `${space[2]}px ${space[3]}px`,
                  color: color.textPrimary,
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: color.accent, fontWeight: font.weight.semibold }}>
                  Intent
                </span>{' '}
                {brief.intent}
              </div>
            ) : (
              <div style={{ color: color.textTertiary, fontStyle: 'italic' }}>
                No turn intent set.
              </div>
            )}

            {brief.items.length === 0 ? (
              <div style={{ color: color.textTertiary }}>No files in focus.</div>
            ) : (
              brief.items.map((item) => {
                const { base, dir } = splitPath(item.file);
                return (
                  <div key={item.file} style={{ display: 'flex', gap: space[2], minWidth: 0 }}>
                    <span style={{ flexShrink: 0, marginTop: 1 }}>
                      <FileGlyph
                        type={badgeType(base, false)}
                        tone={color.textTertiary}
                        size={14}
                      />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: color.textPrimary, fontWeight: font.weight.medium }}>
                        {base}
                        {dir ? (
                          <span
                            style={{ color: color.textTertiary, fontWeight: font.weight.regular }}
                          >
                            {'  '}
                            {dir}
                          </span>
                        ) : null}
                      </div>
                      {item.prompt ? (
                        <div style={{ color: color.textSecondary, lineHeight: 1.5, marginTop: 1 }}>
                          {item.prompt}
                        </div>
                      ) : (
                        <div
                          style={{ color: color.textTertiary, fontStyle: 'italic', marginTop: 1 }}
                        >
                          No prompt yet.
                        </div>
                      )}
                      {item.refs.length > 0 && (
                        <div
                          style={{
                            marginTop: space[1],
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          {item.refs.map((r) => (
                            <div key={r.to} style={{ color: color.textTertiary, lineHeight: 1.45 }}>
                              <span style={{ color: color.textSecondary }}>→ {r.to}</span>
                              {r.note ? `  ${r.note}` : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Look, then send: the copy action lives with the thing it copies. */}
        <div
          style={{
            padding: `${space[2]}px ${space[3]}px`,
            borderTop: `1px solid ${color.divider}`,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <Button variant="primary" size="sm" onClick={onCopy} data-testid="brief-preview-copy">
            {copied ? 'Copied ✓' : 'Copy brief'}
          </Button>
        </div>
      </div>
    </PopoverSurface>
  );
};

/**
 * BriefPreview — an in-app peek at the curated turn brief, anchored to the focus
 * chip. The chip claims "your agent reads …" but only ever named files; this
 * shows what the agent ACTUALLY reads — the turn `intent:`, and per focused file
 * its `prompt:` + reference-notes — so curation stops being an act of faith and
 * becomes a feedback loop ("that note is stale, let me fix it before I hand it
 * over"). It closes the loop the whole product is built around: click badges →
 * SEE the brief assemble → copy / let your in-repo agent read it.
 *
 * Mostly a read surface: it re-reads `focus.brief` each time it opens (so
 * badge/focus edits are reflected) and renders the cleaned brief. The ONE thing
 * it lets you author is the turn `intent:` — the user's question, the only brief
 * line you can't set by clicking badges — via `focus.setIntent` (which preserves
 * the active set). So the panel is "see what your agent reads AND set your ask",
 * in one place.
 */

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
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
  const [error, setError] = useState(''); // LOAD error (can't show the brief)
  const [saveError, setSaveError] = useState(''); // INTENT save error (shown inline; textarea stays)
  // The editable turn-intent. Seeded from the loaded brief; the user types their
  // question here so the most load-bearing brief line is theirs, not empty.
  const [intentDraft, setIntentDraft] = useState('');
  const savedIntentRef = useRef(''); // last value successfully persisted
  const lastRequestedRef = useRef(''); // the value the in-flight/last save targets
  const loadedActiveRef = useRef<string[]>([]); // the focus set this preview loaded
  const dirtyRef = useRef(false); // the user has typed since this open
  // In-flight save → resolves true once persisted, false if the write failed.
  const savePromiseRef = useRef<Promise<boolean>>(Promise.resolve(true));

  // Re-read on every open so the preview reflects the latest badge/focus edits.
  // RESET to a loading state first, so a reopen never shows (or lets you type
  // over) the PREVIOUS open's stale brief. Crucially we AWAIT any in-flight save
  // (fired on the previous dismiss) BEFORE fetching, so the brief we read is
  // consistent with it — and we do NOT reset savePromiseRef, so a Copy right
  // after a reopen still awaits that real pending write. Seeds the draft only
  // when the user hasn't started typing.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setSaveError('');
    setBrief(null); // → "Loading…"; hides the (stale) textarea until fresh data lands
    setRaw('');
    dirtyRef.current = false;
    void (async () => {
      try {
        await savePromiseRef.current.catch(() => {}); // let a pending save land first
        if (cancelled) return;
        const { brief: text } = (await window.bh.run('focus.brief', {})) as { brief: string };
        if (cancelled) return;
        setRaw(briefForClipboard(text));
        const parsed = parseBriefForDisplay(text);
        setBrief(parsed);
        loadedActiveRef.current = parsed.items.map((i) => i.file); // bind saves to this focus
        const current = parsed.intent ?? '';
        savedIntentRef.current = current;
        lastRequestedRef.current = current;
        if (!dirtyRef.current) setIntentDraft(current);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Persist the typed intent (focus.setIntent preserves the active set + clears
  // view provenance) when it actually changed. Returns a promise that resolves
  // true only once the write SUCCEEDS — so Copy can await it (a copy right after
  // an edit must see the new intent) and skip copying if the save failed. A
  // failed save leaves savedIntentRef unchanged, so the next blur/Copy RETRIES.
  const flushIntent = useCallback((): Promise<boolean> => {
    // Not loaded yet: the draft isn't authoritative (brief fetch pending), so a
    // save here could clear/overwrite the real intent. Skip until loaded.
    if (brief === null) return savePromiseRef.current;
    const next = intentDraft.trim();
    // Compare to the LAST REQUESTED value, not the last SAVED one: if a save is
    // in flight and the user reverts the draft back to the persisted value, that
    // is a genuinely NEW request (undo the in-flight write) — returning the
    // in-flight promise would let Copy reflect the wrong, superseded value.
    if (next === lastRequestedRef.current.trim()) return savePromiseRef.current;
    lastRequestedRef.current = next;
    // expectedActive binds this write to the focus the preview loaded — so if the
    // dismiss that triggered it also CHANGED focus (a badge/Clear click), core
    // skips the write instead of stamping the old question onto the new focus.
    savePromiseRef.current = (
      window.bh.run('focus.setIntent', {
        intent: next,
        expectedActive: loadedActiveRef.current,
      }) as Promise<{ intent: string | null; skipped?: boolean }>
    ).then(
      (res) => {
        // Mark saved only when the write actually landed (not when core skipped
        // it because focus changed).
        if (!res.skipped) savedIntentRef.current = next;
        setSaveError('');
        return true;
      },
      (err) => {
        // Inline (not the full-view error) so the textarea STAYS — the user can
        // fix the problem and retry; savedIntentRef is unchanged, so they will.
        setSaveError(err instanceof Error ? err.message : String(err));
        return false;
      },
    );
    return savePromiseRef.current;
  }, [intentDraft, brief]);

  // Flush a dirty draft when the popover is DISMISSED. usePopover closes on an
  // outside mousedown / Esc, which unmounts the textarea — and React does NOT
  // fire onBlur on unmount, so a typed-but-unblurred intent would be lost. This
  // effect (BriefPreview stays mounted, returns null) catches the open→false
  // transition and persists it. flushRef holds the latest closure so it sees the
  // final draft. The lastRequestedRef guard makes a double-fire (onBlur + this) a
  // no-op.
  const flushRef = useRef(flushIntent);
  flushRef.current = flushIntent;
  useEffect(() => {
    if (open) return;
    void flushRef.current();
  }, [open]);

  // Copy must reflect the latest intent: commit any pending edit, and only copy
  // once it actually persisted (a failed save shows its error instead).
  const copyAfterSave = useCallback((): void => {
    if (brief === null) return; // not loaded — nothing meaningful to copy yet
    void flushIntent().then((ok) => {
      if (ok) onCopy();
    });
  }, [flushIntent, onCopy, brief]);

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
            {/* Intent — the turn's QUESTION, and the only line the user can't set
                by clicking badges. Editable so the agent gets context AND the
                ask in one place ("右屏点哪个, 左屏 agent 立刻懂"). Saves on
                blur / Enter via focus.setIntent. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
              <span
                style={{
                  color: color.accent,
                  fontWeight: font.weight.semibold,
                  fontSize: 11,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}
              >
                Intent
              </span>
              <textarea
                value={intentDraft}
                onChange={(e) => {
                  dirtyRef.current = true;
                  setIntentDraft(e.target.value);
                }}
                onBlur={() => void flushIntent()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.blur(); // commit via onBlur → flushIntent
                  }
                }}
                rows={2}
                placeholder="What do you want to ask this turn? (optional)"
                data-testid="brief-intent-input"
                style={{
                  width: '100%',
                  resize: 'none',
                  boxSizing: 'border-box',
                  background: color.accentSofter,
                  border: `1px solid ${color.accentSoft}`,
                  borderRadius: radius.md,
                  padding: `${space[2]}px ${space[3]}px`,
                  color: color.textPrimary,
                  fontFamily: font.sans,
                  fontSize: font.size.caption,
                  lineHeight: 1.5,
                  outline: 'none',
                }}
              />
              {saveError && (
                <span style={{ color: color.warning, fontSize: 11 }}>
                  Couldn't save — {saveError}
                </span>
              )}
            </div>

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
          <Button
            variant="primary"
            size="sm"
            onClick={copyAfterSave}
            disabled={brief === null}
            data-testid="brief-preview-copy"
          >
            {copied ? 'Copied ✓' : 'Copy brief'}
          </Button>
        </div>
      </div>
    </PopoverSurface>
  );
};

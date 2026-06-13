/**
 * BriefPreview — an in-app peek at the curated turn brief, anchored to the
 * Agent Context chip. The chip names files; this shows what the agent ACTUALLY
 * reads — the turn `intent:`, and each context file's `prompt:` +
 * reference-notes — so curation stops being an act of faith and becomes a
 * feedback loop ("that note is stale, let me fix it before I hand it over").
 *
 * Mostly a read surface: it re-reads `focus.brief` each time it opens (so
 * badge/focus edits are reflected) and renders the cleaned brief. The ONE thing
 * it lets you author is the turn `intent:` — the user's question, the only brief
 * line owned by the context preview — via `focus.setIntent` (which preserves the
 * active set). So the panel is "see what your agent reads AND set your ask", in
 * one place.
 */

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { color, font, radius, space } from '../design.js';
import { badgeMutations } from '../lib/badgeMutations.js';
import { type BriefDisplay, briefForClipboard, parseBriefForDisplay } from '../lib/focusBrief.js';
import { isImeComposing } from '../lib/imeGuard.js';
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

/**
 * The empty-prompt slot, made fixable in place. The popover is exactly where a
 * user DISCOVERS their brief is thin — "No prompt yet" used to be a dead end
 * that sent them hunting through the badge panel; now the disappointment moment
 * is the fix moment. Writes through badge.set (badgeMutations), whose core
 * cascade (focus.resync) refreshes focus.md — the parent re-reads the brief on
 * save so the preview shows what the agent will now actually get.
 */
const GhostPromptEditor = ({
  file,
  onSaved,
  registerSave,
}: {
  file: string;
  onSaved: () => void;
  /** Hands every badge.set promise to the parent so "Copy brief" can await
   *  in-flight ghost saves — a note typed here then immediately copied must
   *  be IN the copied brief, not racing it. */
  registerSave: (p: Promise<unknown>) => void;
}): JSX.Element => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Unmount flush: dismissing the popover (outside click / Esc on the canvas)
  // unmounts the textarea WITHOUT firing onBlur — a typed-but-uncommitted note
  // would be silently lost (the exact trap the intent field guards against
  // above). Refs carry the live values into the unmount cleanup; the write is
  // fire-and-forget (no setState — we're unmounting) and idempotent against a
  // commit already in flight (same value, same badge.set).
  const editingRef = useRef(false);
  const draftRef = useRef('');
  editingRef.current = editing;
  draftRef.current = draft;
  const registerSaveRef = useRef(registerSave);
  registerSaveRef.current = registerSave;
  useEffect(
    () => () => {
      const next = draftRef.current.trim();
      if (editingRef.current && next !== '') {
        const p = badgeMutations.setPrompt(file, next, 'brief-preview').catch(() => undefined);
        registerSaveRef.current(p);
        void p;
      }
    },
    [file],
  );

  const commit = (): void => {
    const next = draft.trim();
    if (next === '') {
      setEditing(false); // nothing typed — back to the ghost, no write
      return;
    }
    setSaving(true);
    const p = badgeMutations.setPrompt(file, next, 'brief-preview');
    registerSave(p.catch(() => undefined));
    void p
      .then(() => {
        setSaving(false);
        setEditing(false);
        onSaved();
      })
      .catch((err) => {
        setSaving(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        data-testid={`brief-ghost-prompt-${file}`}
        style={{
          display: 'block',
          marginTop: 1,
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: color.textTertiary,
          fontStyle: 'italic',
          fontFamily: font.sans,
          fontSize: font.size.caption,
          lineHeight: 1.5,
          cursor: 'text',
          textAlign: 'left',
        }}
      >
        No note yet — click to add one.
      </button>
    );
  }
  return (
    <div style={{ marginTop: space[1] }}>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the user just clicked "add a note" — focus IS the requested action
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return; // Enter/Esc belong to the IME mid-composition
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur(); // commit via onBlur
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft('');
            setEditing(false);
          }
        }}
        rows={2}
        placeholder="What should the agent know about this file?"
        data-testid={`brief-ghost-input-${file}`}
        style={{
          width: '100%',
          resize: 'none',
          boxSizing: 'border-box',
          background: color.bg,
          border: `1px solid ${color.accentSoft}`,
          borderRadius: radius.md,
          padding: `${space[1]}px ${space[2]}px`,
          color: color.textPrimary,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          lineHeight: 1.5,
          outline: 'none',
        }}
      />
      {error && (
        <span style={{ color: color.warning, fontSize: font.size.micro }}>
          Couldn't save — {error}
        </span>
      )}
    </div>
  );
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
  const loadedActiveRef = useRef<string[]>([]); // the context set this preview loaded
  const dirtyRef = useRef(false); // the user has typed since this open
  // In-flight save → resolves true once persisted, false if the write failed.
  const savePromiseRef = useRef<Promise<boolean>>(Promise.resolve(true));
  // Bumped when a ghost-prompt save lands — re-reads the brief so the preview
  // reflects the note the agent will now actually get (badge.set's core
  // cascade already refreshed focus.md by the time the save resolves).
  const [reloadTick, setReloadTick] = useState(0);
  // In-flight ghost-prompt saves (note typed → blur fires badge.set). Copy
  // awaits these alongside the intent flush: blur runs before the Copy click,
  // so the promise is registered here by the time copyAfterSave reads it —
  // the copied brief always contains the note the user just typed. Reset per
  // open (a fresh popover starts with no pending writes of its own).
  const ghostSavesRef = useRef<Promise<unknown>[]>([]);

  // Re-read on every open so the preview reflects the latest badge/focus edits.
  // RESET to a loading state first, so a reopen never shows (or lets you type
  // over) the PREVIOUS open's stale brief. Crucially we AWAIT any in-flight save
  // (fired on the previous dismiss) BEFORE fetching, so the brief we read is
  // consistent with it — and we do NOT reset savePromiseRef, so a Copy right
  // after a reopen still awaits that real pending write. Seeds the draft only
  // when the user hasn't started typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a deliberate re-read trigger (ghost-prompt save → re-fetch the brief); the body reads nothing from it
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setSaveError('');
    setBrief(null); // → "Loading…"; hides the (stale) textarea until fresh data lands
    setRaw('');
    dirtyRef.current = false;
    ghostSavesRef.current = [];
    void (async () => {
      try {
        await savePromiseRef.current.catch(() => {}); // let a pending save land first
        if (cancelled) return;
        // stamp:false — opening the preview is the user PEEKING at what the agent
        // would read; it is not an agent pull, so it must not stamp the served
        // receipt (that would fake a "served Ns ago" the agent never received).
        const { brief: text } = (await window.bh.run('focus.brief', { stamp: false })) as {
          brief: string;
        };
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
  }, [open, reloadTick]);

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
    // expectedActive binds this write to the context the preview loaded — so if
    // the dismiss that triggered it also CHANGED context (Clear / another action), core
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
        // The write failed → this value was never persisted. Revert the request
        // marker (if still the latest) so the next blur/Copy with the SAME draft
        // is treated as a new request and RETRIES, instead of hitting the
        // no-change guard and returning this failed promise.
        if (lastRequestedRef.current === next) lastRequestedRef.current = savedIntentRef.current;
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

  // Copy must reflect the latest edits: commit any pending intent edit AND let
  // in-flight ghost-prompt saves land (their core cascade refreshes focus.md),
  // then copy — which re-reads the brief from disk, now complete. A failed
  // intent save shows its error instead of copying.
  const copyAfterSave = useCallback((): void => {
    if (brief === null) return; // not loaded — nothing meaningful to copy yet
    const pendingGhosts = ghostSavesRef.current;
    ghostSavesRef.current = [];
    void Promise.allSettled(pendingGhosts)
      .then(() => flushIntent())
      .then((ok) => {
        if (ok) onCopy();
      });
  }, [flushIntent, onCopy, brief]);

  if (!open) return null;

  // Parser drift → fall back to the raw cleaned brief (monospaced) rather than a
  // blank panel; the content is still there, just unstyled.
  const parsedNothing = brief !== null && !brief.intent && brief.items.length === 0 && !brief.empty;
  const showRaw = parsedNothing && raw.trim().length > 0;
  // Files in context that carry NO note — for these the agent gets a bare
  // filename. Surfaced in the header at the exact moment the user is about to
  // commit to this brief, so a thin hand-off never happens silently.
  const noteless =
    brief === null ? 0 : brief.items.filter((i) => !i.prompt || i.prompt.trim() === '').length;

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
          {noteless > 0 && (
            <span
              data-testid="brief-thin-warning"
              style={{ color: color.warning, textTransform: 'none', letterSpacing: 0 }}
            >
              {' '}
              — {noteless} {noteless === 1 ? 'file has' : 'files have'} no notes yet
            </span>
          )}
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
            {/* Intent — the turn's QUESTION. Editable so the agent gets context
                AND the ask in one place. Saves on blur / Enter via
                focus.setIntent. */}
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
                  if (isImeComposing(e)) return; // don't commit mid-composition
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
              <div style={{ color: color.textTertiary }}>No files in Agent Context.</div>
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
                        <>
                          <div
                            style={{ color: color.textSecondary, lineHeight: 1.5, marginTop: 1 }}
                          >
                            {item.prompt}
                          </div>
                          {item.stale && (
                            // The agent reads this caveat — "what your agent
                            // reads" must show it too, or the preview lies.
                            <div
                              data-testid={`brief-stale-${item.file}`}
                              style={{
                                color: color.warning,
                                fontSize: font.size.micro,
                                marginTop: 1,
                              }}
                            >
                              note may be stale: {item.stale}
                            </div>
                          )}
                        </>
                      ) : (
                        <GhostPromptEditor
                          file={item.file}
                          onSaved={() => setReloadTick((n) => n + 1)}
                          registerSave={(p) => ghostSavesRef.current.push(p)}
                        />
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

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import type {
  BadgeFile,
  BadgeGetResult,
  InboundGetResult,
  WorkspaceReadFileResult,
} from '@basehalf/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { emitBadgeChange } from '../lib/badgeBus.js';
import { bhSchema } from '../lib/blocknoteSchema.js';
import { registerFlusher, unregisterFlusher } from '../lib/editorFlush.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import {
  type LiveDocView,
  acquireDoc,
  claimSeed,
  docKeyFor,
  ensureDoc,
  releaseDoc,
} from '../lib/liveDoc.js';
import { type MdEditorApi, buildLoadProjection, spliceSave } from '../lib/mdSegment.js';
import { scrollToFirstMatch } from '../lib/scrollToMatch.js';
import { modeOf } from '../lib/viewerMode.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { prompt as promptDialog } from './Dialog.js';
import { Button } from './primitives/Button.js';

function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): ((...args: TArgs) => void) & { cancel: () => void; flush: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: TArgs | undefined;
  const wrapped = (...args: TArgs): void => {
    pending = args;
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      pending = undefined;
      fn(...args);
    }, ms);
  };
  // Cancel a pending call — used to drop a queued auto-save when the editor
  // unmounts, so it can't fire against a stale closure after a context switch.
  wrapped.cancel = (): void => {
    if (t) clearTimeout(t);
    t = undefined;
    pending = undefined;
  };
  // Run a pending call immediately — used on close/unmount of fields whose
  // edit must persist (e.g. the badge prompt) instead of being dropped with
  // the timer when the user closes within the debounce window.
  wrapped.flush = (): void => {
    if (t) clearTimeout(t);
    t = undefined;
    if (pending !== undefined) {
      const args = pending;
      pending = undefined;
      fn(...args);
    }
  };
  return wrapped;
}

function splitPath(rel: string): { dirname: string; basename: string } {
  const i = rel.lastIndexOf('/');
  return i === -1
    ? { dirname: '', basename: rel }
    : { dirname: rel.slice(0, i), basename: rel.slice(i + 1) };
}

/** The editor body for ONE pane's active file. The pane (EditorSpace) supplies
 *  `file`, the pane `paneId` (for the flush registry + close), and whether the
 *  pane is the active one (only it consumes the search jump-to-match).
 *  `showBadge` renders the badge backpack panel (prompt + references) above the
 *  content — the right panel leaves it OFF (the badge lives on the canvas); the
 *  canvas floating preview turns it ON. */
export const FilePreview = ({
  file,
  paneId,
  isActive,
  showBadge = false,
}: { file: string; paneId: string; isActive: boolean; showBadge?: boolean }): JSX.Element => {
  const openMatchQuery = useWorkspaceStore((s) => s.openMatchQuery);
  const clearOpenMatchQuery = useWorkspaceStore((s) => s.clearOpenMatchQuery);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const wsPath = workspaces.find((w) => w.name === current)?.path ?? '';
  // The scrollable content area; jump-to-match (below) searches its rendered
  // text for a content-search hit.
  const contentRef = useRef<HTMLDivElement>(null);

  // Jump-to-match: when a file is opened FROM a content-search hit, land on the
  // passage. Only the ACTIVE pane consumes it (the search-open targets the active
  // pane). Scoped to the MD editor — its block-per-element layout makes a matched
  // text node resolve to a single block (a clean scroll target); anything else
  // (the single-<pre> text viewer, media) just opens at the top, so we consume
  // the target without scrolling. We search ONLY the BlockNote editable body
  // (`[contenteditable]`), never the editor chrome. The editable renders async,
  // so we retry on a short cadence until it appears + the match is found.
  useEffect(() => {
    if (!isActive || openMatchQuery === null) return;
    if (modeOf(file) !== 'md') {
      clearOpenMatchQuery();
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer = 0;
    const tick = (): void => {
      if (cancelled) return;
      const body = contentRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (body != null && scrollToFirstMatch(body, openMatchQuery)) {
        clearOpenMatchQuery();
        return;
      }
      if (++attempts >= 20) {
        clearOpenMatchQuery();
        return;
      }
      timer = window.setTimeout(tick, 150);
    };
    timer = window.setTimeout(tick, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isActive, file, openMatchQuery, clearOpenMatchQuery]);

  const mode = modeOf(file);
  const absPath = `${wsPath}/${file}`;
  const { basename } = splitPath(file);

  return (
    // The editor PANEL — the body of the active right-panel tab. Its width + left
    // resize sash + the tab strip (file identity + close) live in EditorSpace; the
    // canvas sits to its left, lit and interactive, so you read/edit on the right
    // while the spatial map stays in view.
    <div
      style={{
        // flex:1 + minWidth:0 so we FILL the pane / float (both are flex-row
        // parents). Without this the editor shrink-wraps to its content width,
        // leaving the text in a small left block with big empty space.
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
      {showBadge && <BadgeProperties file={file} paneId={paneId} />}
      <div ref={contentRef} style={{ flex: 1, overflow: 'auto' }}>
        {mode === 'md' && <MdEditor key={file} file={file} paneId={paneId} />}
        {mode === 'text' && <TextViewer key={file} file={file} />}
        {mode === 'pdf' && <PdfViewer absPath={absPath} />}
        {mode === 'image' && <ImageViewer absPath={absPath} />}
        {mode === 'audio' && (
          // Center the player with a glyph + filename so a lone audio bar
          // doesn't look stranded in a tall panel.
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: space[4],
              padding: space[6],
              background: color.surfaceMuted,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.xl,
                background: color.surface,
                border: `1px solid ${color.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: color.textTertiary,
              }}
            >
              <svg
                width={26}
                height={26}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 7v2M6.5 4.8v6.4M9 3.2v9.6M11.5 5.6v4.8" />
              </svg>
            </div>
            <div
              style={{
                fontSize: font.size.body,
                fontWeight: font.weight.medium,
                color: color.textPrimary,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {basename}
            </div>
            <audio controls src={`file://${absPath}`} style={{ width: '100%', maxWidth: 360 }}>
              <track kind="captions" />
            </audio>
          </div>
        )}
        {mode === 'video' && (
          // Dark backing + rounded frame so video reads as a player, not a
          // raw element on white.
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: space[4],
              background: '#1b1b1d',
            }}
          >
            <video
              controls
              src={`file://${absPath}`}
              style={{
                width: '100%',
                maxHeight: '100%',
                borderRadius: radius.lg,
                boxShadow: shadow.raised,
              }}
            >
              <track kind="captions" />
            </video>
          </div>
        )}
        {mode === 'other' && <UnsupportedFileViewer file={file} absPath={absPath} />}
      </div>
    </div>
  );
};

// BadgeProperties is the "背包" editor — the agent-protocol contract surface.
// Per IR-v2-04, every badge has a prompt + references + position; users need
// to edit prompt/references here (canvas only handles position via drag).
// Without this UI, badge.prompt was effectively write-only-by-CLI.
const BadgeProperties = ({
  file,
  paneId,
}: { file: string; paneId: string }): JSX.Element | null => {
  const [badge, setBadge] = useState<BadgeFile | null>(null);
  const [prompt, setPrompt] = useState('');
  const [inbound, setInbound] = useState<readonly { from: string; note?: string }[]>([]);
  const inboundCount = inbound.length;
  // Surfaced when a badge write (prompt or a reference edit) fails, so the
  // user never silently loses curation work they thought they saved. Cleared
  // on the next successful write.
  const [saveError, setSaveError] = useState<string | null>(null);
  // For the prompt textarea's own Escape-to-close (the global handler skips
  // form fields, so the field closes the active tab itself).
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bh:badge-props-collapsed') === '1';
    } catch {
      return false;
    }
  });

  // (Re)load the badge whenever the file changes. We need to reset prompt
  // state too — otherwise switching files would briefly show the prior
  // file's prompt while the load is in flight.
  useEffect(() => {
    let cancelled = false;
    setPrompt('');
    setBadge(null);
    setInbound([]);
    void (async () => {
      try {
        const b = (await window.bh.run('badge.get', {
          file,
          kind: 'file',
        })) as BadgeGetResult;
        if (cancelled) return;
        setBadge(b);
        setPrompt(b?.prompt ?? '');
        const ib = (await window.bh.run('inbound.get', { file })) as InboundGetResult;
        if (cancelled) return;
        setInbound(ib.entries);
      } catch {
        // Badge may not be materialized yet (e.g. brand-new file the
        // watcher hasn't picked up). Silent — Canvas surfaces fatal errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // NOTE: a panel edit to a FOCUSED file must refresh `.bh/focus.md` (it inlines
  // each focused file's prompt + ref-notes — the turn brief, #91). That used to
  // be patched here in the renderer; it's now done in CORE — `badge.set` /
  // `addRef` / `removeRef` call `focus.resync`, which re-inlines the active
  // brief (preserving `intent:`) under a focus-file mutex, so the refresh
  // happens inside each `window.bh.run('badge.…')` await below and covers CLI /
  // agent edits too, not just this panel. So there's no renderer resync to call.

  // Debounced prompt save — typing in a textarea shouldn't write per keystroke.
  const savePrompt = useMemo(
    () =>
      debounce(async (next: string) => {
        try {
          await window.bh.run('badge.set', { file, kind: 'file', patch: { prompt: next } });
          setSaveError(null);
          emitBadgeChange(); // live-update the canvas badge's prompt
          // focus.md is refreshed by core (badge.set → focus.resync); see NOTE above.
        } catch (err) {
          // The prompt is the literal instruction to the agent — never lose it
          // silently. Surface so the user knows their edit didn't land.
          setSaveError(`Couldn't save prompt: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, 500),
    [file],
  );

  // Persist a just-typed prompt when the panel unmounts (Esc / Cmd-W / file or
  // workspace switch) rather than dropping the queued save with its timer.
  useEffect(() => () => savePrompt.flush(), [savePrompt]);

  const removeRef = useCallback(
    async (to: string) => {
      try {
        await window.bh.run('badge.removeRef', { file, to });
        setBadge((b) => (b ? { ...b, references: b.references.filter((r) => r.to !== to) } : b));
        setSaveError(null);
        emitBadgeChange(); // live-remove the edge from the canvas
        // focus.md refreshed by core (badge.removeRef → focus.resync); see NOTE above.
      } catch (err) {
        setSaveError(
          `Couldn't remove reference: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [file],
  );

  const updateRefNote = useCallback(
    async (to: string, note: string) => {
      const trimmed = note.trim();
      try {
        await window.bh.run('badge.addRef', {
          file,
          to,
          ...(trimmed !== '' && { note: trimmed }),
        });
        setBadge((b) =>
          b
            ? {
                ...b,
                // Clearing a note must DROP it locally too — core writes `{ to }`
                // (no note), so spreading `{}` would keep the stale note in the
                // optimistic copy and ReferenceRow would snap the input back to it.
                references: b.references.map((r) =>
                  r.to === to ? (trimmed !== '' ? { ...r, note: trimmed } : { to: r.to }) : r,
                ),
              }
            : b,
        );
        setSaveError(null);
        emitBadgeChange(); // live-update the edge's note on the canvas
        // focus.md refreshed by core (badge.addRef → focus.resync); see NOTE above.
      } catch (err) {
        setSaveError(
          `Couldn't save reference note: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [file],
  );

  // Add a reference to a different file. Driven by a prompt dialog so
  // users editing in the BadgeProperties panel don't have to leave it,
  // go to the canvas, and drag from this badge's handle to the target.
  // Validation: non-empty, not self, not a duplicate of an existing ref.
  // Path existence isn't checked — badge.addRef accepts any
  // workspace-relative path and orphan refs are surfaced visually on the
  // canvas; that matches drag-from-handle behavior.
  const addRefViaPrompt = useCallback(async () => {
    const to = await promptDialog({
      title: 'Add reference',
      body: 'Workspace-relative path to the file or folder this badge depends on.',
      label: 'Target path',
      placeholder: 'e.g. theory.md  or  notes/chapter-3.md',
      validate: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'A path is required.';
        if (t === file) return "Can't reference itself.";
        if (badge?.references.some((r) => r.to === t)) return 'This reference already exists.';
        return null;
      },
    });
    const trimmed = to?.trim();
    if (!trimmed) return;
    try {
      await window.bh.run('badge.addRef', { file, to: trimmed });
      setBadge((b) => (b ? { ...b, references: [...b.references, { to: trimmed }] } : b));
      setSaveError(null);
      emitBadgeChange(); // live-add the edge to the canvas
      // focus.md refreshed by core (badge.addRef → focus.resync); see NOTE above.
    } catch (err) {
      setSaveError(`Couldn't add reference: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [file, badge]);

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('bh:badge-props-collapsed', next ? '1' : '0');
      } catch {
        // localStorage unavailable; just don't persist.
      }
      return next;
    });
  };

  const refCount = badge?.references.length ?? 0;
  const hasPrompt = prompt.length > 0;
  const headerSummary = collapsed
    ? `${hasPrompt ? '✎ prompt · ' : 'no prompt · '}${refCount} out · ${inboundCount} in`
    : '';

  return (
    <section
      style={{
        borderBottom: `1px solid ${color.border}`,
        background: color.surfaceMuted,
        fontFamily: font.sans,
      }}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Show badge properties' : 'Hide badge properties'}
        style={{
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          padding: `${space[2]}px ${space[4]}px`,
          fontSize: font.size.micro,
          color: color.textTertiary,
          cursor: 'pointer',
          letterSpacing: font.trackedCaps,
          textTransform: 'uppercase',
          fontWeight: font.weight.medium,
          display: 'flex',
          alignItems: 'center',
          gap: space[1.5],
          transition: transition(['color']),
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = color.textSecondary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = color.textTertiary;
        }}
      >
        <Chevron open={!collapsed} />
        <span>Badge</span>
        {collapsed && (
          <span
            style={{
              marginLeft: 'auto',
              textTransform: 'none',
              letterSpacing: 0,
              color: color.textTertiary,
              fontSize: font.size.caption,
              fontWeight: font.weight.regular,
            }}
          >
            {headerSummary}
          </span>
        )}
      </button>
      {!collapsed && (
        <div
          style={{
            padding: `${space[1]}px ${space[4]}px ${space[4]}px`,
            display: 'flex',
            flexDirection: 'column',
            gap: space[3],
          }}
        >
          <label style={{ display: 'block' }}>
            <div
              style={{
                color: color.textSecondary,
                marginBottom: space[1],
                fontSize: font.size.caption,
                fontWeight: font.weight.medium,
              }}
            >
              Prompt
              <span
                style={{
                  color: color.textTertiary,
                  marginLeft: space[1.5],
                  fontWeight: font.weight.regular,
                }}
              >
                what agents read about this file
              </span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                savePrompt(e.target.value);
              }}
              onKeyDown={(e) => {
                // Escape closes the active tab in one press from here too (the
                // global handler skips form fields). Persist first.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  savePrompt.flush();
                  closeTab(paneId, file);
                }
              }}
              placeholder="e.g. teacher emphasized chapters 1, 3, 6, 7, 9"
              rows={3}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: `${space[2]}px ${space[3]}px`,
                fontSize: font.size.body,
                fontFamily: font.sans,
                color: color.textPrimary,
                border: `1px solid ${color.borderStrong}`,
                borderRadius: radius.md,
                resize: 'vertical',
                background: color.surface,
                outline: 'none',
                transition: transition(['border-color', 'box-shadow']),
                lineHeight: 1.45,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = color.accent;
                e.currentTarget.style.boxShadow = shadow.focus;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = color.borderStrong;
                e.currentTarget.style.boxShadow = 'none';
                // Persist immediately on leaving the field rather than waiting
                // out the 500ms debounce.
                savePrompt.flush();
              }}
            />
          </label>
          {saveError && (
            <div
              role="alert"
              style={{
                marginTop: space[2],
                padding: `${space[1.5]}px ${space[3]}px`,
                fontSize: font.size.caption,
                fontFamily: font.sans,
                color: color.danger,
                background: `${color.danger}14`,
                border: `1px solid ${color.danger}33`,
                borderRadius: radius.md,
              }}
            >
              {saveError}
            </div>
          )}
          <div>
            <div
              style={{
                color: color.textSecondary,
                marginBottom: space[1.5],
                fontSize: font.size.caption,
                fontWeight: font.weight.medium,
                display: 'flex',
                alignItems: 'center',
                gap: space[2],
              }}
            >
              <span>
                References{' '}
                <span style={{ color: color.textTertiary, fontWeight: font.weight.regular }}>
                  {refCount} out · {inboundCount} in
                </span>
              </span>
              <div style={{ marginLeft: 'auto' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void addRefViaPrompt()}
                  title="Add an outbound reference by path (alternative to dragging from the badge handle on the canvas)"
                >
                  + Add
                </Button>
              </div>
            </div>
            {refCount === 0 ? (
              <div
                style={{
                  color: color.textTertiary,
                  fontSize: font.size.caption,
                  lineHeight: 1.5,
                }}
              >
                Drag from this badge's right edge to another badge — or click "+ Add" above to type
                a path.
              </div>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: space[1],
                }}
              >
                {badge?.references.map((ref) => (
                  <ReferenceRow
                    key={ref.to}
                    to={ref.to}
                    note={ref.note ?? ''}
                    onRemove={() => void removeRef(ref.to)}
                    onNoteCommit={(note) => void updateRefNote(ref.to, note)}
                  />
                ))}
              </ul>
            )}
            {inboundCount > 0 && <InboundList entries={inbound} />}
          </div>
        </div>
      )}
    </section>
  );
};

/** Read-only list of files that REFERENCE the current file (backlinks).
 *  To remove an inbound link, the user edits the source file's outbound
 *  list — same as how Wikilink-style apps work. Clicking a row opens
 *  the source file in the preview. */
const InboundList = ({
  entries,
}: {
  readonly entries: readonly { from: string; note?: string }[];
}): JSX.Element => {
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  return (
    <div style={{ marginTop: space[3] }}>
      <div
        style={{
          color: color.textSecondary,
          marginBottom: space[1.5],
          fontSize: font.size.caption,
          fontWeight: font.weight.medium,
        }}
      >
        Inbound{' '}
        <span style={{ color: color.textTertiary, fontWeight: font.weight.regular }}>
          {entries.length} file{entries.length === 1 ? '' : 's'} point here
        </span>
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: space[1],
        }}
      >
        {entries.map((e) => (
          <li
            key={e.from}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[1.5],
              padding: `${space[1]}px ${space[2]}px`,
              background: color.surface,
              border: `1px solid ${color.border}`,
              borderRadius: radius.md,
            }}
          >
            <span aria-hidden style={{ color: color.textTertiary, fontSize: font.size.caption }}>
              ←
            </span>
            <button
              type="button"
              onClick={() => openInPanel(e.from)}
              title={`Open ${e.from}`}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                padding: 0,
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: font.mono,
                fontSize: font.size.caption,
                color: color.accent,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                letterSpacing: -0.2,
              }}
            >
              {e.from}
            </button>
            {e.note && (
              <span
                style={{
                  color: color.textTertiary,
                  fontSize: font.size.caption,
                  fontStyle: 'italic',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {e.note}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

const Chevron = ({ open }: { open: boolean }): JSX.Element => (
  <svg
    width={10}
    height={10}
    viewBox="0 0 10 10"
    aria-hidden
    style={{
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: transition(['transform']),
      flexShrink: 0,
    }}
  >
    <path
      d="M3.5 2l3 3-3 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ReferenceRow = ({
  to,
  note,
  onRemove,
  onNoteCommit,
}: {
  to: string;
  note: string;
  onRemove: () => void;
  onNoteCommit: (note: string) => void;
}): JSX.Element => {
  const [local, setLocal] = useState(note);
  // Keep local in sync if the parent re-fetches and changes the prop.
  useEffect(() => {
    setLocal(note);
  }, [note]);
  const [hovered, setHovered] = useState(false);
  return (
    <li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[1.5],
        padding: `${space[1]}px ${space[2]}px`,
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        transition: transition(['border-color']),
      }}
    >
      <span aria-hidden style={{ color: color.textTertiary, fontSize: font.size.caption }}>
        →
      </span>
      <span
        title={to}
        style={{
          fontFamily: font.mono,
          fontSize: font.size.caption,
          color: color.textSecondary,
          maxWidth: 130,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          letterSpacing: -0.2,
        }}
      >
        {to}
      </span>
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        placeholder="note (optional)"
        style={{
          flex: 1,
          minWidth: 0,
          padding: `${space[0.5]}px ${space[1.5]}px`,
          fontSize: font.size.caption,
          fontFamily: font.sans,
          color: color.textPrimary,
          border: '1px solid transparent',
          borderRadius: radius.sm,
          background: 'transparent',
          outline: 'none',
          transition: transition(['border-color', 'background']),
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = color.borderStrong;
          e.currentTarget.style.background = color.surface;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'transparent';
          e.currentTarget.style.background = 'transparent';
          if (local !== note) onNoteCommit(local);
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        title="Remove this reference"
        style={{
          background: 'transparent',
          border: 'none',
          color: hovered ? color.danger : color.textGhost,
          cursor: 'pointer',
          fontSize: 16,
          padding: `0 ${space[1]}px`,
          lineHeight: 1,
          transition: transition(['color']),
        }}
      >
        ×
      </button>
    </li>
  );
};

const AUTOSAVE_MS = 400;

const MdEditor = ({ file, paneId }: { file: string; paneId: string }): JSX.Element => {
  // The file's shared in-memory document (created on first open, disposed on last
  // close; see lib/liveDoc). Binding the editor to its Yjs fragment makes every
  // view of this file ONE live document — both editable, char-level synced. Keyed
  // by WORKSPACE + relative path so two workspaces sharing a relative path don't
  // collide on one doc. (MdEditor is keyed by `file` in the parent and the panes
  // reset on a workspace switch, so `current` is stable for this mount.)
  const current = useWorkspaceStore((s) => s.current);
  const docKey = docKeyFor(current, file);
  const shared = ensureDoc(docKey);
  const editor = useCreateBlockNote({
    schema: bhSchema,
    collaboration: {
      fragment: shared.fragment,
      user: { name: 'me', color: color.accent },
    },
  });
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const pinTab = useWorkspaceStore((s) => s.pinTab);
  const [error, setError] = useState<string>('');
  // G-08 safety: when BlockNote's parse→serialize loop loses real CONTENT we
  // stay view-only so editing can't overwrite the original. Inferred at load.
  const [viewOnly, setViewOnly] = useState(false);
  /** Conflict banner: the file changed on disk while the user had un-flushed
   *  local edits — we don't silently clobber either side. */
  const [reloadPrompt, setReloadPrompt] = useState(false);
  // Synchronous mirror of reloadPrompt so flush() (a useCallback that can't read
  // the latest state) can refuse to write behind the conflict banner. Set
  // alongside every setReloadPrompt so it's accurate the instant flush checks.
  const reloadPromptRef = useRef(false);
  /** Write-failed banner: the LAST flush attempted a disk write that FAILED
   *  (read-only folder, ENOSPC, vanished path…), so the edits are still
   *  unpersisted. Blocks navigation (the gatekeeper reads the ref) so a
   *  switch/close can't silently drop them — paired with an explicit
   *  Retry / Discard-&-close escape so the user is never trapped. `writeFailed`
   *  drives the banner; `writeFailedRef` is the synchronous truth flush reads. */
  const [writeFailed, setWriteFailed] = useState(false);
  const writeFailedRef = useRef(false);
  const [loadKey, setLoadKey] = useState(0);
  // Shared-document ownership: is THIS view the OWNER for its file — the single
  // view that runs autosave + the watcher + the conflict gate? All views are
  // editable; the owner just owns persistence (see lib/liveDoc). Claimed on mount
  // by the first view; hands off when the owner unmounts. isOwnerRef is the
  // synchronous truth the save/watch paths read.
  const [isOwner, setIsOwner] = useState(false);
  const isOwnerRef = useRef(false);
  isOwnerRef.current = isOwner;
  // This editor's handle in the shared-doc registry (built below).
  const viewRef = useRef<LiveDocView | null>(null);
  const initialLoad = useRef(true);
  // The per-file save state — frontmatter (kept verbatim, re-prepended on save),
  // the id-keyed verbatim-reuse index, and the last-known disk bytes — lives on the
  // SHARED doc, not here: the reuse index is keyed by the seeded block ids (which
  // only the shared doc knows), so it can't be rebuilt per-view, and it must
  // survive an owner handoff. (See shared.frontmatter / shared.byId / shared.lastDisk.)
  //
  // `pendingRef` stays per-view: only the OWNER's matters (its editor receives every
  // view's edits via Yjs, so its onChange drives the single save), and navigation
  // always flushes before an owner unmounts, so it's clear at handoff.
  const pendingRef = useRef(false);
  const viewOnlyRef = useRef(false);
  viewOnlyRef.current = viewOnly;

  // Apply disk content to the SHARED doc (replaceBlocks → syncs to every view via
  // Yjs): peel any leading YAML frontmatter and keep it byte-verbatim (BlockNote
  // only ever sees the body, which is the source of truth — the projection tiles
  // it into source-exact segments so the splice-save can reuse untouched bytes,
  // see mdSegment.ts), project the body into reuse-indexed blocks, swap them in,
  // and reset the shared disk baseline. Used by the SEEDER (first open) and the
  // OWNER's external-change reload — both the only callers that touch disk.
  const applyContent = useCallback(
    async (original: string): Promise<void> => {
      initialLoad.current = true;
      const { frontmatter, body } = splitFrontmatter(original);
      shared.frontmatter = frontmatter;
      const { blocks, byId } = await buildLoadProjection(editor as unknown as MdEditorApi, body);
      shared.byId = byId;
      editor.replaceBlocks(
        editor.document,
        blocks as unknown as Parameters<typeof editor.replaceBlocks>[1],
      );
      // File = truth: the echo baseline is the EXACT disk bytes. A save only
      // happens on a real edit (the pendingRef guard in flush), and our own
      // write echoes back equal to this — so merely viewing never rewrites.
      shared.lastDisk = original;
      pendingRef.current = false;
      // Only plain .txt stays view-only — it isn't Markdown, so BlockNote would
      // reinterpret its structure. Every Markdown file is now editable; the
      // splice-save preserves anything the user doesn't touch (incl. constructs
      // BlockNote can't model, kept as read-only passthrough blocks).
      setViewOnly(/\.txt$/i.test(file));
      setReloadPrompt(false);
      setError('');
      setTimeout(() => {
        initialLoad.current = false;
      }, 50);
    },
    [editor, file, shared],
  );

  // Reload on an EXTERNAL change: the OWNER's watcher / acceptReload bump loadKey.
  // Always from DISK — an external edit lives on disk. Re-seeding the shared doc
  // (replaceBlocks) syncs every view via Yjs. Skipped on first render (loadKey 0);
  // the join effect below does the initial load. Only the owner's loadKey ever
  // changes (non-owners don't watch), so this is implicitly owner-only.
  useEffect(() => {
    if (loadKey === 0) return;
    void (async () => {
      try {
        const result = (await window.bh.run('workspace.readFile', {
          path: file,
        })) as WorkspaceReadFileResult;
        await applyContent(result.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [file, loadKey, applyContent]);

  // The actual save (OWNER only): serialize and write only when content changed.
  // Safe to call anytime (no-op when nothing's pending). Updates shared.lastDisk
  // after the write so the watcher echo of our own write compares equal + a new
  // owner inherits the right baseline.
  const flush = useCallback(
    async (force = false): Promise<void> => {
      if (viewOnlyRef.current) return;
      // Only the OWNER persists. A non-owner view's edits sync to the owner's editor
      // via Yjs, whose onChange drives the single save — so a non-owner flush (e.g.
      // a navigation flush of a non-owner pane) is a no-op.
      if (!isOwnerRef.current) return;
      // A conflict banner is up: the user's explicit Keep/Reload choice is
      // authoritative. Don't let an auto-save / Cmd-S / blur / file-switch write
      // behind it and silently clobber the external edit. keepMine() passes
      // force=true (it has cleared the ref) to honor the explicit overwrite.
      if (reloadPromptRef.current && !force) return;
      // Only the user's own edits write back. A mere open/close — or a flush before
      // switching files — must never rewrite the file, even when the projection
      // would normalize a multi-block region it can't index verbatim.
      if (!pendingRef.current) {
        writeFailedRef.current = false; // nothing pending → nothing unpersisted
        setWriteFailed(false);
        return;
      }
      let md: string;
      try {
        // Splice: untouched blocks re-emit their verbatim source; only edited/new
        // blocks are re-serialized. Frontmatter is re-prepended inside spliceSave.
        md = await spliceSave(
          editor as unknown as MdEditorApi,
          editor.document,
          shared.frontmatter,
          shared.byId,
        );
      } catch {
        return; // editor torn down mid-flush — nothing safe to write
      }
      if (md === shared.lastDisk) {
        pendingRef.current = false;
        writeFailedRef.current = false; // content matches disk → nothing unpersisted
        setWriteFailed(false);
        return;
      }
      // Last-line interlock against the in-flight race: an external edit can land
      // between the last keystroke and here (or during the spliceSave await). Unless
      // the user explicitly chose Keep-mine, re-read disk and, if it drifted from
      // what we last synced, raise the conflict instead of overwriting it.
      if (!force) {
        try {
          const disk = (
            (await window.bh.run('workspace.readFile', { path: file })) as WorkspaceReadFileResult
          ).content;
          if (disk !== shared.lastDisk) {
            reloadPromptRef.current = true;
            setReloadPrompt(true);
            return;
          }
        } catch {
          // Couldn't read (vanished/race) — fall through; the write itself will
          // surface any hard error.
        }
      }
      try {
        await window.bh.run('workspace.writeFile', { path: file, content: md });
        // Only AFTER a successful write: mark the shared baseline to the EXACT bytes
        // written (so the watcher echo compares equal + a new owner inherits the
        // right baseline) and clear pending. The reuse index is keyed by block id
        // and stays valid for the live document, so there's nothing to rebuild.
        shared.lastDisk = md;
        pendingRef.current = false;
        writeFailedRef.current = false;
        setWriteFailed(false);
      } catch (err) {
        // The write didn't land — edits remain in memory only. Flag it so the
        // navigation gatekeeper blocks a switch/close that would drop them, and
        // the write-failed banner offers Retry / Discard-&-close.
        writeFailedRef.current = true;
        setWriteFailed(true);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
      }
    },
    [editor, file, shared],
  );
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // This view's handle in the shared-doc registry. setOwner toggles the (single)
  // persistence-owner role; isOwnerRef is set synchronously so flush/onChange see
  // it the instant ownership changes.
  const view = useMemo<LiveDocView>(
    () => ({
      key: docKey,
      setOwner: (o) => {
        isOwnerRef.current = o;
        setIsOwner(o);
      },
    }),
    [docKey],
  );
  viewRef.current = view;

  // Join this file's shared document on mount: take a hold (claims the owner role
  // if vacant), and — as the FIRST view — SEED the doc from disk. Later views bind
  // to the already-seeded content (Yjs syncs them), so they don't re-read disk and
  // can't double-seed (claimSeed is atomic). Releasing on unmount hands the owner
  // role to a surviving view (see lib/liveDoc).
  useEffect(() => {
    const self = view;
    acquireDoc(self);
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    if (claimSeed(self)) {
      void (async () => {
        try {
          const { content } = (await window.bh.run('workspace.readFile', {
            path: file,
          })) as WorkspaceReadFileResult;
          await applyContent(content);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    } else {
      // Joining an already-seeded doc: the content arrives via Yjs. Set the per-view
      // flags the seeder's applyContent would have (view-only by extension, cleared
      // banners) and lift the initial-load guard once the sync has settled.
      setViewOnly(/\.txt$/i.test(file));
      setReloadPrompt(false);
      setError('');
      initialLoad.current = true;
      joinTimer = setTimeout(() => {
        initialLoad.current = false;
      }, 50);
    }
    return () => {
      if (joinTimer) clearTimeout(joinTimer);
      releaseDoc(self);
    };
  }, [file, view, applyContent]);

  // Debounced auto-save trigger — stable across renders, delegates via the ref.
  const scheduleSave = useMemo(() => debounce(() => void flushRef.current(), AUTOSAVE_MS), []);

  // Register flush with the store. setCurrentFile (file switch / close) and the
  // TopBar (workspace switch) await this BEFORE the context changes, so pending
  // edits persist while the editor is still alive. We deliberately do NOT flush
  // on unmount: by then the editor may be torn down and serialize to empty,
  // which would clobber the file. Navigation always flushes first instead.
  useEffect(() => {
    // The navigation gatekeeper, registered per pane. An unresolved conflict
    // banner is a decision point — return `false` so a tab/file switch or
    // workspace switch DON'T proceed (forcing the user to pick Keep/Reload)
    // rather than silently dropping local edits OR clobbering the external write.
    // With no conflict, flush normally (the re-read guard may itself surface one
    // mid-flush, which we also report as blocked).
    const flusher = async (): Promise<boolean> => {
      // A non-owner view has nothing to persist (the owner's autosave does) — allow
      // navigation. (Its edits already synced to the owner via Yjs.)
      if (!isOwnerRef.current) return true;
      if (reloadPromptRef.current) return false;
      await flushRef.current(false);
      // Block if a conflict surfaced mid-flush OR the write failed (edits still
      // unpersisted) — either way leaving now would lose data. The write-failed
      // banner gives an explicit Discard-&-close escape so this never traps.
      return !reloadPromptRef.current && !writeFailedRef.current;
    };
    registerFlusher(paneId, flusher);
    return () => unregisterFlusher(paneId, flusher);
  }, [paneId]);

  // Cancel any queued auto-save when this editor unmounts (file/workspace
  // switch), so it can't fire against a stale closure after the context
  // changed. Navigation has already flushed synchronously via setCurrentFile /
  // the TopBar before we get here.
  useEffect(() => () => scheduleSave.cancel(), [scheduleSave]);

  // Best-effort flush when the app/window is leaving focus or closing — covers
  // the small window between the last keystroke and the debounced auto-save
  // (e.g. Cmd-Q or Cmd-Tab right after typing). Fire-and-forget; on a hard
  // quit the IPC write may not finish, but the debounce window is short.
  useEffect(() => {
    const onLeave = (): void => {
      // Gated flush: persists pending edits when there's no conflict, and
      // no-ops while a banner is up (the editor stays mounted across blur, so
      // nothing is lost — the user still resolves Keep/Reload on return).
      void flushRef.current(false);
    };
    window.addEventListener('beforeunload', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  // Watch this file for *external* changes (the agent or another app editing
  // it). Defer the "deleted" warning past the rename window so a rename
  // (unlink+add) doesn't flash it.
  useEffect(() => {
    let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = window.bh.onFileEvent((event) => {
      // Only the OWNER reacts to disk events — it reloads into the shared doc, which
      // syncs every other view via Yjs. (A non-owner reacting too would double-handle.)
      if (!isOwnerRef.current) return;
      if (event.type === 'rename') {
        if (event.fromRelPath === file && pendingDeleteTimer) {
          clearTimeout(pendingDeleteTimer);
          pendingDeleteTimer = null;
        }
        return;
      }
      if (event.relPath !== file) return;
      if (event.type === 'change') {
        void (async () => {
          let disk = '';
          try {
            disk = (
              (await window.bh.run('workspace.readFile', {
                path: file,
              })) as WorkspaceReadFileResult
            ).content;
          } catch {
            return;
          }
          // Our own auto-save echoes back as a change event — ignore it.
          if (disk === shared.lastDisk) return;
          if (pendingRef.current) {
            // Genuine external edit collides with local edits → conflict banner.
            // CANCEL the armed auto-save + set the sync ref so the debounced
            // flush (or a Cmd-S / blur) can't fire and clobber the external edit
            // before the user picks Keep / Reload.
            reloadPromptRef.current = true;
            setReloadPrompt(true);
            scheduleSave.cancel();
          } else {
            shared.lastDisk = disk;
            setLoadKey((k) => k + 1); // adopt the external change
          }
        })();
      } else if (event.type === 'unlink') {
        if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = setTimeout(() => {
          pendingDeleteTimer = null;
          setError('File deleted on disk.');
        }, 300);
      }
    });
    return () => {
      if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
      unsub();
    };
  }, [file, scheduleSave, shared]);

  const acceptReload = useCallback(() => {
    reloadPromptRef.current = false;
    setReloadPrompt(false);
    pendingRef.current = false;
    writeFailedRef.current = false; // reloading disk = nothing unpersisted
    setWriteFailed(false);
    setLoadKey((k) => k + 1); // discard local, load the disk version
  }, []);

  const keepMine = useCallback(() => {
    reloadPromptRef.current = false;
    setReloadPrompt(false);
    void flushRef.current(true); // force-overwrite disk with the local version
  }, []);

  // Write-failed escape hatch. A persistently-unwritable file (read-only folder,
  // ENOSPC, vanished path) would otherwise trap the editor — the gatekeeper
  // blocks every switch/close. "Retry" re-attempts the save; "Discard & close"
  // drops the unsaved edits and force-closes (bypassFlush skips the gate).
  const retryWrite = useCallback(() => {
    void flushRef.current(false);
  }, []);
  const discardAndClose = useCallback(() => {
    writeFailedRef.current = false;
    setWriteFailed(false);
    pendingRef.current = false;
    closeTab(paneId, file, { bypassFlush: true });
  }, [closeTab, paneId, file]);

  // Cmd/Ctrl+S still works as "save now" for muscle memory (auto-save covers
  // it anyway). Registered once; delegates through the ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // Gated: saves normally, but no-ops while a conflict banner is up so
        // Cmd-S can't bypass the explicit Keep/Reload decision and clobber disk.
        void flushRef.current(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* No save-status line — auto-save runs silently (debounced + flushed on
          close/switch/workspace-change). The only status row kept is the
          read-only notice for plain-text files, so a non-editable .txt isn't a
          mystery. The disk-conflict / write-failed banners below stay — those
          are data-loss decision points, not status noise. */}
      {viewOnly && (
        <div
          style={{
            padding: `${space[2]}px ${space[4]}px`,
            background: color.surfaceMuted,
            borderBottom: `1px solid ${color.border}`,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
            color: color.warning,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: color.warning,
              flexShrink: 0,
            }}
          />
          <span>
            View only — plain-text files are read-only here; edit them with your own tools
          </span>
        </div>
      )}
      {reloadPrompt && (
        <div
          style={{
            padding: `${space[2]}px ${space[4]}px`,
            background: color.warningSoft,
            borderBottom: `1px solid ${color.warning}33`,
            color: color.warning,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
            animation: `bh-banner-in ${motion.normal}`,
          }}
        >
          <span style={{ flex: 1 }}>This file changed on disk while you were editing.</span>
          <Button variant="primary" size="sm" onClick={keepMine}>
            Keep my edits
          </Button>
          <Button variant="ghost" size="sm" onClick={acceptReload}>
            Reload from disk
          </Button>
        </div>
      )}
      {writeFailed && !reloadPrompt && (
        <div
          style={{
            padding: `${space[2]}px ${space[4]}px`,
            background: color.dangerSoft,
            borderBottom: `1px solid ${color.danger}33`,
            color: color.danger,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
            animation: `bh-banner-in ${motion.normal}`,
          }}
        >
          <span style={{ flex: 1 }}>
            Couldn't save this file{error ? ` — ${error}` : ''}. Your edits are still here.
          </span>
          <Button variant="primary" size="sm" onClick={retryWrite}>
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={discardAndClose}>
            Discard &amp; close
          </Button>
        </div>
      )}
      {error && !writeFailed && (
        <div
          style={{
            padding: `${space[2]}px ${space[4]}px`,
            background: color.dangerSoft,
            color: color.danger,
            fontSize: font.size.caption,
            fontFamily: font.sans,
            borderBottom: `1px solid ${color.danger}33`,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* The editor FILLS the pane (like a code editor) — just a vertical
            rhythm + a modest horizontal gutter, no narrow centered column. The
            pane's own width is the measure; widen the pane for a wider editor. */}
        <div style={{ padding: `${space[5]}px ${space[5]}px` }}>
          <BlockNoteView
            editor={editor}
            // Every view of the file is editable — they share one Yjs document, so
            // edits merge char-level and never diverge.
            editable={!viewOnly}
            theme="dark"
            onChange={() => {
              if (initialLoad.current || viewOnly) return;
              // Editing a preview tab promotes it to a permanent (pinned) tab —
              // idempotent (no-op once pinned), like a mature editor.
              pinTab(paneId, file);
              // Only the OWNER schedules the save. onChange fires here for THIS
              // view's own edits AND (on the owner) for edits synced in from other
              // views via Yjs — so the owner's autosave covers every view.
              if (isOwnerRef.current) {
                pendingRef.current = true;
                scheduleSave();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};

// Code with a line-number gutter: the gutter is sticky-left so it stays put on
// horizontal scroll, and scrolls with the code vertically (shared scroll
// container). Matching font/line-height keeps the numbers aligned with their
// lines; white-space:pre (no wrap) guarantees one logical line == one row.
//
// Normalize line endings to \n FIRST: a CRLF (Windows) file otherwise keeps a
// stray \r on every line, which a white-space:pre block can render as an extra
// segment break (double-spacing) and pollutes any copy of the code. Normalizing
// keeps the rendered lines matching the gutter. (Display-only; we never write.)
const CodeBody = ({ text }: { text: string }): JSX.Element => {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const lineCount = body === '' ? 1 : body.split('\n').length;
  const gutter = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n');
  const lineStyle: CSSProperties = {
    margin: 0,
    fontFamily: font.mono,
    fontSize: font.size.caption,
    lineHeight: 1.6,
    whiteSpace: 'pre',
    tabSize: 2,
  };
  return (
    <div style={{ display: 'flex', minHeight: '100%' }}>
      <pre
        aria-hidden
        style={{
          ...lineStyle,
          padding: `${space[4]}px ${space[3]}px`,
          textAlign: 'right',
          color: color.textGhost,
          background: color.surfaceMuted,
          borderRight: `1px solid ${color.divider}`,
          userSelect: 'none',
          position: 'sticky',
          left: 0,
          flexShrink: 0,
        }}
      >
        {gutter}
      </pre>
      <pre
        style={{
          ...lineStyle,
          padding: `${space[4]}px ${space[4]}px ${space[4]}px ${space[3]}px`,
          color: color.textPrimary,
        }}
      >
        {body}
      </pre>
    </div>
  );
};

// Read-only viewer for code + text files (the editor handles .md/.txt; media
// have their own viewers). bh is the workspace VIEW for these — agents/IDEs do
// the editing — so this is deliberately read-only, with a quiet line saying so.
// Huge files are capped to keep a <pre> from janking the UI.
const TEXT_VIEW_CAP = 200_000;
const TextViewer = ({ file }: { file: string }): JSX.Element => {
  const [state, setState] = useState<{ text: string; truncated: boolean; binary: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // A file optimistically routed here can turn out binary (the content-sniff
  // flags it). Offer the same "open in default app" escape hatch the
  // UnsupportedFileViewer gives, so a sniffed binary is never a dead end.
  const [openError, setOpenError] = useState<string | null>(null);
  const openInApp = useCallback(async () => {
    setOpenError(null);
    try {
      const res = await window.bh.openPath(file);
      if (!res.ok) setOpenError(res.error ?? "Couldn't open the file.");
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    void (async () => {
      try {
        // Ask core for only the prefix we'll render — a multi-MB file (a big
        // package-lock.json, a minified bundle, a long .log) must NOT be shipped
        // whole across IPC and held in renderer memory just to show 200k chars.
        const res = (await window.bh.run('workspace.readFile', {
          path: file,
          maxChars: TEXT_VIEW_CAP,
        })) as WorkspaceReadFileResult;
        if (!cancelled) {
          setState({
            text: res.content ?? '',
            truncated: res.truncated === true,
            binary: res.binary === true,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[2]}px ${space[4]}px`,
          borderBottom: `1px solid ${color.divider}`,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          color: color.textTertiary,
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: '50%', background: color.textGhost }}
        />
        Read-only — edit with your own tools
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {error !== null ? (
          <div
            style={{
              padding: space[4],
              fontFamily: font.sans,
              fontSize: font.size.caption,
              color: color.danger,
            }}
          >
            {error}
          </div>
        ) : state === null ? (
          <div
            style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}
          >
            …
          </div>
        ) : (
          <>
            {state.binary ? (
              // Content-sniff found binary bytes in a file optimistically routed
              // to the text viewer. Show a clean message + an open-in-app
              // affordance instead of rendering mojibake or dead-ending.
              <div
                style={{
                  padding: space[4],
                  fontFamily: font.sans,
                  fontSize: font.size.caption,
                  color: color.textTertiary,
                  lineHeight: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: space[3],
                  alignItems: 'flex-start',
                }}
              >
                <span>This looks like a binary file, so it can’t be shown as text.</span>
                <Button variant="primary" onClick={() => void openInApp()}>
                  Open in default app
                </Button>
                {openError !== null && <span style={{ color: color.danger }}>{openError}</span>}
              </div>
            ) : state.text === '' ? (
              <div
                style={{
                  padding: space[4],
                  fontFamily: font.mono,
                  fontSize: font.size.caption,
                  color: color.textTertiary,
                }}
              >
                empty file
              </div>
            ) : (
              <CodeBody text={state.text} />
            )}
            {!state.binary && state.truncated && (
              <div
                style={{
                  padding: `${space[2]}px ${space[4]}px ${space[4]}px`,
                  fontFamily: font.sans,
                  fontSize: font.size.micro,
                  color: color.textTertiary,
                }}
              >
                … truncated (showing the first {TEXT_VIEW_CAP.toLocaleString()} characters) — open
                the file in your editor for the full contents.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// No inline viewer (Office docs, archives, binaries…). Rather than a dead end,
// offer to open the file in the OS default app (the roadmap's "open in system
// app" for .docx/.pptx etc.) — bh stays the workspace view; the right app does
// the rendering. Path opens are resolved inside the current workspace in main.
const UnsupportedFileViewer = ({
  file,
  absPath,
}: { file: string; absPath: string }): JSX.Element => {
  const [error, setError] = useState<string | null>(null);
  const openInApp = useCallback(async () => {
    setError(null);
    try {
      const res = await window.bh.openPath(file);
      if (!res.ok) setError(res.error ?? "Couldn't open the file.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);
  return (
    <div
      style={{
        padding: space[4],
        fontFamily: font.sans,
        fontSize: font.size.body,
        color: color.textSecondary,
        display: 'flex',
        flexDirection: 'column',
        gap: space[3],
        alignItems: 'flex-start',
      }}
    >
      <p style={{ margin: 0 }}>No built-in viewer for this file type.</p>
      <Button variant="primary" onClick={() => void openInApp()}>
        Open in default app
      </Button>
      {error !== null && (
        <p style={{ margin: 0, color: color.danger, fontSize: font.size.caption }}>{error}</p>
      )}
      <p
        style={{
          fontFamily: font.mono,
          fontSize: font.size.micro,
          color: color.textTertiary,
          margin: 0,
          wordBreak: 'break-all',
        }}
      >
        {absPath}
      </p>
    </div>
  );
};

const PdfViewer = ({ absPath }: { absPath: string }): JSX.Element => (
  <iframe
    title="PDF"
    src={`file://${absPath}`}
    style={{ width: '100%', height: '100%', border: 'none' }}
  />
);

// A subtle checkerboard so transparent images (logos, icons, screenshots
// with alpha) read as transparent — the universal image-tool convention —
// instead of blending into a flat grey fill and looking broken.
const checkerboard = {
  backgroundColor: color.surface,
  backgroundImage: `linear-gradient(45deg, ${color.surfaceMuted} 25%, transparent 25%), linear-gradient(-45deg, ${color.surfaceMuted} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${color.surfaceMuted} 75%), linear-gradient(-45deg, transparent 75%, ${color.surfaceMuted} 75%)`,
  backgroundSize: '18px 18px',
  backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0',
} as const;

const ImageViewer = ({ absPath }: { absPath: string }): JSX.Element => {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[4],
        ...checkerboard,
      }}
    >
      <img
        src={`file://${absPath}`}
        alt={absPath}
        // width/height 100% (not max-) so small images scale UP to fill
        // the panel — a 16×16 favicon was rendering as an unfindable dot.
        // imageRendering:pixelated keeps icons crisp under upscale.
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          objectFit: 'contain',
          imageRendering: 'pixelated',
        }}
        onLoad={(e) => {
          const img = e.currentTarget;
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {dims && (
        // Floating pill so the dimension read-out doesn't reflow the image
        // and stays legible over either the checkerboard or the image.
        <span
          style={{
            position: 'absolute',
            bottom: space[3],
            right: space[3],
            fontFamily: font.mono,
            fontSize: font.size.micro,
            color: color.textSecondary,
            background: 'rgba(0, 0, 0, 0.6)',
            border: `1px solid ${color.border}`,
            borderRadius: radius.pill,
            padding: `2px ${space[2]}px`,
            backdropFilter: 'blur(4px)',
          }}
        >
          {dims.w} × {dims.h}
        </span>
      )}
    </div>
  );
};

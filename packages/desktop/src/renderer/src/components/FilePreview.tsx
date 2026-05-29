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
import { isLossyRoundTrip } from '../lib/mdLossy.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { prompt as promptDialog } from './Dialog.js';
import { badgeType } from './FileGlyph.js';
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

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

type ViewerMode = 'md' | 'pdf' | 'image' | 'audio' | 'video' | 'text' | 'other';

function modeOf(path: string): ViewerMode {
  const e = extOf(path);
  if (['.md', '.markdown', '.txt'].includes(e)) return 'md';
  if (e === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(e)) return 'image';
  if (['.mp3', '.wav', '.m4a'].includes(e)) return 'audio';
  if (['.mp4', '.mov', '.webm'].includes(e)) return 'video';
  // Code (.ts/.py/.json/…) and remaining text formats (.rst/.org/.mdx) get a
  // read-only text viewer. Without it these were a dead-end "no viewer" even
  // though the canvas tile already shows their content — a glaring gap for the
  // AI-coding wedge (drop a src/ folder in, can't read a single file). bh stays
  // a read-only workspace view here; agents/IDEs edit code with their own tools.
  const bt = badgeType(path.slice(path.lastIndexOf('/') + 1), false);
  if (bt === 'code' || bt === 'text') return 'text';
  return 'other';
}

function splitPath(rel: string): { dirname: string; basename: string } {
  const i = rel.lastIndexOf('/');
  return i === -1
    ? { dirname: '', basename: rel }
    : { dirname: rel.slice(0, i), basename: rel.slice(i + 1) };
}

export const FilePreview = (): JSX.Element | null => {
  const currentFile = useWorkspaceStore((s) => s.currentFile);
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const wsPath = workspaces.find((w) => w.name === current)?.path ?? '';

  // Esc / Cmd-W close the preview. Cmd-W matches macOS muscle memory for
  // closing a panel/tab. setCurrentFile(null) flushes the editor before
  // clearing (see store), so closing always persists pending edits.
  useEffect(() => {
    if (!currentFile) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Close from the document body and the media viewers (DIV targets).
        // Skip when a form field has focus: both BlockNote (a contentEditable
        // DIV — not matched here, so the editor body DOES close) and form
        // fields can preventDefault Escape, so a `defaultPrevented` check is
        // unreliable. Form fields handle their own Escape — the badge-prompt
        // textarea closes on Escape via its scoped onKeyDown below — so a stray
        // Escape mid-typing in another field doesn't yank the panel shut.
        const tag = (e.target as HTMLElement | null)?.tagName ?? '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setCurrentFile(null);
      } else if (e.key === 'w' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCurrentFile(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentFile, setCurrentFile]);

  if (!currentFile) return null;
  const mode = modeOf(currentFile);
  const absPath = `${wsPath}/${currentFile}`;
  const { dirname, basename } = splitPath(currentFile);

  return (
    // Centered overlay (not a side drawer): the file opens BIG so there's
    // real room to read and write, while the canvas dims behind it — you never
    // lose the sense of "I'm still in my space, looking closely at one thing."
    // position:absolute scopes the dim to the canvas area (its containing
    // block is the relative <main>), so the Sidebar + TopBar stay lit: you can
    // switch files without closing the editor. mousedown-on-backdrop (not
    // click) dismisses, so a text selection that drags out of the card doesn't
    // accidentally close it. The card stays an <aside> (driver counts asides).
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCurrentFile(null);
      }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: 'rgba(24, 26, 32, 0.34)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[6],
        animation: `bh-fade-in ${motion.fast}`,
      }}
    >
      <aside
        style={{
          width: 'min(1040px, 100%)',
          height: 'min(900px, 100%)',
          background: color.surface,
          borderRadius: radius.xl,
          boxShadow: shadow.floating,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: `bh-dialog-in ${motion.normal}`,
        }}
      >
        <header
          style={{
            padding: `${space[3]}px ${space[4]}px`,
            borderBottom: `1px solid ${color.border}`,
            background: color.surface,
            fontFamily: font.sans,
            display: 'flex',
            alignItems: 'center',
            gap: space[2],
          }}
          title={currentFile}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <strong
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: color.textPrimary,
                fontSize: font.size.body,
                fontWeight: font.weight.semibold,
                letterSpacing: -0.1,
              }}
            >
              {basename}
            </strong>
            {dirname && (
              <span
                style={{
                  fontSize: font.size.micro,
                  color: color.textTertiary,
                  fontFamily: font.mono,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  letterSpacing: -0.2,
                }}
              >
                {dirname}/
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentFile(null)}
            title="Close (Esc)"
          >
            Close
          </Button>
        </header>
        <BadgeProperties file={currentFile} />
        <div style={{ flex: 1, overflow: 'auto' }}>
          {mode === 'md' && <MdEditor key={currentFile} file={currentFile} />}
          {mode === 'text' && <TextViewer key={currentFile} file={currentFile} />}
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
          {mode === 'other' && (
            <div
              style={{
                padding: space[4],
                fontFamily: font.sans,
                fontSize: font.size.body,
                color: color.textSecondary,
              }}
            >
              <p style={{ margin: 0, marginBottom: space[2] }}>
                No built-in viewer for this file type.
              </p>
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
          )}
        </div>
      </aside>
    </div>
  );
};

// BadgeProperties is the "背包" editor — the agent-protocol contract surface.
// Per IR-v2-04, every badge has a prompt + references + position; users need
// to edit prompt/references here (canvas only handles position via drag).
// Without this UI, badge.prompt was effectively write-only-by-CLI.
const BadgeProperties = ({ file }: { file: string }): JSX.Element | null => {
  const [badge, setBadge] = useState<BadgeFile | null>(null);
  const [prompt, setPrompt] = useState('');
  const [inbound, setInbound] = useState<readonly { from: string; note?: string }[]>([]);
  const inboundCount = inbound.length;
  // Surfaced when a badge write (prompt or a reference edit) fails, so the
  // user never silently loses curation work they thought they saved. Cleared
  // on the next successful write.
  const [saveError, setSaveError] = useState<string | null>(null);
  // For the prompt textarea's own Escape-to-close (the global handler skips
  // form fields, so the field closes the panel itself).
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
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

  // Debounced prompt save — typing in a textarea shouldn't write per keystroke.
  const savePrompt = useMemo(
    () =>
      debounce(async (next: string) => {
        try {
          await window.bh.run('badge.set', { file, kind: 'file', patch: { prompt: next } });
          setSaveError(null);
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
                references: b.references.map((r) =>
                  r.to === to ? { ...r, ...(trimmed !== '' ? { note: trimmed } : {}) } : r,
                ),
              }
            : b,
        );
        setSaveError(null);
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
                // Escape leaves the editor in one press from here too (the
                // global handler skips form fields). Persist first.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  savePrompt.flush();
                  setCurrentFile(null);
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
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
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
              onClick={() => setCurrentFile(e.from)}
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

const MdEditor = ({ file }: { file: string }): JSX.Element => {
  const editor = useCreateBlockNote();
  const setFlushEditor = useWorkspaceStore((s) => s.setFlushEditor);
  const [saving, setSaving] = useState(false); // a save is pending or in flight
  const [error, setError] = useState<string>('');
  // G-08 safety: when BlockNote's parse→serialize loop loses real CONTENT we
  // stay view-only so editing can't overwrite the original. Inferred at load.
  const [viewOnly, setViewOnly] = useState(false);
  /** Conflict banner: the file changed on disk while the user had un-flushed
   *  local edits — we don't silently clobber either side. */
  const [reloadPrompt, setReloadPrompt] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const initialLoad = useRef(true);
  // What we believe is on disk — lets us ignore our own write echoes from the
  // watcher and detect genuine external edits.
  const lastDiskRef = useRef('');
  // True once the user typed but the debounced save hasn't flushed yet.
  const pendingRef = useRef(false);
  const viewOnlyRef = useRef(false);
  viewOnlyRef.current = viewOnly;

  // Load on mount / explicit reload. MdEditor is keyed by `file` in the parent,
  // so switching files remounts it and this always loads fresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey is a reload trigger — bumping it re-runs this effect to re-read the file from disk
  useEffect(() => {
    initialLoad.current = true;
    void (async () => {
      try {
        const result = (await window.bh.run('workspace.readFile', {
          path: file,
        })) as WorkspaceReadFileResult;
        const original = result.content;
        const blocks = await editor.tryParseMarkdownToBlocks(original);
        editor.replaceBlocks(
          editor.document,
          blocks as unknown as Parameters<typeof editor.replaceBlocks>[1],
        );
        const reserialized = await editor.blocksToMarkdownLossy(editor.document);
        // Seed with the NORMALIZED serialization (what flush would write), not
        // the raw disk bytes — so merely viewing + closing a file never
        // rewrites it; only a real edit (md ≠ this) triggers a save.
        lastDiskRef.current = reserialized;
        pendingRef.current = false;
        // .txt is not markdown — BlockNote would reflow it on save. Keep plain
        // text view-only so auto-save can't reformat it.
        const plainText = /\.txt$/i.test(file);
        setViewOnly(plainText || isLossyRoundTrip(original, reserialized));
        setSaving(false);
        setReloadPrompt(false);
        setError('');
        setTimeout(() => {
          initialLoad.current = false;
        }, 50);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [file, editor, loadKey]);

  // The actual save: serialize and write only when content changed. Safe to
  // call anytime (no-op when nothing's pending). Sets lastDiskRef BEFORE the
  // write so the watcher echo of our own write compares equal and is ignored.
  const flush = useCallback(async (): Promise<void> => {
    if (viewOnlyRef.current) return;
    let md: string;
    try {
      md = await editor.blocksToMarkdownLossy(editor.document);
    } catch {
      return; // editor torn down mid-flush — nothing safe to write
    }
    if (md === lastDiskRef.current) {
      pendingRef.current = false;
      setSaving(false);
      return;
    }
    try {
      await window.bh.run('workspace.writeFile', { path: file, content: md });
      // Only AFTER a successful write: mark synced (a failed write keeps
      // lastDiskRef old so the next auto-save retries) and clear pending (kept
      // true during the write so a mid-write external change still conflicts
      // rather than being silently overwritten).
      lastDiskRef.current = md;
      pendingRef.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editor, file]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Debounced auto-save trigger — stable across renders, delegates via the ref.
  const scheduleSave = useMemo(() => debounce(() => void flushRef.current(), AUTOSAVE_MS), []);

  // Register flush with the store. setCurrentFile (file switch / close) and the
  // TopBar (workspace switch) await this BEFORE the context changes, so pending
  // edits persist while the editor is still alive. We deliberately do NOT flush
  // on unmount: by then the editor may be torn down and serialize to empty,
  // which would clobber the file. Navigation always flushes first instead.
  useEffect(() => {
    setFlushEditor(() => flushRef.current());
    return () => setFlushEditor(null);
  }, [setFlushEditor]);

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
      void flushRef.current();
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
          if (disk === lastDiskRef.current) return;
          if (pendingRef.current) {
            setReloadPrompt(true); // genuine external edit collides with local edits
          } else {
            lastDiskRef.current = disk;
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
  }, [file]);

  const acceptReload = useCallback(() => {
    setReloadPrompt(false);
    pendingRef.current = false;
    setLoadKey((k) => k + 1); // discard local, load the disk version
  }, []);

  const keepMine = useCallback(() => {
    setReloadPrompt(false);
    void flushRef.current(); // overwrite disk with the local version
  }, []);

  // Cmd/Ctrl+S still works as "save now" for muscle memory (auto-save covers
  // it anyway). Registered once; delegates through the ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void flushRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const status: { label: string; dot: string; fg: string } = viewOnly
    ? {
        label: 'View only — this file uses Markdown features the editor can’t round-trip safely',
        dot: color.warning,
        fg: color.warning,
      }
    : saving
      ? { label: 'Saving…', dot: color.textTertiary, fg: color.textTertiary }
      : { label: 'Saved', dot: color.success, fg: color.textTertiary };

  const statusBarStyle: CSSProperties = {
    padding: `${space[2]}px ${space[4]}px`,
    background: color.surfaceMuted,
    borderBottom: `1px solid ${color.border}`,
    fontSize: font.size.caption,
    fontFamily: font.sans,
    display: 'flex',
    alignItems: 'center',
    gap: space[2],
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={statusBarStyle}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: status.dot,
            flexShrink: 0,
            transition: transition(['background']),
          }}
        />
        <span
          style={{
            flex: 1,
            color: status.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: viewOnly ? 'normal' : 'nowrap',
          }}
        >
          {status.label}
        </span>
        {/* No Save button — edits auto-save (debounced + flushed on close/switch). */}
      </div>
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
      {error && (
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
        {/* Cap the writing column. The overlay card is wide (room for media
            viewers), but prose past ~740px is hard to read and write — so the
            editor sits in a centered measure, like every serious text app. */}
        <div style={{ maxWidth: 760, margin: '0 auto', padding: `${space[5]}px 0` }}>
          <BlockNoteView
            editor={editor}
            editable={!viewOnly}
            onChange={() => {
              if (!initialLoad.current && !viewOnly) {
                pendingRef.current = true;
                setSaving(true);
                scheduleSave();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};

// Read-only viewer for code + text files (the editor handles .md/.txt; media
// have their own viewers). bh is the workspace VIEW for these — agents/IDEs do
// the editing — so this is deliberately read-only, with a quiet line saying so.
// Huge files are capped to keep a <pre> from janking the UI.
const TEXT_VIEW_CAP = 200_000;
const TextViewer = ({ file }: { file: string }): JSX.Element => {
  const [state, setState] = useState<{ text: string; dropped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    void (async () => {
      try {
        const res = (await window.bh.run('workspace.readFile', {
          path: file,
        })) as WorkspaceReadFileResult;
        const raw = res.content ?? '';
        if (!cancelled) {
          setState({
            text: raw.slice(0, TEXT_VIEW_CAP),
            dropped: Math.max(0, raw.length - TEXT_VIEW_CAP),
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
            <pre
              style={{
                margin: 0,
                padding: space[4],
                fontFamily: font.mono,
                fontSize: font.size.caption,
                lineHeight: 1.6,
                color: color.textPrimary,
                whiteSpace: 'pre',
                tabSize: 2,
              }}
            >
              {state.text === '' ? 'empty file' : state.text}
            </pre>
            {state.dropped > 0 && (
              <div
                style={{
                  padding: `${space[2]}px ${space[4]}px ${space[4]}px`,
                  fontFamily: font.sans,
                  fontSize: font.size.micro,
                  color: color.textTertiary,
                }}
              >
                … {state.dropped.toLocaleString()} more characters not shown — open the file in your
                editor for the full contents.
              </div>
            )}
          </>
        )}
      </div>
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
            background: 'rgba(255, 255, 255, 0.9)',
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

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
import { useWorkspaceStore } from '../store/workspace.js';
import { Button } from './primitives/Button.js';

function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): (...args: TArgs) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

type ViewerMode = 'md' | 'pdf' | 'image' | 'audio' | 'video' | 'other';

function modeOf(path: string): ViewerMode {
  const e = extOf(path);
  if (['.md', '.markdown', '.txt'].includes(e)) return 'md';
  if (e === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(e)) return 'image';
  if (['.mp3', '.wav', '.m4a'].includes(e)) return 'audio';
  if (['.mp4', '.mov', '.webm'].includes(e)) return 'video';
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
  // closing a panel/tab. Effect runs unconditionally (hook-order rule) and
  // bails when no file is open.
  useEffect(() => {
    if (!currentFile) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.key === 'Escape') {
        // Don't fight BlockNote's own escape handling (e.g. exit a slash menu).
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
    <aside
      style={{
        width: 480,
        borderLeft: `1px solid ${color.border}`,
        background: color.surface,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
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
        <Button variant="ghost" size="sm" onClick={() => setCurrentFile(null)} title="Close (Esc)">
          Close
        </Button>
      </header>
      <BadgeProperties file={currentFile} />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {mode === 'md' && <MdEditor file={currentFile} />}
        {mode === 'pdf' && <PdfViewer absPath={absPath} />}
        {mode === 'image' && <ImageViewer absPath={absPath} />}
        {mode === 'audio' && (
          <div style={{ padding: 16 }}>
            <audio controls src={`file://${absPath}`} style={{ width: '100%' }}>
              <track kind="captions" />
            </audio>
          </div>
        )}
        {mode === 'video' && (
          <div style={{ padding: 16 }}>
            <video controls src={`file://${absPath}`} style={{ width: '100%' }}>
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
  );
};

// Normalize MD for round-trip diff: collapse 3+ blank lines, strip
// trailing whitespace per line, normalize line endings. Anything beyond
// this means BlockNote actually lost or added meaningful content and we
// must not silently overwrite the user's file.
// BadgeProperties is the "背包" editor — the agent-protocol contract surface.
// Per IR-v2-04, every badge has a prompt + references + position; users need
// to edit prompt/references here (canvas only handles position via drag).
// Without this UI, badge.prompt was effectively write-only-by-CLI.
const BadgeProperties = ({ file }: { file: string }): JSX.Element | null => {
  const [badge, setBadge] = useState<BadgeFile | null>(null);
  const [prompt, setPrompt] = useState('');
  const [inboundCount, setInboundCount] = useState(0);
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
    setInboundCount(0);
    void (async () => {
      try {
        const b = (await window.bh.run('badge.get', {
          file,
          kind: 'file',
        })) as BadgeGetResult;
        if (cancelled) return;
        setBadge(b);
        setPrompt(b?.prompt ?? '');
        const inbound = (await window.bh.run('inbound.get', { file })) as InboundGetResult;
        if (cancelled) return;
        setInboundCount(inbound.entries.length);
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
          await window.bh.run('badge.set', {
            file,
            kind: 'file',
            patch: { prompt: next },
          });
        } catch {
          // Save errors propagate via Canvas's banner on next refresh.
        }
      }, 500),
    [file],
  );

  const removeRef = useCallback(
    async (to: string) => {
      await window.bh.run('badge.removeRef', { file, to });
      setBadge((b) => (b ? { ...b, references: b.references.filter((r) => r.to !== to) } : b));
    },
    [file],
  );

  const updateRefNote = useCallback(
    async (to: string, note: string) => {
      const trimmed = note.trim();
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
    },
    [file],
  );

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
              }}
            />
          </label>
          <div>
            <div
              style={{
                color: color.textSecondary,
                marginBottom: space[1.5],
                fontSize: font.size.caption,
                fontWeight: font.weight.medium,
              }}
            >
              References{' '}
              <span style={{ color: color.textTertiary, fontWeight: font.weight.regular }}>
                {refCount} out · {inboundCount} in
              </span>
            </div>
            {refCount === 0 ? (
              <div
                style={{
                  color: color.textTertiary,
                  fontSize: font.size.caption,
                  lineHeight: 1.5,
                }}
              >
                Drag from this badge's right edge to another badge to add a reference.
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
          </div>
        </div>
      )}
    </section>
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

function normalizeMd(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MdEditor = ({ file }: { file: string }): JSX.Element => {
  const editor = useCreateBlockNote();
  const setEditorDirty = useWorkspaceStore((s) => s.setEditorDirty);
  const [loadedFor, setLoadedFor] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  // G-08 safety: when BlockNote's parse→serialize loop loses meaningful
  // content, we flip to view-only so users can't accidentally overwrite
  // the original. Inferred at load time, not on every keystroke.
  const [viewOnly, setViewOnly] = useState(false);
  /** External-edit reload banner. Set when the watcher reports the open file
   * changed on disk and we already have unsaved edits — we don't auto-clobber. */
  const [reloadPrompt, setReloadPrompt] = useState(false);
  const initialLoad = useRef(true);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Mirror local dirty into the store so TopBar can prompt before workspace
  // switches drop unsaved edits. On unmount we clear it — a closed editor
  // can't have unsaved edits.
  useEffect(() => {
    setEditorDirty(dirty);
    return () => setEditorDirty(false);
  }, [dirty, setEditorDirty]);
  const [loadKey, setLoadKey] = useState(0);
  // Capture latest save reference for the global keyboard handler so it
  // doesn't need to re-register on every keystroke that flips `dirty`.
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (loadedFor === file && loadKey === 0) return;
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
        const lossy = normalizeMd(original) !== normalizeMd(reserialized);
        setViewOnly(lossy);
        setLoadedFor(file);
        setDirty(false);
        setReloadPrompt(false);
        setError('');
        setTimeout(() => {
          initialLoad.current = false;
        }, 50);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [file, editor, loadedFor, loadKey]);

  // Subscribe to file events for *this* file. Auto-reload when clean;
  // surface a "reload? keep edits?" prompt when dirty.
  // Defer the "File deleted on disk" warning by slightly more than the
  // watcher's rename window so a rename (unlink+add within 250ms) doesn't
  // flash the warning before the rename event arrives and rebinds
  // currentFile to the new path. If a rename matching this file's old
  // path arrives, cancel the pending warning.
  useEffect(() => {
    let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = window.bh.onFileEvent((event) => {
      if (event.type === 'rename') {
        // If this file was just renamed, the parent (App) will switch
        // currentFile to the new path. Cancel any pending "deleted"
        // warning from the preceding unlink.
        if (event.fromRelPath === file && pendingDeleteTimer) {
          clearTimeout(pendingDeleteTimer);
          pendingDeleteTimer = null;
        }
        return;
      }
      if (event.relPath !== file) return;
      if (event.type === 'change') {
        if (dirtyRef.current) {
          setReloadPrompt(true);
        } else {
          setLoadKey((k) => k + 1);
        }
      } else if (event.type === 'unlink') {
        // Wait one rename-window before declaring the file actually deleted.
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
    setDirty(false);
    setLoadKey((k) => k + 1);
  }, []);

  const dismissReload = useCallback(() => {
    setReloadPrompt(false);
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (saving || viewOnly) return;
    setSaving(true);
    try {
      const md = await editor.blocksToMarkdownLossy(editor.document);
      await window.bh.run('workspace.writeFile', { path: file, content: md });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editor, file, saving, viewOnly]);
  saveRef.current = save;

  // Cmd/Ctrl+S = save. We only register the listener once per file and
  // delegate through saveRef so the binding never thrashes on dirty flips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void saveRef.current();
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
    : dirty
      ? { label: 'Unsaved changes', dot: color.warning, fg: color.warning }
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
            boxShadow: dirty ? '0 0 0 3px rgba(168,107,0,0.12)' : 'none',
            transition: transition(['background', 'box-shadow']),
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
        {!viewOnly && (
          <Button
            variant={dirty ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || saving}
            title="Save (⌘S)"
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
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
          <span style={{ flex: 1 }}>File changed on disk while you have unsaved edits.</span>
          <Button variant="primary" size="sm" onClick={dismissReload}>
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
        <BlockNoteView
          editor={editor}
          editable={!viewOnly}
          onChange={() => {
            if (!initialLoad.current && !viewOnly) setDirty(true);
          }}
        />
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

const ImageViewer = ({ absPath }: { absPath: string }): JSX.Element => {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f4f4f4',
        padding: 16,
        gap: 8,
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
        <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: 11, color: '#888' }}>
          {dims.w} × {dims.h}
        </span>
      )}
    </div>
  );
};

import type { BadgeFile, BadgeGetResult, InboundGetResult } from '@basehalf/core';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { emitBadgeChange } from '../lib/badgeBus.js';
import { registerFlusher, unregisterFlusher } from '../lib/editorFlush.js';
import { badgeTabId } from '../lib/panelTab.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { prompt as promptDialog } from './Dialog.js';
import { Button } from './primitives/Button.js';

const basenameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

export const BadgePage = ({ file, paneId }: { file: string; paneId: string }): JSX.Element => {
  const [badge, setBadge] = useState<BadgeFile | null>(null);
  const [prompt, setPrompt] = useState('');
  const [inbound, setInbound] = useState<readonly { from: string; note?: string }[]>([]);
  const [focusActive, setFocusActive] = useState<readonly string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const openBadgeInPanel = useWorkspaceStore((s) => s.openBadgeInPanel);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPrompt = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const [b, ib, focus] = await Promise.all([
        window.bh.run('badge.get', { file, kind: 'file' }) as Promise<BadgeGetResult>,
        window.bh.run('inbound.get', { file }) as Promise<InboundGetResult>,
        window.bh.run('focus.get', {}) as Promise<{ active: string[] }>,
      ]);
      setBadge(b);
      setPrompt(b?.prompt ?? '');
      pendingPrompt.current = null;
      setInbound(ib.entries);
      setFocusActive(focus.active);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [file]);

  useEffect(() => {
    void load();
  }, [load]);

  const flushPrompt = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const next = pendingPrompt.current;
    if (next === null) return true;
    try {
      const saved = (await window.bh.run('badge.set', {
        file,
        kind: 'file',
        patch: { prompt: next },
      })) as BadgeFile;
      pendingPrompt.current = null;
      setBadge(saved);
      setSaveError(null);
      emitBadgeChange();
      return true;
    } catch (err) {
      setSaveError(`Couldn't save File Badge: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [file]);

  useEffect(() => {
    registerFlusher(paneId, flushPrompt);
    return () => {
      unregisterFlusher(paneId, flushPrompt);
      void flushPrompt();
    };
  }, [paneId, flushPrompt]);

  const schedulePromptSave = useCallback(
    (next: string) => {
      pendingPrompt.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void flushPrompt();
      }, 500);
    },
    [flushPrompt],
  );

  const removeRef = useCallback(
    async (to: string) => {
      if (!(await flushPrompt())) return;
      try {
        const saved = (await window.bh.run('badge.removeRef', { file, to })) as BadgeFile;
        setBadge(saved);
        setSaveError(null);
        emitBadgeChange();
      } catch (err) {
        setSaveError(
          `Couldn't remove reference: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [file, flushPrompt],
  );

  const updateRefNote = useCallback(
    async (to: string, note: string) => {
      if (!(await flushPrompt())) return;
      const trimmed = note.trim();
      try {
        const saved = (await window.bh.run('badge.addRef', {
          file,
          to,
          ...(trimmed !== '' && { note: trimmed }),
        })) as BadgeFile;
        setBadge(saved);
        setSaveError(null);
        emitBadgeChange();
      } catch (err) {
        setSaveError(
          `Couldn't save reference note: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [file, flushPrompt],
  );

  const addRefViaPrompt = useCallback(async () => {
    if (!(await flushPrompt())) return;
    const to = await promptDialog({
      title: 'Add reference',
      body: 'Workspace-relative path to the file or folder this File Badge depends on.',
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
      const saved = (await window.bh.run('badge.addRef', { file, to: trimmed })) as BadgeFile;
      setBadge(saved);
      setSaveError(null);
      emitBadgeChange();
    } catch (err) {
      setSaveError(`Couldn't add reference: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [file, badge, flushPrompt]);

  const toggleFocus = useCallback(async () => {
    if (!(await flushPrompt())) return;
    try {
      const after = (await window.bh.run('focus.toggleActiveFile', { file })) as {
        active: string[];
      };
      setFocusActive(after.active);
      emitBadgeChange();
    } catch (err) {
      setSaveError(
        `Couldn't update Agent Context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [file, flushPrompt]);

  const isFocused = focusActive.includes(file);
  const refs = badge?.references ?? [];
  const modified = badge?.modifiedAt ? new Date(badge.modifiedAt).toLocaleString() : null;

  const statText = useMemo(
    () => `${refs.length} out · ${inbound.length} in${isFocused ? ' · in Agent Context' : ''}`,
    [refs.length, inbound.length, isFocused],
  );

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
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
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
            <h2
              title={file}
              style={{
                margin: `${space[1]}px 0 0`,
                fontSize: font.size.display,
                lineHeight: 1.25,
                color: color.textPrimary,
                fontWeight: font.weight.semibold,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {basenameOf(file)}
            </h2>
          </div>
          <Button
            variant={isFocused ? 'default' : 'ghost'}
            size="sm"
            onClick={() => void toggleFocus()}
          >
            {isFocused ? 'In Context' : 'Add to Context'}
          </Button>
        </div>
        <div
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
          {file}
        </div>
        <div
          style={{
            marginTop: space[1],
            color: color.textTertiary,
            fontSize: font.size.caption,
          }}
        >
          {loading ? 'Loading…' : statText}
          {modified && <span> · modified {modified}</span>}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <section style={sectionStyle}>
          <label style={{ display: 'block' }}>
            <SectionTitle title="What agents should know" />
            <textarea
              data-testid="file-badge-prompt"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                schedulePromptSave(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  void (async () => {
                    if (await flushPrompt()) closeTab(paneId, badgeTabId(file));
                  })();
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = color.borderStrong;
                e.currentTarget.style.boxShadow = 'none';
                void flushPrompt();
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
          {saveError && <ErrorNote message={saveError} />}
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
            <SectionTitle title="References" detail={`${refs.length} outbound`} />
            <div style={{ marginLeft: 'auto' }}>
              <Button variant="ghost" size="sm" onClick={() => void addRefViaPrompt()}>
                + Add
              </Button>
            </div>
          </div>
          {refs.length === 0 ? (
            <EmptyLine>No outbound references.</EmptyLine>
          ) : (
            <ul style={listStyle}>
              {refs.map((ref) => (
                <ReferenceRow
                  key={ref.to}
                  to={ref.to}
                  note={ref.note ?? ''}
                  onOpen={() => openInPanel(ref.to)}
                  onOpenBadge={() => openBadgeInPanel(ref.to)}
                  onRemove={() => void removeRef(ref.to)}
                  onNoteCommit={(note) => void updateRefNote(ref.to, note)}
                />
              ))}
            </ul>
          )}
        </section>

        <section style={sectionStyle}>
          <SectionTitle title="Inbound" detail={`${inbound.length} incoming`} />
          {inbound.length === 0 ? (
            <EmptyLine>No inbound references.</EmptyLine>
          ) : (
            <ul style={listStyle}>
              {inbound.map((entry) => (
                <InboundRow
                  key={entry.from}
                  entry={entry}
                  onOpen={() => openInPanel(entry.from)}
                  onOpenBadge={() => openBadgeInPanel(entry.from)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

const sectionStyle = {
  padding: `${space[4]}px ${space[5]}px`,
  borderBottom: `1px solid ${color.border}`,
} as const;

const listStyle = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: space[1],
} as const;

const SectionTitle = ({ title, detail }: { title: string; detail?: string }): JSX.Element => (
  <div
    style={{
      marginBottom: space[2],
      display: 'flex',
      alignItems: 'baseline',
      gap: space[1.5],
    }}
  >
    <div
      style={{
        color: color.textSecondary,
        fontSize: font.size.caption,
        fontWeight: font.weight.semibold,
      }}
    >
      {title}
    </div>
    {detail && (
      <div style={{ color: color.textTertiary, fontSize: font.size.caption }}>{detail}</div>
    )}
  </div>
);

const EmptyLine = ({ children }: { children: string }): JSX.Element => (
  <div style={{ color: color.textTertiary, fontSize: font.size.caption, lineHeight: 1.5 }}>
    {children}
  </div>
);

const ErrorNote = ({ message }: { message: string }): JSX.Element => (
  <div
    role="alert"
    style={{
      marginTop: space[2],
      padding: `${space[1.5]}px ${space[3]}px`,
      fontSize: font.size.caption,
      color: color.danger,
      background: `${color.danger}14`,
      border: `1px solid ${color.danger}33`,
      borderRadius: radius.md,
    }}
  >
    {message}
  </div>
);

const ReferenceRow = ({
  to,
  note,
  onOpen,
  onOpenBadge,
  onRemove,
  onNoteCommit,
}: {
  to: string;
  note: string;
  onOpen: () => void;
  onOpenBadge: () => void;
  onRemove: () => void;
  onNoteCommit: (note: string) => void;
}): JSX.Element => {
  const [local, setLocal] = useState(note);
  const [hovered, setHovered] = useState(false);
  useEffect(() => setLocal(note), [note]);
  return (
    <li
      data-testid="file-badge-reference-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={rowStyle}
    >
      <span aria-hidden style={arrowStyle}>
        →
      </span>
      <button type="button" onClick={onOpen} title={`Open ${to}`} style={pathButtonStyle}>
        {to}
      </button>
      <input
        data-testid="file-badge-reference-note"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={() => {
          if (local !== note) onNoteCommit(local);
        }}
        placeholder="note"
        style={noteInputStyle}
      />
      <Button variant="ghost" size="sm" onClick={onOpenBadge}>
        Badge
      </Button>
      <button type="button" onClick={onRemove} title="Remove reference" style={xButton(hovered)}>
        ×
      </button>
    </li>
  );
};

const InboundRow = ({
  entry,
  onOpen,
  onOpenBadge,
}: {
  entry: { from: string; note?: string };
  onOpen: () => void;
  onOpenBadge: () => void;
}): JSX.Element => (
  <li data-testid="file-badge-inbound-row" style={rowStyle}>
    <span aria-hidden style={arrowStyle}>
      ←
    </span>
    <button type="button" onClick={onOpen} title={`Open ${entry.from}`} style={pathButtonStyle}>
      {entry.from}
    </button>
    {entry.note && (
      <span
        style={{
          color: color.textTertiary,
          fontSize: font.size.caption,
          fontStyle: 'italic',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
      >
        {entry.note}
      </span>
    )}
    <Button variant="ghost" size="sm" onClick={onOpenBadge}>
      Badge
    </Button>
  </li>
);

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: space[1.5],
  padding: `${space[1.5]}px ${space[2]}px`,
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
} as const;

const arrowStyle = {
  color: color.textTertiary,
  fontSize: font.size.caption,
  flexShrink: 0,
} as const;

const pathButtonStyle = {
  flex: '0 1 180px',
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
  letterSpacing: 0,
} as const;

const noteInputStyle = {
  flex: 1,
  minWidth: 64,
  padding: `${space[0.5]}px ${space[1.5]}px`,
  fontSize: font.size.caption,
  fontFamily: font.sans,
  color: color.textPrimary,
  border: '1px solid transparent',
  borderRadius: radius.sm,
  background: 'transparent',
  outline: 'none',
} as const;

const xButton = (hovered: boolean) =>
  ({
    flexShrink: 0,
    background: 'transparent',
    border: 'none',
    color: hovered ? color.danger : color.textGhost,
    cursor: 'pointer',
    fontSize: 16,
    padding: `0 ${space[1]}px`,
    lineHeight: 1,
    transition: transition(['color']),
  }) as const;

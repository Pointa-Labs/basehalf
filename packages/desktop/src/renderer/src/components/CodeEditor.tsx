import type { WorkspaceReadFileResult } from '@basehalf/core';
import * as monaco from 'monaco-editor';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, radius, shadow, space } from '../design.js';
import { type FlushOptions, registerFlusher, unregisterFlusher } from '../lib/editorFlush.js';
import { makeFileFocusPusher } from '../lib/focusPush.js';
import '../lib/monacoSetup.js';
import { Button } from './primitives/Button.js';

/**
 * The editable code / plain-text editor — Monaco (VS Code's editor core).
 *
 * Routed here by viewerMode's `code` mode: every file that isn't Markdown, a
 * dedicated-viewer media type, or a known binary (so code, config, unknown
 * extensions, extension-less names, and plain `.txt`). The disk file stays the
 * truth — Monaco holds the live buffer, ⌘S writes it back whole (no splice
 * needed: unlike the BlockNote Markdown editor, Monaco round-trips bytes
 * losslessly). Save is MANUAL like VS Code: edits set an unsaved dot, ⌘S
 * persists, and navigating away from unsaved edits prompts Save / Don't save /
 * Cancel through the shared editor-flush gate.
 *
 * Reuses the same infrastructure as the Markdown editor: registerFlusher (so a
 * file switch / close / workspace switch routes through the unsaved prompt) and
 * makeFileFocusPusher (cursor line+col and the first visible line mirror into
 * focus.yaml, so an agent reading current_focus.yaml knows which lines of code
 * the user is looking at). A binary mis-routed here (the read flags it) shows an
 * open-in-app fallback instead of mojibake.
 */

// One dark theme whose background matches the app surface, so Monaco blends into
// the Dark-Modern-modelled chrome instead of sitting on its own shade. Defined
// once, lazily, on the first editor mount.
let themeDefined = false;
function ensureTheme(): void {
  if (themeDefined) return;
  monaco.editor.defineTheme('bh-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': color.surface,
      'editorGutter.background': color.surface,
      'editorLineNumber.foreground': color.textGhost,
      'editor.lineHighlightBorder': '#00000000',
    },
  });
  themeDefined = true;
}

/** Monaco language id for a path, looked up from Monaco's own extension /
 *  filename registry (so `Dockerfile`, `.ts`, `.tf`… all resolve the way VS Code
 *  resolves them). Unknown → 'plaintext', still fully editable. */
function languageOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = (slash === -1 ? path : path.slice(slash + 1)).toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.filenames?.some((f) => f.toLowerCase() === name)) return lang.id;
    if (ext && lang.extensions?.some((e) => e.toLowerCase() === ext)) return lang.id;
  }
  return 'plaintext';
}

/** Which blocking dialog is up (mutually exclusive): the navigate-away unsaved
 *  prompt, or the disk-changed-under-us conflict banner. */
type Prompt = 'unsaved' | 'conflict';

export const CodeEditor = ({ file, paneId }: { file: string; paneId: string }): JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // The exact bytes we last read from / wrote to disk. dirty = buffer ≠ this.
  const lastSavedRef = useRef<string>('');
  const dirtyRef = useRef(false); // synchronous mirror the flusher reads
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [binary, setBinary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // Resolver for the flush() promise the store awaits before switching/closing —
  // parked while the unsaved prompt is up, settled when the user picks.
  const flushResolveRef = useRef<((proceed: boolean) => void) | null>(null);

  const pushFocus = useMemo(() => makeFileFocusPusher(file), [file]);
  useEffect(() => () => pushFocus.cancel(), [pushFocus]);

  // Mirror cursor (line+col, exact — Monaco lines ARE source lines) and the first
  // visible line into focus.yaml. Computed at flush time off the live editor.
  const pushViewport = useCallback(() => {
    pushFocus(() => {
      const ed = editorRef.current;
      if (!ed) return null;
      const pos = ed.getPosition();
      const firstVisible = ed.getVisibleRanges()[0]?.startLineNumber ?? 1;
      return {
        visible_lines: { start: firstVisible },
        ...(pos
          ? { cursor: { line: pos.lineNumber, column: pos.column, line_precision: 'exact' } }
          : {}),
      };
    });
  }, [pushFocus]);

  // Write the buffer to disk. Conflict-guarded: if disk drifted from our baseline
  // since we loaded (an external edit), raise the conflict banner instead of
  // clobbering — unless `force` (the user chose "Keep mine"). Resolves true when
  // the file is persisted (or already clean), false when blocked.
  const doSave = useCallback(
    async (opts?: { force?: boolean }): Promise<boolean> => {
      const ed = editorRef.current;
      if (!ed) return true;
      const value = ed.getValue();
      if (value === lastSavedRef.current) {
        dirtyRef.current = false;
        setDirty(false);
        return true;
      }
      if (!opts?.force) {
        try {
          const disk = (await window.bh.run('workspace.readFile', {
            path: file,
          })) as WorkspaceReadFileResult;
          if ((disk.content ?? '') !== lastSavedRef.current) {
            setPrompt('conflict');
            return false;
          }
        } catch {
          // Re-read failed (vanished/permission) — let the write below surface it.
        }
      }
      try {
        await window.bh.run('workspace.writeFile', { path: file, content: value });
        lastSavedRef.current = value;
        dirtyRef.current = false;
        setDirty(false);
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [file],
  );

  // Replace the buffer with the current disk contents (the conflict "Reload").
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    try {
      const disk = (await window.bh.run('workspace.readFile', {
        path: file,
      })) as WorkspaceReadFileResult;
      const text = disk.content ?? '';
      editorRef.current?.setValue(text);
      lastSavedRef.current = text;
      dirtyRef.current = false;
      setDirty(false);
      setError(null);
      setPrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);

  // The flush gate the store calls before switching file / closing / switching
  // workspace. No unsaved edits → proceed. Otherwise park and raise the unsaved
  // prompt; the buttons settle this promise.
  const flush = useCallback((_options?: FlushOptions): Promise<boolean> => {
    if (!dirtyRef.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      flushResolveRef.current = resolve;
      setPrompt('unsaved');
    });
  }, []);

  useEffect(() => {
    registerFlusher(paneId, flush);
    return () => {
      unregisterFlusher(paneId, flush);
      // If we unmount while a flush() is still parked behind the unsaved prompt
      // (e.g. the open file was deleted out from under it), settle it so the
      // navigation/quit awaiting it never wedges. The editor is gone — proceed.
      flushResolveRef.current?.(true);
      flushResolveRef.current = null;
    };
  }, [paneId, flush]);

  // Create the Monaco editor once for this file (FilePreview keys CodeEditor by
  // workspace-root + path, so a different file is a fresh mount).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let res: WorkspaceReadFileResult;
      try {
        res = (await window.bh.run('workspace.readFile', {
          path: file,
        })) as WorkspaceReadFileResult;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      if (res.binary === true) {
        setBinary(true);
        setLoading(false);
        return;
      }
      const host = hostRef.current;
      if (!host) {
        // The host div is rendered unconditionally (when not binary), so this is
        // effectively unreachable — but never strand `loading` at true (an
        // invisible blank pane) if the ref somehow isn't attached yet.
        setLoading(false);
        return;
      }
      const text = res.content ?? '';
      lastSavedRef.current = text;
      ensureTheme();
      const editor = monaco.editor.create(host, {
        value: text,
        language: languageOf(file),
        theme: 'bh-dark',
        automaticLayout: true,
        readOnly: false,
        fontFamily: font.mono,
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
        renderWhitespace: 'selection',
        padding: { top: space[3], bottom: space[6] },
      });
      editorRef.current = editor;
      setLoading(false);
      editor.onDidChangeModelContent(() => {
        const d = editor.getValue() !== lastSavedRef.current;
        dirtyRef.current = d;
        setDirty(d);
        pushViewport();
      });
      editor.onDidChangeCursorPosition(() => pushViewport());
      editor.onDidScrollChange(() => pushViewport());
      // ⌘S / Ctrl+S saves (Monaco's own keybinding, active while the editor has
      // focus — which it does whenever you're typing).
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void doSave();
      });
      pushViewport();
    })();
    return () => {
      cancelled = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // Run once per mount: `file` is fixed for this mount (keyed remount), and the
    // callbacks read refs so the captured versions stay correct.
  }, [file, doSave, pushViewport]);

  // ── unsaved-prompt button actions ──────────────────────────────────────────
  // Settle the parked flush() promise the store is awaiting (null when ⌘S, not a
  // navigation, raised the prompt). Stable so the handlers below stay stable.
  const settleFlush = useCallback((proceed: boolean): void => {
    const resolve = flushResolveRef.current;
    flushResolveRef.current = null;
    resolve?.(proceed);
  }, []);
  const onPromptSave = useCallback(async (): Promise<void> => {
    const ok = await doSave();
    if (ok) setPrompt(null); // else doSave raised the conflict banner / error
    settleFlush(ok);
  }, [doSave, settleFlush]);
  const onPromptDiscard = useCallback((): void => {
    setPrompt(null);
    settleFlush(true);
  }, [settleFlush]);
  const onPromptCancel = useCallback((): void => {
    setPrompt(null);
    settleFlush(false);
  }, [settleFlush]);

  if (binary) return <BinaryFallback file={file} />;

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar dirty={dirty} language={languageOf(file)} />
      {error !== null && (
        <div
          style={{
            padding: `${space[2]}px ${space[4]}px`,
            background: color.surfaceMuted,
            borderBottom: `1px solid ${color.divider}`,
            color: color.danger,
            fontFamily: font.sans,
            fontSize: font.size.caption,
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}
      {prompt === 'conflict' && (
        <Banner>
          <span style={{ flex: 1 }}>This file changed on disk since you opened it.</span>
          <Button variant="primary" size="sm" onClick={() => void doSave({ force: true })}>
            Keep mine
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void reloadFromDisk()}>
            Reload
          </Button>
        </Banner>
      )}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, opacity: loading ? 0 : 1 }} />
      {prompt === 'unsaved' && (
        <UnsavedPrompt
          file={file}
          onSave={() => void onPromptSave()}
          onDiscard={onPromptDiscard}
          onCancel={onPromptCancel}
        />
      )}
    </div>
  );
};

/** Slim top bar: the unsaved dot + a ⌘S hint, plus the language on the right
 *  (the status-bar cue VS Code shows). Always rendered so toggling dirty doesn't
 *  shift the editor. */
const StatusBar = ({ dirty, language }: { dirty: boolean; language: string }): JSX.Element => (
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
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: dirty ? color.accent : color.textGhost,
        transition: 'background 120ms ease',
      }}
    />
    {dirty ? 'Unsaved · ⌘S to save' : 'Saved'}
    <span style={{ marginLeft: 'auto', fontFamily: font.mono, color: color.textGhost }}>
      {language}
    </span>
  </div>
);

const Banner = ({ children }: { children: ReactNode }): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      padding: `${space[2]}px ${space[4]}px`,
      background: color.surfaceMuted,
      borderBottom: `1px solid ${color.border}`,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      color: color.textSecondary,
      flexShrink: 0,
    }}
  >
    {children}
  </div>
);

/** The navigate-away dialog (Save / Don't save / Cancel), centered over the
 *  editor. Mirrors VS Code's unsaved-changes prompt; shown only when the user
 *  leaves a file with unsaved edits. */
const UnsavedPrompt = ({
  file,
  onSave,
  onDiscard,
  onCancel,
}: {
  file: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}): JSX.Element => {
  const name = file.slice(file.lastIndexOf('/') + 1);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: color.backdrop,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: 360,
          maxWidth: '90%',
          background: color.surface,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          boxShadow: shadow.raised,
          padding: space[5],
          display: 'flex',
          flexDirection: 'column',
          gap: space[4],
          fontFamily: font.sans,
        }}
      >
        <div style={{ fontSize: font.size.body, color: color.textPrimary }}>
          Save changes to <strong>{name}</strong>?
        </div>
        <div style={{ fontSize: font.size.caption, color: color.textTertiary }}>
          Your changes will be lost if you don’t save them.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space[2] }}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Don’t save
          </Button>
          <Button variant="primary" size="sm" onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};

/** A binary file optimistically routed to `code` mode (the path-only router
 *  can't know) turns out non-text once read — offer the open-in-app escape
 *  instead of garbling it, same as the unsupported-file viewer. */
const BinaryFallback = ({ file }: { file: string }): JSX.Element => {
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
        flex: 1,
        padding: space[4],
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: color.textTertiary,
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
      {error !== null && <span style={{ color: color.danger }}>{error}</span>}
    </div>
  );
};

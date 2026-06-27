import type { GitBlameResult, GitShowResult, WorkspaceReadFileResult } from '@basehalf/core';
import * as monaco from 'monaco-editor';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, radius, shadow, space } from '../design.js';
import { type FlushOptions, registerFlusher, unregisterFlusher } from '../lib/editorFlush.js';
import { makeFileFocusPusher } from '../lib/focusPush.js';
import { computeLineChanges } from '../lib/lineDiff.js';
import {
  type ConflictBlock,
  type ConflictChoice,
  findConflicts,
  resolveConflict,
} from '../lib/mergeConflict.js';
import {
  ensureBhTheme,
  ensureBlameStyles,
  ensureGitGutterStyles,
  languageOf,
} from '../lib/monacoSetup.js';
import { relativeTime } from '../lib/relativeTime.js';
import { useGitStatusStore } from '../store/gitStatus.js';
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

/** Which blocking dialog is up (mutually exclusive): the navigate-away unsaved
 *  prompt, or the disk-changed-under-us conflict banner. */
type Prompt = 'unsaved' | 'conflict';

/** Above this combined (baseline + buffer) size, skip the O(n·m) gutter line-diff
 *  — a huge generated/minified/log file would otherwise freeze the renderer. The
 *  change-bars are a nicety, not load-bearing, so dropping them is the right call. */
const GUTTER_DIFF_MAX_CHARS = 1_000_000;

export const CodeEditor = ({ file, paneId }: { file: string; paneId: string }): JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // The git HEAD baseline of this file, for the gutter change-bars (buffer vs this).
  const baselineRef = useRef('');
  // The exact bytes we last read from / wrote to disk. dirty = buffer ≠ this.
  const lastSavedRef = useRef<string>('');
  const dirtyRef = useRef(false); // synchronous mirror the flusher reads
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [binary, setBinary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // Inline git-blame on the current line (VS Code core's "Git Blame"). Off by
  // default; `editorReady` gates the blame effect on the async editor creation.
  const [blameOn, setBlameOn] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
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
    let gutterTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubGit: () => void = () => undefined;
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
      ensureBhTheme();
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
      setEditorReady(true);

      // ── git gutter change-bars (the buffer vs the HEAD baseline) ───────────
      ensureGitGutterStyles();
      let gutterIds: string[] = [];
      const recomputeGutter = (): void => {
        const ed = editorRef.current;
        if (!ed) return;
        const value = ed.getValue();
        if (baselineRef.current.length + value.length > GUTTER_DIFF_MAX_CHARS) {
          gutterIds = ed.deltaDecorations(gutterIds, []); // too big to diff — drop the bars
          return;
        }
        gutterIds = ed.deltaDecorations(
          gutterIds,
          computeLineChanges(baselineRef.current, value).map((c) => ({
            range: new monaco.Range(c.startLine, 1, c.endLine, 1),
            options: { linesDecorationsClassName: `bh-git-gutter-${c.kind}` },
          })),
        );
      };
      const fetchBaseline = async (): Promise<void> => {
        try {
          const r = (await window.bh.run('git.show', { ref: 'HEAD', path: file })) as GitShowResult;
          baselineRef.current = r.content ?? '';
        } catch {
          baselineRef.current = ''; // not a repo / no HEAD → nothing to diff against
        }
        recomputeGutter();
      };
      void fetchBaseline();
      // A commit / checkout moves HEAD → re-read the baseline + redraw. Re-fetch
      // ONLY when the branch changed (checkout) or THIS file's status changed by
      // value (commit/stage) — not on every working-tree event, else each save
      // would re-spawn `git show` for every open editor (a subprocess storm).
      const fileSig = (): string => {
        const f = useGitStatusStore.getState().byPath.get(file);
        return f ? `${f.x}${f.y}` : '';
      };
      let lastBranch = useGitStatusStore.getState().status?.branch;
      let lastSig = fileSig();
      unsubGit = useGitStatusStore.subscribe(() => {
        const branch = useGitStatusStore.getState().status?.branch;
        const sig = fileSig();
        if (branch === lastBranch && sig === lastSig) return;
        lastBranch = branch;
        lastSig = sig;
        void fetchBaseline();
      });

      // ── inline merge-conflict resolution ───────────────────────────────────
      const conflictWidgets: monaco.editor.IContentWidget[] = [];
      let conflictDecoIds: string[] = [];
      const clearConflicts = (): void => {
        for (const w of conflictWidgets) editor.removeContentWidget(w);
        conflictWidgets.length = 0;
        conflictDecoIds = editor.deltaDecorations(conflictDecoIds, []);
      };
      // Forward-declared so resolveBlock (below) can redraw synchronously after an
      // edit, while refreshConflicts's button handlers call back into resolveBlock
      // — a deliberate cycle, broken with this placeholder.
      let refreshConflicts = (): void => undefined;
      const resolveBlock = (block: ConflictBlock, choice: ConflictChoice): void => {
        const model = editor.getModel();
        if (!model) return;
        // Stale-click guard (VS Code's per-conflict `applied` gate, adapted): only
        // act if the block's `<<<<<<<` marker is STILL exactly where it was when
        // this widget was built. If a prior resolve shifted the buffer, the line no
        // longer holds the marker → bail rather than edit the wrong region. With the
        // synchronous refresh below this is belt-and-suspenders, but it severs the
        // root cause (a captured line number) for good.
        if (block.startLine > model.getLineCount()) return;
        if (!model.getLineContent(block.startLine).startsWith('<<<<<<<')) return;
        // Replace the whole block (markers included) with the chosen side.
        editor.executeEdits('bh-conflict', [
          {
            range: new monaco.Range(
              block.startLine,
              1,
              block.endLine,
              model.getLineMaxColumn(block.endLine),
            ),
            text: resolveConflict(editor.getValue(), block, choice),
          },
        ]);
        editor.pushUndoStop();
        // Rebuild widgets/decorations from the NEW buffer NOW — not on the 250ms
        // debounce — so a quick second click can't resolve another block using its
        // now-shifted, stale line numbers (which would corrupt the file).
        refreshConflicts();
      };
      refreshConflicts = (): void => {
        clearConflicts();
        const decos: monaco.editor.IModelDeltaDecoration[] = [];
        for (const block of findConflicts(editor.getValue())) {
          const dom = document.createElement('div');
          dom.className = 'bh-conflict-actions';
          for (const [label, choice] of [
            ['Accept Current', 'current'],
            ['Accept Incoming', 'incoming'],
            ['Accept Both', 'both'],
          ] as const) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.onclick = () => resolveBlock(block, choice);
            dom.appendChild(btn);
          }
          const widget: monaco.editor.IContentWidget = {
            getId: () => `bh-conflict-${block.startLine}`,
            getDomNode: () => dom,
            getPosition: () => ({
              position: { lineNumber: block.startLine, column: 1 },
              preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
            }),
          };
          editor.addContentWidget(widget);
          conflictWidgets.push(widget);
          const marker = (line: number): monaco.editor.IModelDeltaDecoration => ({
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: 'bh-conflict-marker' },
          });
          decos.push(marker(block.startLine), marker(block.sepLine), marker(block.endLine));
          if (block.sepLine - 1 >= block.startLine + 1) {
            decos.push({
              range: new monaco.Range(block.startLine + 1, 1, block.sepLine - 1, 1),
              options: { isWholeLine: true, className: 'bh-conflict-current' },
            });
          }
          if (block.endLine - 1 >= block.sepLine + 1) {
            decos.push({
              range: new monaco.Range(block.sepLine + 1, 1, block.endLine - 1, 1),
              options: { isWholeLine: true, className: 'bh-conflict-incoming' },
            });
          }
        }
        conflictDecoIds = editor.deltaDecorations(conflictDecoIds, decos);
      };
      refreshConflicts();

      editor.onDidChangeModelContent(() => {
        const d = editor.getValue() !== lastSavedRef.current;
        dirtyRef.current = d;
        setDirty(d);
        pushViewport();
        if (gutterTimer) clearTimeout(gutterTimer);
        gutterTimer = setTimeout(() => {
          recomputeGutter();
          refreshConflicts();
        }, 250);
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
      if (gutterTimer) clearTimeout(gutterTimer);
      unsubGit();
      editorRef.current?.dispose();
      editorRef.current = null;
      setEditorReady(false);
    };
    // Run once per mount: `file` is fixed for this mount (keyed remount), and the
    // callbacks read refs so the captured versions stay correct.
  }, [file, doSave, pushViewport]);

  // ── inline git-blame on the current line ───────────────────────────────────
  // When on, fetch this file's blame once and append a dimmed "author, when ·
  // summary" note to whichever line the cursor is on (re-drawn on cursor move).
  // Re-runs on save (status sig change) so working-tree edits re-blame.
  const fileSig = useGitStatusStore((s) => {
    const f = s.byPath.get(file);
    return f ? `${f.x}${f.y}` : '';
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: fileSig re-triggers a re-blame after this file's status changes (save/stage); it's a trigger, not read in the body.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !blameOn || !editorReady) return;
    ensureBlameStyles();
    let disposed = false;
    let decoIds: string[] = [];
    let lines: GitBlameResult['lines'] = [];
    const clear = (): void => {
      decoIds = ed.deltaDecorations(decoIds, []);
    };
    const draw = (): void => {
      const model = ed.getModel();
      const pos = ed.getPosition();
      if (!model || !pos) {
        clear();
        return;
      }
      const bl = lines[pos.lineNumber - 1];
      if (!bl) {
        clear();
        return;
      }
      const note = bl.sha.startsWith('00000000')
        ? 'You · Uncommitted'
        : `${bl.author}, ${relativeTime(bl.authorTime, Date.now())} · ${bl.summary}`;
      const col = model.getLineMaxColumn(pos.lineNumber);
      decoIds = ed.deltaDecorations(decoIds, [
        {
          range: new monaco.Range(pos.lineNumber, col, pos.lineNumber, col),
          options: {
            after: { content: `    ${note}`, inlineClassName: 'bh-blame-inline' },
            showIfCollapsed: true,
          },
        },
      ]);
    };
    const sub = ed.onDidChangeCursorPosition(() => draw());
    void (async () => {
      try {
        const r = (await window.bh.run('git.blame', { path: file })) as GitBlameResult;
        if (disposed) return;
        lines = r.lines;
        draw();
      } catch {
        /* not a repo / untracked → no blame */
      }
    })();
    return () => {
      disposed = true;
      sub.dispose();
      clear();
    };
  }, [blameOn, file, editorReady, fileSig]);

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
      <StatusBar
        dirty={dirty}
        language={languageOf(file)}
        blameOn={blameOn}
        onToggleBlame={() => setBlameOn((v) => !v)}
      />
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
const StatusBar = ({
  dirty,
  language,
  blameOn,
  onToggleBlame,
}: {
  dirty: boolean;
  language: string;
  blameOn: boolean;
  onToggleBlame: () => void;
}): JSX.Element => (
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
    <button
      type="button"
      title={
        blameOn ? 'Turn off inline blame' : 'Show inline blame (last change on the current line)'
      }
      aria-pressed={blameOn}
      onClick={onToggleBlame}
      style={{
        marginLeft: 'auto',
        padding: `0 ${space[2]}px`,
        height: 18,
        border: `1px solid ${blameOn ? color.accent : color.border}`,
        borderRadius: radius.sm,
        background: blameOn ? `${color.accent}1f` : 'transparent',
        color: blameOn ? color.accent : color.textTertiary,
        fontFamily: font.sans,
        fontSize: font.size.micro,
        cursor: 'pointer',
      }}
    >
      Blame
    </button>
    <span style={{ fontFamily: font.mono, color: color.textGhost }}>{language}</span>
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

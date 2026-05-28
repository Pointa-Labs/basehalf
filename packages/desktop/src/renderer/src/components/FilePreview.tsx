import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import type { WorkspaceReadFileResult } from '@basehalf/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../store/workspace.js';

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

  // Esc closes the preview. Effect must run unconditionally — the early
  // return below short-circuits, but React requires hook order to be stable
  // across renders, so we register before the null check.
  useEffect(() => {
    if (!currentFile) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Don't fight BlockNote's own escape handling (e.g. exit a slash menu).
        const tag = (e.target as HTMLElement | null)?.tagName ?? '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
        borderLeft: '1px solid #e0e0e0',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #eee',
          background: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
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
              color: '#222',
              fontSize: 13,
            }}
          >
            {basename}
          </strong>
          {dirname && (
            <span
              style={{
                fontSize: 10,
                color: '#999',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {dirname}/
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCurrentFile(null)}
          title="Close (Esc)"
          style={{
            background: 'transparent',
            border: '1px solid #ccc',
            padding: '2px 8px',
            fontSize: 12,
            cursor: 'pointer',
            borderRadius: 3,
            color: '#555',
          }}
        >
          Close
        </button>
      </header>
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
              padding: 16,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 13,
              color: '#666',
            }}
          >
            <p>No built-in viewer for this file type.</p>
            <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{absPath}</p>
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
  useEffect(() => {
    const unsub = window.bh.onFileEvent((event) => {
      if (event.relPath !== file) return;
      if (event.type === 'change') {
        if (dirtyRef.current) {
          setReloadPrompt(true);
        } else {
          setLoadKey((k) => k + 1);
        }
      } else if (event.type === 'unlink') {
        setError('File deleted on disk.');
      }
    });
    return unsub;
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

  const status: { label: string; bg: string; fg: string } = viewOnly
    ? {
        label: 'View only — this file uses Markdown features the editor can’t round-trip safely',
        bg: '#fff0f0',
        fg: '#a00',
      }
    : dirty
      ? { label: 'Unsaved changes', bg: '#fff8dc', fg: '#665500' }
      : { label: 'Saved', bg: '#f4faf4', fg: '#3a6a3a' };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '4px 12px',
          background: status.bg,
          borderBottom: '1px solid #eee',
          fontSize: 12,
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ flex: 1, color: status.fg }}>{status.label}</span>
        {!viewOnly && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            title="Save (⌘S)"
            style={{ padding: '2px 10px', fontSize: 12 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {reloadPrompt && (
        <div
          style={{
            padding: '6px 12px',
            background: '#fff8dc',
            borderBottom: '1px solid #e8d77a',
            color: '#665500',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>File changed on disk while you have unsaved edits.</span>
          <button type="button" onClick={acceptReload} style={{ padding: '2px 8px', fontSize: 12 }}>
            Reload from disk
          </button>
          <button
            type="button"
            onClick={dismissReload}
            style={{ padding: '2px 8px', fontSize: 12 }}
          >
            Keep my edits
          </button>
        </div>
      )}
      {error && (
        <div
          style={{
            padding: '4px 12px',
            background: '#fff0f0',
            color: '#a00',
            fontSize: 12,
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

const ImageViewer = ({ absPath }: { absPath: string }): JSX.Element => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f4f4f4',
      padding: 16,
    }}
  >
    <img
      src={`file://${absPath}`}
      alt={absPath}
      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
    />
  </div>
);

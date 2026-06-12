import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import type { WorkspaceReadFileResult } from '@basehalf/core';
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
import { bhSchema } from '../lib/blocknoteSchema.js';
import {
  type FlushOptions,
  registerDocFlusher,
  registerFlusher,
  unregisterDocFlusher,
  unregisterFlusher,
} from '../lib/editorFlush.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import {
  type LiveDocView,
  acquireDoc,
  claimSeed,
  docKeyFor,
  ensureDoc,
  markReady,
  onReady,
  refreshOwner,
  releaseDoc,
} from '../lib/liveDoc.js';
import { type MdEditorApi, buildLoadProjection, spliceSave } from '../lib/mdSegment.js';
import { scrollToFirstMatch } from '../lib/scrollToMatch.js';
import { modeOf } from '../lib/viewerMode.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { Button } from './primitives/Button.js';
import { useFileBadge } from './useFileBadge.js';

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
 *  pane is the active one (only it consumes the search jump-to-match). */
export const FilePreview = ({
  file,
  paneId,
  isActive,
}: { file: string; paneId: string; isActive: boolean }): JSX.Element => {
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
  // Key the text/MD views by the workspace ROOT PATH + relative path: a workspace
  // switch (or a repath to a new folder) whose layout has the same relative file in
  // the same pane would otherwise keep the component mounted, leaving the editor
  // bound to the previous folder's Yjs doc while reads/writes use the new one. The
  // path-scoped key forces a clean remount + a fresh shared doc.
  const viewKey = docKeyFor(wsPath, file);

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
      <div ref={contentRef} style={{ flex: 1, overflow: 'auto' }}>
        {mode === 'md' && <MdEditor key={viewKey} file={file} paneId={paneId} docKey={viewKey} />}
        {mode === 'text' && <TextViewer key={viewKey} file={file} />}
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
      {/* The annotation surface, parked where the reading happens. Readable
          file types only — media files route to the badge panel as before. */}
      {(mode === 'md' || mode === 'text' || mode === 'other') && (
        <AgentNoteStrip key={viewKey} file={file} paneId={paneId} wsPath={wsPath} />
      )}
    </div>
  );
};

// Per-session memory of "Not now" on the empty-note strip, keyed by workspace
// path + file so a dismissal neither leaks across workspaces nor nags again
// every tab switch. Deliberately NOT persisted: the strip is the product's main
// cold-start intervention, and a new session is a fair moment to re-offer it.
const noteStripDismissed = new Set<string>();

/**
 * AgentNoteStrip — the file's agent note, docked under the editor.
 *
 * This is the highest-leverage annotation moment in the app: the user is
 * LOOKING at the file's content, which is the only time writing "what should
 * the agent know about this file?" costs one honest sentence instead of a
 * memory exercise. Two states:
 *   - no note yet → an inline input right here (plus "Not now" for the
 *     session); saving flips it to…
 *   - note exists → a calm one-liner showing exactly what the brief will say
 *     for this file, with its context status and the Add/Remove toggle.
 * All writes ride useFileBadge's autosave controller (badge.set via the badge
 * bus), so the canvas card and badge panel stay in sync for free.
 */
const AgentNoteStrip = ({
  file,
  paneId,
  wsPath,
}: { file: string; paneId: string; wsPath: string }): JSX.Element | null => {
  const fb = useFileBadge(file, `${paneId}:note-strip`);
  const openBadgeInPanel = useWorkspaceStore((s) => s.openBadgeInPanel);
  const dismissKey = `${wsPath}:${file}`;
  const [dismissed, setDismissed] = useState(() => noteStripDismissed.has(dismissKey));
  const hasNote = fb.prompt.trim() !== '';

  if (fb.loading) return null;

  if (!hasNote && dismissed) {
    // Dismissed for the session — keep a one-word way back instead of nothing,
    // so "Not now" never becomes "never".
    return (
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${color.border}`,
          padding: `${space[1]}px ${space[3]}px`,
        }}
      >
        <button
          type="button"
          onClick={() => {
            noteStripDismissed.delete(dismissKey);
            setDismissed(false);
          }}
          style={{
            border: 'none',
            background: 'transparent',
            padding: 0,
            color: color.textGhost,
            fontFamily: font.sans,
            fontSize: font.size.micro,
            cursor: 'pointer',
          }}
        >
          Add agent note
        </button>
      </div>
    );
  }

  if (!hasNote) {
    return (
      <div
        data-testid={`agent-note-strip-empty-${file}`}
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${color.accentSoft}`,
          background: color.accentSofter,
          padding: `${space[2]}px ${space[3]}px`,
          display: 'flex',
          alignItems: 'flex-start',
          gap: space[2],
          fontFamily: font.sans,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: font.size.caption,
              fontWeight: font.weight.medium,
              color: color.textPrimary,
              marginBottom: space[1],
            }}
          >
            What should agents know about this file?
          </div>
          <textarea
            value={fb.prompt}
            onChange={(e) => fb.onPromptChange(e.target.value)}
            onBlur={() => void fb.flushPrompt()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur(); // commit via onBlur → flushPrompt
              }
            }}
            rows={1}
            placeholder="One honest sentence — it goes into every brief that includes this file."
            data-testid={`agent-note-input-${file}`}
            style={{
              width: '100%',
              resize: 'none',
              boxSizing: 'border-box',
              background: color.surface,
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
          {fb.saveError && (
            <div style={{ color: color.warning, fontSize: font.size.micro, marginTop: 2 }}>
              {fb.saveError}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            noteStripDismissed.add(dismissKey);
            setDismissed(true);
          }}
        >
          Not now
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid={`agent-note-strip-${file}`}
      style={{
        flexShrink: 0,
        borderTop: `1px solid ${color.border}`,
        padding: `${space[1.5]}px ${space[3]}px`,
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: color.textSecondary,
        background: color.surfaceMuted,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          background: fb.isFocused ? color.accent : color.textGhost,
        }}
      />
      <button
        type="button"
        title={`The brief will say: ${fb.prompt} — click to edit the File Badge`}
        onClick={() => openBadgeInPanel(file)}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          padding: 0,
          color: color.textSecondary,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          cursor: 'pointer',
        }}
      >
        {fb.prompt}
      </button>
      <Button variant="ghost" size="sm" onClick={() => void fb.toggleFocus()}>
        {fb.isFocused ? 'Remove from Context' : 'Add to Context'}
      </Button>
    </div>
  );
};

const AUTOSAVE_MS = 400;

export const MdEditor = ({
  file,
  paneId,
  docKey,
  compact = false,
  cardEditable = true,
  promoteOnEdit = true,
  onDiscardClose,
}: {
  file: string;
  paneId: string;
  docKey: string;
  compact?: boolean;
  /** Compact card mode can use the exact same BlockNote surface for preview and
   *  editing. Preview passes false: rendered content stays live, but the DOM is
   *  not editable and yields save ownership to any real editor. */
  cardEditable?: boolean;
  promoteOnEdit?: boolean;
  onDiscardClose?: () => void;
}): JSX.Element => {
  // The file's shared in-memory document (created on first open, disposed on last
  // close; see lib/liveDoc). Binding the editor to its Yjs fragment makes every view
  // of this file ONE live document — both editable, char-level synced. `docKey` is
  // workspace-ROOT-scoped by the parent (keyed by it too), so two folders sharing a
  // relative path — or a repath — never collide on one doc.
  const shared = ensureDoc(docKey);
  const editor = useCreateBlockNote({
    schema: bhSchema,
    ...(compact
      ? {
          placeholders: {
            default: 'Start writing...',
            emptyDocument: 'Start writing...',
          },
        }
      : {}),
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
  const surfaceRef = useRef<HTMLDivElement>(null);
  isOwnerRef.current = isOwner;
  // False until the file's shared doc has its seed content APPLIED — gates
  // editability so a fast joiner can't type into the still-empty doc and have its
  // edits overwritten when the async seed lands (see lib/liveDoc markReady/onReady).
  const [seedReady, setSeedReady] = useState(false);
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
  const compactEditable = !compact || cardEditable;
  const ownerPriority = compactEditable ? 1 : 0;
  const ownerPriorityRef = useRef(ownerPriority);
  ownerPriorityRef.current = ownerPriority;

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
    async (options: FlushOptions = {}): Promise<void> => {
      const forceSerialize = options.forceSerialize === true || options.forceWrite === true;
      const forceWrite = options.forceWrite === true;
      if (viewOnlyRef.current) return;
      // Only the OWNER persists. A non-owner view's edits sync to the owner's editor
      // via Yjs, whose onChange drives the single save — so a non-owner flush (e.g.
      // a navigation flush of a non-owner pane) is a no-op.
      if (!isOwnerRef.current) return;
      // A conflict banner is up: the user's explicit Keep/Reload choice is
      // authoritative. Don't let an auto-save / Cmd-S / blur / file-switch write
      // behind it and silently clobber the external edit. keepMine() passes
      // forceWrite (after clearing the ref) to honor the explicit overwrite.
      if (reloadPromptRef.current && !forceWrite) return;
      // Only the user's own edits write back. A mere open/close — or a flush before
      // switching files — must never rewrite the file, even when the projection
      // would normalize a multi-block region it can't index verbatim.
      if (!pendingRef.current && !forceSerialize) {
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
      if (!forceWrite) {
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
      ownerPriority: () => ownerPriorityRef.current,
      setOwner: (o) => {
        isOwnerRef.current = o;
        setIsOwner(o);
        // Inherited ownership after a sibling's "Discard & close" on a write-failure:
        // reload from disk to drop the failed edits that still live in the shared doc.
        if (o && ensureDoc(docKey).discardRequested) {
          ensureDoc(docKey).discardRequested = false;
          pendingRef.current = false;
          setLoadKey((k) => k + 1);
        }
      },
    }),
    [docKey],
  );
  viewRef.current = view;

  useEffect(() => {
    ownerPriorityRef.current = ownerPriority;
    refreshOwner(view);
  }, [ownerPriority, view]);

  // Join this file's shared document on mount: take a hold (claims the owner role
  // if vacant), and — as the FIRST view — SEED the doc from disk. Later views bind
  // to the already-seeded content (Yjs syncs them), so they don't re-read disk and
  // can't double-seed (claimSeed is atomic). Releasing on unmount hands the owner
  // role to a surviving view (see lib/liveDoc).
  useEffect(() => {
    const self = view;
    acquireDoc(self);
    // Every view stays non-editable until the seed content is actually applied, so a
    // joiner can't type into the empty doc and lose it to the incoming seed.
    const offReady = onReady(self, () => setSeedReady(true));
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
        } finally {
          // Mark applied even on a read error (the doc is then empty + editable) so
          // joiners are never stuck waiting; onReady fires → seedReady true.
          markReady(self);
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
      offReady();
      if (joinTimer) clearTimeout(joinTimer);
      releaseDoc(self);
    };
  }, [file, view, applyContent]);

  // Debounced auto-save trigger — stable across renders, delegates via the ref.
  const scheduleSave = useMemo(() => debounce(() => void flushRef.current(), AUTOSAVE_MS), []);

  // The navigation/doc gatekeeper. An unresolved conflict banner is a decision
  // point — return `false` so a tab/file switch or card-edit close DON'T proceed
  // rather than silently dropping local edits or clobbering an external write.
  const flusher = useCallback(async (options: FlushOptions = {}): Promise<boolean> => {
    // A non-owner view has nothing to persist (the owner's autosave does) — allow
    // navigation. (Its edits already synced to the owner via Yjs.)
    if (!isOwnerRef.current) return true;
    if (reloadPromptRef.current) return false;
    await flushRef.current(options);
    // Block if a conflict surfaced mid-flush OR the write failed (edits still
    // unpersisted) — either way leaving now would lose data. The write-failed
    // banner gives an explicit Discard-&-close escape so this never traps.
    return !reloadPromptRef.current && !writeFailedRef.current;
  }, []);

  // Register flush with the store. setCurrentFile (file switch / close) and the
  // TopBar (workspace switch) await this BEFORE the context changes, so pending
  // edits persist while the editor is still alive. We deliberately do NOT flush
  // on unmount: by then the editor may be torn down and serialize to empty,
  // which would clobber the file. Navigation always flushes first instead.
  useEffect(() => {
    registerFlusher(paneId, flusher);
    return () => unregisterFlusher(paneId, flusher);
  }, [flusher, paneId]);

  // Also register by shared document. A canvas card can be a non-owner view when
  // the same file is already open in the right panel; closing the card editor must
  // flush the file's owner, not merely the card pane's no-op non-owner flusher.
  useEffect(() => {
    registerDocFlusher(docKey, flusher);
    return () => unregisterDocFlusher(docKey, flusher);
  }, [docKey, flusher]);

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
    void flushRef.current({ forceSerialize: true, forceWrite: true });
  }, []);

  // Write-failed escape hatch. A persistently-unwritable file (read-only folder,
  // ENOSPC, vanished path) would otherwise trap the editor — the gatekeeper
  // blocks every switch/close. "Retry" re-attempts the save; "Discard & close"
  // drops the unsaved edits and force-closes (bypassFlush skips the gate).
  const retryWrite = useCallback(() => {
    void flushRef.current();
  }, []);
  const discardAndClose = useCallback(() => {
    writeFailedRef.current = false;
    setWriteFailed(false);
    pendingRef.current = false;
    // If the same file is open in OTHER views, the failed edits live in the shared
    // doc — closing just this view would leave a sibling showing them (and a later
    // no-op flush would silently drop them). Flag the doc so the next owner reloads
    // disk and drops them everywhere.
    const shared = ensureDoc(docKey);
    if (shared.views.size > 1) shared.discardRequested = true;
    if (onDiscardClose) {
      onDiscardClose();
    } else {
      closeTab(paneId, file, { bypassFlush: true });
    }
  }, [closeTab, paneId, file, docKey, onDiscardClose]);

  // Cmd/Ctrl+S still works as "save now" for muscle memory (auto-save covers
  // it anyway). Registered once; delegates through the ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // Gated: saves normally, but no-ops while a conflict banner is up so
        // Cmd-S can't bypass the explicit Keep/Reload decision and clobber disk.
        void flushRef.current({ forceSerialize: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!compact || !compactEditable || viewOnly || !seedReady) return;
    const frame = window.requestAnimationFrame(() => {
      (editor as { focus?: () => void }).focus?.();
      surfaceRef.current
        ?.querySelector<HTMLElement>(
          '.bn-editor[contenteditable="true"], .bn-editor [contenteditable="true"]',
        )
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compact, compactEditable, editor, seedReady, viewOnly]);

  return (
    <div
      ref={surfaceRef}
      className={compact ? 'bh-md-editor bh-md-editor-card' : 'bh-md-editor'}
      data-editor-surface={compact ? 'card' : 'panel'}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
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
      <div className="bh-md-editor-scroll" style={{ flex: 1, overflow: 'auto' }}>
        {/* The editor FILLS the pane (like a code editor) — just a vertical
            rhythm + a modest horizontal gutter, no narrow centered column. The
            pane's own width is the measure; widen the pane for a wider editor. */}
        <div
          style={{
            padding: compact
              ? `${space[2]}px ${space[3]}px ${space[3]}px`
              : `${space[5]}px ${space[5]}px`,
          }}
        >
          <BlockNoteView
            className={compact ? 'bh-card-editor' : undefined}
            editor={editor}
            autoFocus={compact && compactEditable}
            // Panel editors and active card editors are editable. Read-only card
            // previews use the same Yjs-backed BlockNote surface with editing off,
            // so preview→edit does not swap renderers under the cursor. Held
            // non-editable until seedReady so a fast joiner can't lose typing.
            editable={!viewOnly && seedReady && compactEditable}
            formattingToolbar={compact ? false : undefined}
            linkToolbar={compact ? false : undefined}
            slashMenu={compact ? false : undefined}
            sideMenu={compact ? false : undefined}
            filePanel={compact ? false : undefined}
            tableHandles={compact ? false : undefined}
            emojiPicker={compact ? false : undefined}
            comments={compact ? false : undefined}
            theme="dark"
            onChange={() => {
              // Gate on seedReady too: a joiner that mounts before the first disk
              // read finishes clears initialLoad after 50ms, but the seed then
              // arrives via Yjs as an onChange — without this it would pin the
              // preview tab (and the owner would "save") on a non-user update.
              if (initialLoad.current || viewOnly || !seedReady) return;
              // Editing a preview tab promotes it to a permanent (pinned) tab —
              // idempotent (no-op once pinned), like a mature editor.
              if (promoteOnEdit) pinTab(paneId, file);
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

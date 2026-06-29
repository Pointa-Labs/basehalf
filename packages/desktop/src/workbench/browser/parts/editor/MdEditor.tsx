import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileEventService } from '../../../../platform/files/browser/fileEventService.js';
import { AUTOSAVE_MS, debounceWithFlush } from '../../../common/editor/mdEditorModel.js';
import { makeAdhdHighlightExtension } from '../../../services/editor/browser/adhdHighlight.js';
import { bhSchema } from '../../../services/editor/browser/blocknoteSchema.js';
import { firstVisibleBlockId } from '../../../services/editor/browser/editorFocusModel.js';
import {
  type LiveDocView,
  acquireDoc,
  claimSeed,
  ensureDoc,
  markReady,
  onReady,
  refreshOwner,
  releaseDoc,
} from '../../../services/editor/browser/liveDoc.js';
import { useReadingMode } from '../../../services/editor/browser/readingModeStore.js';
import {
  type FlushOptions,
  registerDocFlusher,
  registerFlusher,
  unregisterDocFlusher,
  unregisterFlusher,
} from '../../../services/editor/common/editorFlush.js';
import {
  type FocusBlock,
  type LinePrecision,
  blockFileLine,
  blockOrdinal,
  countNewlines,
  refineCursorLine,
  tileSourceNewlines,
  topLevelBlockOf,
} from '../../../services/editor/common/editorFocusModel.js';
import { splitFrontmatter } from '../../../services/editor/common/frontmatter.js';
import {
  type MdEditorApi,
  buildLoadProjection,
  spliceSave,
} from '../../../services/editor/common/mdSegment.js';
import {
  type FocusFields,
  makeFileFocusPusher,
} from '../../../services/mirror/browser/focusPush.js';
import { textFileService } from '../../../services/textfile/browser/textFileService.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { color } from '../../style/design.js';
import { MdEditorBanners } from './MdEditorBanners.js';
import { MdEditorBody } from './MdEditorBody.js';

export const MdEditor = ({
  file,
  paneId,
  docKey,
  compact = false,
  cardEditable = true,
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
  onDiscardClose?: () => void;
}): JSX.Element => {
  // The file's shared in-memory document (created on first open, disposed on last
  // close; see lib/liveDoc). Binding the editor to its Yjs fragment makes every view
  // of this file ONE live document — both editable, char-level synced. `docKey` is
  // workspace-ROOT-scoped by the parent (keyed by it too), so two folders sharing a
  // relative path — or a repath — never collide on one doc.
  const shared = ensureDoc(docKey);
  // The ADHD reading-aids highlight layer (read/unread blocks + keyword spans). A
  // view-only ProseMirror decoration plugin — installed unconditionally (it's a
  // no-op until fed), driven only in the panel editor by <AdhdControls> below
  // when reading mode is on.
  const adhdExtension = useMemo(() => makeAdhdHighlightExtension(), []);
  // Reading mode (the `editor.readingMode` setting) gates the ADHD controls +
  // decorations. Default off: the editor stays a plain writing surface until the
  // user turns reading aids on (globally or per workspace in Settings).
  const readingMode = useReadingMode((s) => s.enabled);
  const editor = useCreateBlockNote({
    schema: bhSchema,
    extensions: [adhdExtension],
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
  const closeEditor = useWorkspaceStore((s) => s.closeEditor);
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
      // MdEditor only ever holds real Markdown now: plain .txt routes to the code
      // editor (see viewerMode), so there's no view-only case left here. Every
      // Markdown file is editable; splice-save preserves anything the user doesn't
      // touch (incl. constructs BlockNote can't model, kept as passthrough blocks).
      setViewOnly(false);
      setReloadPrompt(false);
      setError('');
      setTimeout(() => {
        initialLoad.current = false;
      }, 50);
    },
    [editor, shared],
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
        const result = await textFileService.read(file);
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
          const disk = (await textFileService.read(file)).content;
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
        await textFileService.write(file, md);
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
          const { content } = await textFileService.read(file);
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
      // flags the seeder's applyContent would have (always editable now — .txt
      // routes to the code editor — and cleared banners) and lift the initial-load
      // guard once the sync has settled.
      setViewOnly(false);
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
  const scheduleSave = useMemo(
    () => debounceWithFlush(() => void flushRef.current(), AUTOSAVE_MS),
    [],
  );

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

  // Pull the cursor into the body when the title input asks for it (Enter in
  // NoteTitle). Keyed by path: only the editor mounted on the requested file
  // claims it — so after a title rename remounts this editor on the new name,
  // the NEW instance takes the cursor, never the old one on its way out. Panel
  // editor only; wait for seedReady so the first block exists, then place the
  // cursor at its start and focus. One-shot: consumed.
  const bodyFocusPath = useWorkspaceStore((s) => s.bodyFocusPath);
  useEffect(() => {
    if (compact || bodyFocusPath !== file || !seedReady) return;
    const first = editor.document[0];
    if (first) editor.setTextCursorPosition(first.id, 'start');
    editor.focus();
    useWorkspaceStore.getState().consumeBodyFocus();
  }, [compact, bodyFocusPath, file, seedReady, editor]);

  // Live-sync the user's viewport into focus.yaml — the spec's focus.cursor +
  // focus.visible_lines (where attention is, so a fresh agent reads the same view).
  // PANEL editor only: a canvas card preview isn't the focus authority (the Canvas
  // node-switch effect owns current_focus). A BlockNote block has no source line of
  // its own, so we map it to its .md SOURCE line via the id-keyed verbatim tiles
  // (shared.byId) — see lib/editorFocus. Read-only and best-effort: it never touches
  // the document, only the .bh/ focus mirror (which the watcher ignores → no loop).
  // `compute` runs at flush time so it reads the LATEST cursor/scroll, not the event.
  useEffect(() => {
    if (compact || !seedReady) return;
    const scrollEl = surfaceRef.current?.querySelector<HTMLElement>('.bh-md-editor-scroll');
    const pusher = makeFileFocusPusher(file);
    const computeFields = (): FocusFields | null => {
      // Skip the load flicker (replaceBlocks can move the selection); the debounce
      // already outlasts the 50ms initial-load window, this is belt-and-suspenders.
      if (initialLoad.current) return null;
      const frontmatterLines = countNewlines(shared.frontmatter);
      const blocks = editor.document as unknown as FocusBlock[];
      const fields: {
        visible_lines?: { start: number };
        visible_blocks?: { start: number };
        cursor?: { line: number; column: number; line_precision?: LinePrecision; block?: number };
      } = {};
      try {
        const { block } = editor.getTextCursorPosition();
        const blockStart = blockFileLine(blocks, block.id, shared.byId, frontmatterLines);
        if (blockStart != null) {
          // Dual address: source `line` (the agent edits by it) + `block` ordinal
          // (what the user perceives). `line_precision` flags how trustworthy the
          // line is — exact for single-line + code blocks, block_start otherwise,
          // estimated for a freshly-typed block with no saved tile yet.
          const tl = topLevelBlockOf(blocks, block.id);
          const entry = tl ? shared.byId.get(tl.block.id) : undefined;
          const sel = editor.prosemirrorView?.state.selection;
          const parentOffset = sel?.$from.parentOffset;
          // Column: in a fenced code block the cursor's real SOURCE column on its
          // line; elsewhere a best-effort in-block character offset (1-based).
          let column = typeof parentOffset === 'number' && parentOffset >= 0 ? parentOffset + 1 : 1;
          let codeWithinOffset: number | null = null;
          if (
            tl?.direct &&
            tl.block.type === 'codeBlock' &&
            sel &&
            typeof parentOffset === 'number'
          ) {
            const text = sel.$from.parent.textContent ?? '';
            const before = text.slice(0, parentOffset);
            codeWithinOffset = countNewlines(before);
            column = before.length - (before.lastIndexOf('\n') + 1) + 1;
          }
          const { line, precision } = refineCursorLine({
            blockStart,
            hasEntry: entry !== undefined,
            blockSourceNewlines: entry ? tileSourceNewlines(entry) : 0,
            directHit: tl?.direct ?? false,
            codeWithinOffset,
          });
          const ordinal = blockOrdinal(blocks, block.id);
          fields.cursor = {
            line,
            column,
            line_precision: precision,
            ...(ordinal != null && { block: ordinal }),
          };
        }
      } catch {
        /* no live selection yet — fall through to the visible-line signal */
      }
      const visibleId = firstVisibleBlockId(editor.domElement, scrollEl);
      if (visibleId) {
        const line = blockFileLine(blocks, visibleId, shared.byId, frontmatterLines);
        if (line != null) fields.visible_lines = { start: line };
        const ordinal = blockOrdinal(blocks, visibleId);
        if (ordinal != null) fields.visible_blocks = { start: ordinal };
      }
      return fields.cursor || fields.visible_lines || fields.visible_blocks ? fields : null;
    };
    const onActivity = (): void => pusher(computeFields);
    const offSelection = editor.onSelectionChange(onActivity);
    scrollEl?.addEventListener('scroll', onActivity, { passive: true });
    return () => {
      offSelection();
      scrollEl?.removeEventListener('scroll', onActivity);
      pusher.cancel();
    };
  }, [compact, seedReady, file, editor, shared]);

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
    const unsub = fileEventService.onDidChangeFiles((event) => {
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
            disk = (await textFileService.read(file)).content;
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
  // drops the unsaved edits and closes the overlay (after clearing the
  // write-failed ref, so the close gate no longer blocks).
  const retryWrite = useCallback(() => {
    void flushRef.current();
  }, []);
  const discardAndClose = useCallback(() => {
    writeFailedRef.current = false;
    setWriteFailed(false);
    pendingRef.current = false;
    // If the same file is open in OTHER views (a card badge face binding the same
    // doc), the failed edits live in the shared doc — flag it so the next owner
    // reloads disk and drops them everywhere.
    const shared = ensureDoc(docKey);
    if (shared.views.size > 1) shared.discardRequested = true;
    if (onDiscardClose) {
      onDiscardClose();
    } else {
      // The write-failed ref is cleared above, so the close gate won't block.
      closeEditor();
    }
  }, [closeEditor, docKey, onDiscardClose]);

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
      <MdEditorBanners
        viewOnly={viewOnly}
        reloadPrompt={reloadPrompt}
        writeFailed={writeFailed}
        error={error}
        onKeepMine={keepMine}
        onAcceptReload={acceptReload}
        onRetryWrite={retryWrite}
        onDiscardAndClose={discardAndClose}
      />
      <MdEditorBody
        compact={compact}
        readingMode={readingMode}
        file={file}
        paneId={paneId}
        editor={editor}
        shared={shared}
        seedReady={seedReady}
        loadKey={loadKey}
        viewOnly={viewOnly}
        compactEditable={compactEditable}
        initialLoad={initialLoad}
        isOwnerRef={isOwnerRef}
        pendingRef={pendingRef}
        scheduleSave={scheduleSave}
      />
    </div>
  );
};

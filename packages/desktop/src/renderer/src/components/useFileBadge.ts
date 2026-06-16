import type { BadgeFile, BadgeGetResult, BadgeKind } from '@basehalf/core';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { subscribeBadgeChange } from '../lib/badgeBus.js';
import { badgeMutations } from '../lib/badgeMutations.js';
import { registerFlusher, unregisterFlusher } from '../lib/editorFlush.js';
import { focusMutations } from '../lib/focusMutations.js';
import { type PickOption, pick } from './Dialog.js';

// Everything about ONE badge (file OR folder) — load, autosave, references,
// inbound, focus, and cross-surface sync — lives here, so the badge UI (the
// in-card badge face) stays a pure layout. The component reads this controller's
// fields and wires its handlers to the UI; it never touches IPC or the badge bus
// directly.
//
// File vs folder differ in exactly two places, gated on `kind`:
//   - focus: a file toggles in/out of the active set (focus.toggleActiveFile); a
//     folder IS the grouping, so its focus action sets the whole folder
//     (focus.set({folder})) — a one-way "Add to Context", matching the canvas's
//     folder-scope button. `isFocused` for a folder = its derived files are all
//     present in the active set.
//   - reference picking: a folder's add-reference picker lists from the folder's
//     OWN level (its direct contents), a file's from its parent folder.

type SaveState = 'idle' | 'saving' | 'saved';
type InboundEntries = readonly { from: string; note?: string }[];

export interface FileBadgeController {
  readonly kind: BadgeKind;
  readonly loading: boolean;
  readonly prompt: string;
  readonly saveState: SaveState;
  readonly saveError: string | null;
  readonly refs: BadgeFile['references'];
  readonly inbound: InboundEntries;
  readonly isFocused: boolean;
  readonly modified: string | null;
  readonly onPromptChange: (value: string) => void;
  readonly flushPrompt: () => Promise<boolean>;
  readonly removeRef: (to: string) => Promise<void>;
  readonly updateRefNote: (to: string, note: string) => Promise<void>;
  readonly addReference: () => Promise<void>;
  readonly toggleFocus: () => Promise<void>;
}

export function useFileBadge(
  file: string,
  paneId: string,
  kind: BadgeKind = 'file',
): FileBadgeController {
  // This panel's stable identity on the badge bus — so it ignores its OWN writes
  // but still reacts to a SECOND panel (split view) editing a file it references.
  const sourceId = useId();
  const [badge, setBadge] = useState<BadgeFile | null>(null);
  const [prompt, setPrompt] = useState('');
  const [inbound, setInbound] = useState<InboundEntries>([]);
  const [focusActive, setFocusActive] = useState<readonly string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Autosave is silent by nature — surface a quiet Saving…/Saved so the user
  // knows their note persisted. 'idle' = untouched since load (show nothing).
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPrompt = useRef<string | null>(null);

  // For a folder badge, "focused" means its derived files are all in the active
  // set — so we cache the folder's supported files alongside the graph data.
  const [folderFiles, setFolderFiles] = useState<readonly string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const [b, focus, ff] = await Promise.all([
        window.bh.run('badge.get', { file, kind }) as Promise<BadgeGetResult>,
        window.bh.run('focus.get', {}) as Promise<{ active: string[] }>,
        kind === 'folder'
          ? (window.bh.run('workspace.listSupportedFiles', { folder: file }) as Promise<{
              files: string[];
            }>)
          : Promise.resolve({ files: [] as string[] }),
      ]);
      setBadge(b);
      setPrompt(b?.prompt ?? '');
      pendingPrompt.current = null;
      setSaveState('idle');
      // Backlinks come from the badge's embedded referenced_by (was inbound.get).
      setInbound(b?.referenced_by ?? []);
      setFocusActive(focus.active);
      setFolderFiles(ff.files);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [file, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-pull the graph data (references + inbound + focus) when the OTHER surface
  // edits this badge — e.g. a drag-to-connect on the canvas. Keeps the panel in
  // sync without a manual reload. Guarded so an in-progress prompt edit is never
  // stomped: the prompt textarea is locally owned (autosave), so only sync it
  // when nothing is pending.
  const refreshGraph = useCallback(async () => {
    try {
      const [b, focus] = await Promise.all([
        window.bh.run('badge.get', { file, kind }) as Promise<BadgeGetResult>,
        window.bh.run('focus.get', {}) as Promise<{ active: string[] }>,
      ]);
      setBadge(b);
      setInbound(b?.referenced_by ?? []);
      setFocusActive(focus.active);
      if (pendingPrompt.current === null) setPrompt(b?.prompt ?? '');
    } catch {
      // Transient refresh failure: keep current state, don't flash a save error.
    }
  }, [file, kind]);

  useEffect(() => {
    const unsub = subscribeBadgeChange((origin) => {
      if (origin === sourceId) return; // our own edit already updated local state
      void refreshGraph();
    });
    return unsub;
  }, [refreshGraph, sourceId]);

  const flushPrompt = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const next = pendingPrompt.current;
    if (next === null) return true;
    try {
      const saved = await badgeMutations.setPrompt(file, next, sourceId, kind);
      pendingPrompt.current = null;
      setBadge(saved);
      setSaveError(null);
      setSaveState('saved');
      return true;
    } catch (err) {
      setSaveError(`Couldn't save File Badge: ${err instanceof Error ? err.message : String(err)}`);
      setSaveState('idle');
      return false;
    }
  }, [file, kind, sourceId]);

  useEffect(() => {
    registerFlusher(paneId, flushPrompt);
    return () => {
      unregisterFlusher(paneId, flushPrompt);
      void flushPrompt();
    };
  }, [paneId, flushPrompt]);

  const onPromptChange = useCallback(
    (value: string) => {
      setPrompt(value);
      setSaveState('saving');
      pendingPrompt.current = value;
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
        const saved = await badgeMutations.removeRef({ file, to, kind }, sourceId);
        setBadge(saved);
        setSaveError(null);
      } catch (err) {
        setSaveError(
          `Couldn't remove reference: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [file, kind, flushPrompt, sourceId],
  );

  const updateRefNote = useCallback(
    async (to: string, note: string) => {
      if (!(await flushPrompt())) return;
      const trimmed = note.trim();
      const existing = badge?.references.find((ref) => ref.to === to);
      try {
        const saved = await badgeMutations.addRef(
          {
            file,
            to,
            kind,
            ...(trimmed !== '' && { note: trimmed }),
            ...(existing?.fromSide !== undefined && { fromSide: existing.fromSide }),
            ...(existing?.toSide !== undefined && { toSide: existing.toSide }),
          },
          sourceId,
        );
        setBadge(saved);
        setSaveError(null);
      } catch (err) {
        setSaveError(
          `Couldn't save reference note: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [badge, file, kind, flushPrompt, sourceId],
  );

  const addReference = useCallback(async () => {
    if (!(await flushPrompt())) return;
    // Pick from the current folder LEVEL only (the file's own folder), matching
    // the canvas's one-level-at-a-time model — listCanvas is that same source.
    // Each entry carries its badge prompt as a searchable hint; exclude self +
    // already-linked. (No dir hint: every option shares this folder.)
    // A file picks from its PARENT folder level; a folder picks from its OWN
    // direct contents (matching the canvas's one-level-at-a-time model).
    const slashIdx = file.lastIndexOf('/');
    const folder = kind === 'folder' ? file : slashIdx === -1 ? null : file.slice(0, slashIdx);
    let options: PickOption[];
    try {
      const res = (await window.bh.run('workspace.listCanvas', { folder })) as {
        badges: BadgeFile[];
      };
      const existing = new Set((badge?.references ?? []).map((r) => r.to));
      options = res.badges
        .filter((b) => b.kind === 'file' && b.file !== file && !existing.has(b.file))
        .map((b) => {
          const slash = b.file.lastIndexOf('/');
          return {
            value: b.file,
            label: slash === -1 ? b.file : b.file.slice(slash + 1),
            ...(b.prompt !== undefined && b.prompt !== '' && { detail: b.prompt }),
          };
        });
    } catch (err) {
      setSaveError(`Couldn't list files: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const to = await pick({
      title: 'Add a reference',
      placeholder: `Search ${folder ? `${folder}/` : 'the workspace root'}…`,
      emptyText: 'No other files in this folder.',
      options,
    });
    if (!to) return;
    try {
      const saved = await badgeMutations.addRef({ file, to, kind }, sourceId);
      setBadge(saved);
      setSaveError(null);
    } catch (err) {
      setSaveError(`Couldn't add reference: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [file, kind, badge, flushPrompt, sourceId]);

  const toggleFocus = useCallback(async () => {
    if (!(await flushPrompt())) return;
    try {
      if (kind === 'folder') {
        // A folder IS the grouping: set the WHOLE folder as the context (its files
        // + the folder prompt as the turn intent), matching the canvas's folder
        // button. One-way "Add to Context" — folder un-focus is "Clear" elsewhere.
        const after = await focusMutations.setFolder(file, sourceId);
        setFocusActive(after.active);
      } else {
        const after = await focusMutations.toggleActiveFile(file, sourceId);
        setFocusActive(after.active);
      }
      // focusMutations already emits on the badge bus so the canvas re-derives its
      // focused-card highlight; our own listener ignores the sourceId.
    } catch (err) {
      setSaveError(
        `Couldn't update Agent Context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [file, kind, flushPrompt, sourceId]);

  // A file is focused when it's in the active set. A folder is focused when ALL
  // its derived files are active (and it has some) — i.e. the whole folder was
  // added to context. Empty folders can't be "focused".
  const isFocused =
    kind === 'folder'
      ? folderFiles.length > 0 && folderFiles.every((f) => focusActive.includes(f))
      : focusActive.includes(file);

  return {
    kind,
    loading,
    prompt,
    saveState,
    saveError,
    refs: badge?.references ?? [],
    inbound,
    isFocused,
    modified: badge?.modifiedAt ? new Date(badge.modifiedAt).toLocaleString() : null,
    onPromptChange,
    flushPrompt,
    removeRef,
    updateRefNote,
    addReference,
    toggleFocus,
  };
}

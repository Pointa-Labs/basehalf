import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import { type PickOption, pick } from '../../../browser/parts/dialogs/Dialog.js';
import {
  registerFlusher,
  unregisterFlusher,
} from '../../../services/editor/browser/editorFlush.js';
import { subscribeBadgeChange } from '../../../services/mirror/browser/badgeBus.js';
import { badgeMutations } from '../../../services/mirror/browser/badgeMutations.js';
import { badgeService } from '../../../services/mirror/browser/badgeService.js';
import type { BadgeFile, BadgeKind } from '../../../services/mirror/common/badge.js';

// Everything about ONE badge (file OR folder) — load, autosave, references,
// inbound, and cross-surface sync — lives here, so the badge UI (the in-card
// badge face) stays a pure layout. The component reads this controller's fields
// and wires its handlers to the UI; it never touches IPC or the badge bus
// directly.
//
// File vs folder differ in exactly one place, gated on `kind`:
//   - reference picking: a folder's add-reference picker lists from the folder's
//     OWN level (its direct contents), a file's from its parent folder.

type SaveState = 'idle' | 'saving' | 'saved';
// Backlinks are plain paths now (the embedded `referenced_by` string[]); the old
// per-link note is gone with the reference-note model.
type InboundEntries = readonly string[];

export interface FileBadgeController {
  readonly kind: BadgeKind;
  readonly loading: boolean;
  readonly prompt: string;
  readonly saveState: SaveState;
  readonly saveError: string | null;
  /** Outbound references — plain workspace-relative paths (no per-ref note). */
  readonly refs: readonly string[];
  readonly inbound: InboundEntries;
  readonly onPromptChange: (value: string) => void;
  readonly flushPrompt: () => Promise<boolean>;
  readonly removeRef: (to: string) => Promise<void>;
  readonly addReference: () => Promise<void>;
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Autosave is silent by nature — surface a quiet Saving…/Saved so the user
  // knows their note persisted. 'idle' = untouched since load (show nothing).
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPrompt = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const b = await badgeService.get(file, kind);
      setBadge(b);
      setPrompt(b?.description ?? '');
      pendingPrompt.current = null;
      setSaveState('idle');
      // Backlinks come from the badge's embedded referenced_by (plain paths).
      setInbound(b?.referenced_by ?? []);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [file, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-pull the graph data (references + inbound) when the OTHER surface edits
  // this badge — e.g. a drag-to-connect on the canvas. Keeps the panel in sync
  // without a manual reload. Guarded so an in-progress prompt edit is never
  // stomped: the prompt textarea is locally owned (autosave), so only sync it
  // when nothing is pending.
  const refreshGraph = useCallback(async () => {
    try {
      const b = await badgeService.get(file, kind);
      setBadge(b);
      setInbound(b?.referenced_by ?? []);
      if (pendingPrompt.current === null) setPrompt(b?.description ?? '');
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
      const saved = await badgeMutations.setDescription(file, next, sourceId, kind);
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
      const res = await workspaceService.listCanvas(folder);
      const existing = new Set(badge?.references ?? []);
      options = res.children
        .filter((b) => b.kind === 'file' && b.path !== file && !existing.has(b.path))
        .map((b) => {
          const slash = b.path.lastIndexOf('/');
          return {
            value: b.path,
            label: slash === -1 ? b.path : b.path.slice(slash + 1),
            ...(b.description !== undefined && b.description !== '' && { detail: b.description }),
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

  return {
    kind,
    loading,
    prompt,
    saveState,
    saveError,
    refs: badge?.references ?? [],
    inbound,
    onPromptChange,
    flushPrompt,
    removeRef,
    addReference,
  };
}

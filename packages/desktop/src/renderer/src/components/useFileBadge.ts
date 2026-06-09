import type { BadgeFile, BadgeGetResult, InboundGetResult } from '@basehalf/core';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { emitBadgeChange, subscribeBadgeChange } from '../lib/badgeBus.js';
import { badgeMutations } from '../lib/badgeMutations.js';
import { registerFlusher, unregisterFlusher } from '../lib/editorFlush.js';
import { type PickOption, pick } from './Dialog.js';

// Everything about ONE file's badge — load, autosave, references, inbound, focus,
// and cross-surface sync — lives here, so BadgePage stays a pure layout. The
// component reads this controller's fields and wires its handlers to the UI; it
// never touches IPC or the badge bus directly.

type SaveState = 'idle' | 'saving' | 'saved';
type InboundEntries = readonly { from: string; note?: string }[];

export interface FileBadgeController {
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

export function useFileBadge(file: string, paneId: string): FileBadgeController {
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
      setSaveState('idle');
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

  // Re-pull the graph data (references + inbound + focus) when the OTHER surface
  // edits this badge — e.g. a drag-to-connect on the canvas. Keeps the panel in
  // sync without a manual reload. Guarded so an in-progress prompt edit is never
  // stomped: the prompt textarea is locally owned (autosave), so only sync it
  // when nothing is pending.
  const refreshGraph = useCallback(async () => {
    try {
      const [b, ib, focus] = await Promise.all([
        window.bh.run('badge.get', { file, kind: 'file' }) as Promise<BadgeGetResult>,
        window.bh.run('inbound.get', { file }) as Promise<InboundGetResult>,
        window.bh.run('focus.get', {}) as Promise<{ active: string[] }>,
      ]);
      setBadge(b);
      setInbound(ib.entries);
      setFocusActive(focus.active);
      if (pendingPrompt.current === null) setPrompt(b?.prompt ?? '');
    } catch {
      // Transient refresh failure: keep current state, don't flash a save error.
    }
  }, [file]);

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
      const saved = await badgeMutations.setPrompt(file, next, sourceId);
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
  }, [file, sourceId]);

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
        const saved = await badgeMutations.removeRef({ file, to, kind: 'file' }, sourceId);
        setBadge(saved);
        setSaveError(null);
      } catch (err) {
        setSaveError(
          `Couldn't remove reference: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [file, flushPrompt, sourceId],
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
            kind: 'file',
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
    [badge, file, flushPrompt, sourceId],
  );

  const addReference = useCallback(async () => {
    if (!(await flushPrompt())) return;
    // Pick from the current folder LEVEL only (the file's own folder), matching
    // the canvas's one-level-at-a-time model — listCanvas is that same source.
    // Each entry carries its badge prompt as a searchable hint; exclude self +
    // already-linked. (No dir hint: every option shares this folder.)
    const slashIdx = file.lastIndexOf('/');
    const folder = slashIdx === -1 ? null : file.slice(0, slashIdx);
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
      const saved = await badgeMutations.addRef({ file, to, kind: 'file' }, sourceId);
      setBadge(saved);
      setSaveError(null);
    } catch (err) {
      setSaveError(`Couldn't add reference: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [file, badge, flushPrompt, sourceId]);

  const toggleFocus = useCallback(async () => {
    if (!(await flushPrompt())) return;
    try {
      const after = (await window.bh.run('focus.toggleActiveFile', { file })) as {
        active: string[];
      };
      setFocusActive(after.active);
      // Focus isn't a badge write, but the canvas highlights focused cards — nudge
      // it to re-derive. (Tagged with our id so our own bus listener ignores it.)
      emitBadgeChange(sourceId);
    } catch (err) {
      setSaveError(
        `Couldn't update Agent Context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [file, flushPrompt, sourceId]);

  return {
    loading,
    prompt,
    saveState,
    saveError,
    refs: badge?.references ?? [],
    inbound,
    isFocused: focusActive.includes(file),
    modified: badge?.modifiedAt ? new Date(badge.modifiedAt).toLocaleString() : null,
    onPromptChange,
    flushPrompt,
    removeRef,
    updateRefNote,
    addReference,
    toggleFocus,
  };
}

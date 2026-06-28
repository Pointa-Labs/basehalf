import { AllSelection } from '@tiptap/pm/state';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ContextMenuItem,
  openContextMenu,
} from '../../../browser/parts/contextmenu/contextMenuStore.js';
import {
  type AdhdEditorApi,
  pushAdhdDecorations,
} from '../../../services/editor/browser/adhdHighlight.js';
import type { LineRange } from '../../../services/editor/browser/adhdModel.js';
import {
  blockReadSpan,
  countNewlines,
  linesToBlockIds,
} from '../../../services/editor/browser/editorFocusModel.js';
import type { SharedDoc } from '../../../services/editor/browser/liveDoc.js';
import { adhdService } from '../../../services/mirror/browser/adhdService.js';

/**
 * ADHD reading-aids controller for the PANEL Markdown editor (Markdown-only — the
 * code/text viewer carries no aids). Mounts only in reading mode and wires the two
 * spec interactions. There is NO visible toolbar: the spec prescribes none (just
 * right-click keywords + a per-paragraph checkbox + dimming), so this component
 * renders nothing and only drives the behavior:
 *   - read/unread: a RIGHT-gutter checkbox per top-level block (rendered by the
 *     decoration plugin, lib/adhdHighlight, as a widget — on the right so it never
 *     collides with BlockNote's left side menu / drag handle); this component
 *     handles the click by delegation and toggles the block.
 *   - keywords: RIGHT-CLICK a selected word to add/remove it as a highlight (the
 *     only keyword entry point — removal is right-clicking the highlighted word).
 *
 * Read state targets BlockNote BLOCKS: the dim (via decorations) is tracked by block
 * id in-session, while persistence stays the canonical SOURCE line-ranges in
 * adhd.yaml. The two address spaces meet at this seam: source lines → block ids on
 * load (so an agent-written range shows up), and a marked block → its source-line
 * span on write (so the agent reads it back). (The spec's "blank line inherits the
 * previous line's read state" clause is N/A to this block model — blank lines are
 * inter-block separators, not blocks, so there's nothing to mark or strand.)
 *
 * Known v1 bound: read_paragraphs is a SNAPSHOT of where a block's source sat at mark
 * time. The in-session highlight follows the block by id (correct across edits), but
 * if the user edits text ABOVE a marked block and then saves + reloads, the persisted
 * line range re-projects onto whatever block now occupies those lines. Acceptable for
 * v1 (an attention aid, not content).
 */

interface AdhdState {
  readonly highlight_keywords?: readonly string[];
  readonly read_paragraphs?: readonly LineRange[];
}

export const AdhdControls = ({
  editor,
  shared,
  file,
  seedReady,
  loadKey,
}: {
  editor: AdhdEditorApi;
  shared: SharedDoc;
  file: string;
  seedReady: boolean;
  /** Bumps whenever the owner re-applies disk content (seed + external reload /
   *  agent edit). A reload mints fresh block ids and rebuilds shared.byId, so we
   *  must re-fetch adhd.yaml and re-project ranges → ids, else the by-id read set
   *  goes stale (dimming vanishes). */
  loadKey: number;
}): JSX.Element | null => {
  const [adhd, setAdhd] = useState<AdhdState>({});
  // The read blocks by id — the in-session dimming truth. Seeded from the canonical
  // source-line ranges on load, then tracked by id (stable across edits) so typing
  // doesn't drift the highlight the way re-projecting line numbers would.
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());

  const keywords = useMemo(() => adhd.highlight_keywords ?? [], [adhd]);

  // Load adhd.yaml on open, on file switch, AND on every reload (loadKey) — a reload
  // re-applies disk content with fresh block ids + a rebuilt shared.byId, so we must
  // re-project ranges → ids against the new document. Gated on seedReady: the live
  // document and shared.byId are only meaningful once the disk content is applied.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey is the intentional re-run trigger; the body re-reads the now-current document/byId and reads nothing off loadKey itself.
  useEffect(() => {
    if (!seedReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await adhdService.get(file);
        if (cancelled) return;
        setAdhd(res ?? {});
        const ranges = res?.read_paragraphs ?? [];
        const frontmatterLines = countNewlines(shared.frontmatter);
        setReadIds(
          new Set(linesToBlockIds(editor.document, shared.byId, frontmatterLines, ranges)),
        );
      } catch {
        if (!cancelled) {
          setAdhd({});
          setReadIds(new Set());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, seedReady, editor, shared, loadKey]);

  // Push the current read blocks + keywords into the editor's decoration plugin
  // whenever either changes. `enabled: true` is reading mode — this control only
  // mounts then, so its presence IS the on-signal (the per-block checkboxes show).
  // Meta-only dispatch → no document change → no autosave.
  useEffect(() => {
    if (!seedReady) return;
    pushAdhdDecorations(editor, { enabled: true, readBlockIds: [...readIds], keywords });
  }, [editor, seedReady, readIds, keywords]);

  // Clear the decoration layer when this control unmounts — e.g. reading mode is
  // toggled OFF mid-session. Without it the last-pushed checkboxes/dimming would
  // linger on the shared editor (the plugin holds its last fed state).
  useEffect(
    () => () => pushAdhdDecorations(editor, { enabled: false, readBlockIds: [], keywords: [] }),
    [editor],
  );

  // Every adhd command returns the new state (or null when it prunes to empty), so
  // apply it directly — no re-fetch.
  const runAdhd = useCallback(async (operation: () => Promise<AdhdState | null>): Promise<void> => {
    try {
      const res = await operation();
      setAdhd(res ?? {});
    } catch {
      /* best-effort — leave the state as-is on a failed write */
    }
  }, []);

  const removeKeyword = useCallback(
    (kw: string) => void runAdhd(() => adhdService.removeKeyword(file, kw)),
    [file, runAdhd],
  );

  // Right-click a selected word → add/remove it as a highlight keyword (the spec's
  // keyword gesture: select a word, choose from the context menu). The listener
  // lives on the editor body and only acts on a non-empty selection, so an
  // empty-selection right-click still gets the default menu. Matching is
  // case-insensitive: a selection equal to an existing keyword offers REMOVE (using
  // the stored casing), otherwise ADD — and removing a highlight is exactly
  // right-clicking the highlighted word (there's no chip list anymore).
  //
  // Because opening an in-app menu suppresses the native one, we ALSO carry the
  // standard clipboard actions the native editor menu would have — otherwise
  // right-clicking selected text in reading mode would lose Cut/Copy/Paste. These
  // act through the ProseMirror view (its selection survives the menu overlay,
  // unlike the DOM selection), so they're reliable.
  useEffect(() => {
    const dom = editor.prosemirrorView?.dom;
    if (!dom) return;
    const onContextMenu = (e: MouseEvent): void => {
      const selected = (window.getSelection()?.toString() ?? '').trim();
      if (selected === '') return; // no word selected — leave the default menu
      const existing = keywords.find((k) => k.toLowerCase() === selected.toLowerCase());
      const view = editor.prosemirrorView;
      // Copy/Cut act on the ProseMirror selection — the exact text Cut deletes —
      // so the two never diverge; fall back to the DOM selection if the view is
      // somehow absent.
      const clipText =
        view?.state.doc.textBetween(
          view.state.selection.from,
          view.state.selection.to,
          '\n',
          '\n',
        ) || selected;
      const items: ContextMenuItem[] = [
        existing
          ? {
              id: 'adhd-remove-keyword',
              label: `Remove “${existing}” from highlights`,
              run: () => removeKeyword(existing),
            }
          : {
              id: 'adhd-add-keyword',
              label: `Highlight “${selected}”`,
              run: () => void runAdhd(() => adhdService.addKeyword(file, selected)),
            },
        { separator: true },
        { id: 'copy', label: 'Copy', run: () => void navigator.clipboard.writeText(clipText) },
      ];
      if (view) {
        items.push(
          {
            id: 'cut',
            label: 'Cut',
            run: () => {
              void navigator.clipboard.writeText(clipText);
              view.dispatch(view.state.tr.deleteSelection());
              view.focus();
            },
          },
          {
            id: 'paste',
            label: 'Paste',
            run: () =>
              void navigator.clipboard
                .readText()
                .then((t: string) => {
                  if (t) view.dispatch(view.state.tr.insertText(t));
                  view.focus();
                })
                .catch(() => view.focus()),
          },
          {
            id: 'select-all',
            label: 'Select All',
            run: () => {
              view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
              view.focus();
            },
          },
        );
      }
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, items);
    };
    dom.addEventListener('contextmenu', onContextMenu);
    return () => dom.removeEventListener('contextmenu', onContextMenu);
  }, [editor, keywords, removeKeyword, runAdhd, file]);

  // Toggle one top-level block's read state — the spec's per-block checkbox click.
  // The block's id resolves to its canonical SOURCE line span (so the agent reads
  // the same ranges back); read state is also tracked by id for the in-session dim.
  // blockReadSpan (not blockSourceSpan) extends the span over the trailing blank-line
  // separator so the blank inherits this block's read state (spec §空行继承上一行) and
  // adjacent read blocks coalesce in read_paragraphs with no false "unread" gap.
  const toggleBlockRead = useCallback(
    (blockId: string) => {
      const blocks = editor.document;
      const span = blockReadSpan(blocks, blockId, shared.byId, countNewlines(shared.frontmatter));
      if (!span) return;
      const isRead = readIds.has(blockId);
      void runAdhd(() =>
        isRead
          ? adhdService.markUnread(file, { start: span.start, end: span.end })
          : adhdService.markRead(file, { start: span.start, end: span.end }),
      );
      setReadIds((prev) => {
        const next = new Set(prev);
        if (isRead) next.delete(blockId);
        else next.add(blockId);
        return next;
      });
    },
    [editor, shared, readIds, runAdhd, file],
  );

  // The read checkboxes are rendered by the decoration plugin (lib/adhdHighlight) as
  // right-gutter widgets carrying `data-bh-block-id`. Handle their clicks by
  // delegation on the editor body: mousedown so we can preventDefault before the
  // editor moves the selection/focus into the block.
  useEffect(() => {
    const dom = editor.prosemirrorView?.dom;
    if (!dom) return;
    const onMouseDown = (e: MouseEvent): void => {
      const box = (e.target as HTMLElement | null)?.closest?.(
        '.bh-adhd-check',
      ) as HTMLElement | null;
      const id = box?.getAttribute('data-bh-block-id');
      if (!id) return;
      // Capture phase + stopPropagation so ProseMirror (its own mousedown is
      // registered first) never moves the caret into the block on a gutter click.
      e.preventDefault();
      e.stopPropagation();
      toggleBlockRead(id);
    };
    dom.addEventListener('mousedown', onMouseDown, true);
    return () => dom.removeEventListener('mousedown', onMouseDown, true);
  }, [editor, toggleBlockRead]);

  // No visible UI — reading mode is the aids themselves (right-gutter checkboxes,
  // dimmed read paragraphs, highlighted keywords), per the spec's bar-less form.
  return null;
};

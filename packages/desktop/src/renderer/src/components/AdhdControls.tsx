import { AllSelection } from '@tiptap/pm/state';
import { type CSSProperties, type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { color, font, radius, space } from '../design.js';
import type { LineRange } from '../lib/adhd.js';
import { type AdhdEditorApi, pushAdhdDecorations } from '../lib/adhdHighlight.js';
import { blockSourceSpan, countNewlines, linesToBlockIds } from '../lib/editorFocus.js';
import type { SharedDoc } from '../lib/liveDoc.js';
import { type ContextMenuItem, openContextMenu } from '../store/contextMenu.js';

/**
 * ADHD reading-aids controller for the PANEL Markdown editor (Markdown-only — the
 * code/text viewer carries no aids). Mounts only in reading mode, and owns the two
 * spec gestures:
 *   - read/unread: a LEFT-GUTTER checkbox per top-level block (rendered by the
 *     decoration plugin, lib/adhdHighlight, as a widget); this component handles the
 *     click by delegation and toggles the block.
 *   - keywords: RIGHT-CLICK a selected word to add/remove it as a highlight.
 * The slim toolbar carries only the active-keyword chips, a Read N/M counter, and
 * whole-file All/Clear.
 *
 * Read state targets BlockNote BLOCKS: the dim (via decorations) is tracked by block
 * id in-session, while persistence stays the canonical SOURCE line-ranges in
 * adhd.yaml. The two address spaces meet at this seam: source lines → block ids on
 * load (so an agent-written range shows up), and a marked block → its source-line
 * span on write (so the agent reads it back).
 *
 * Known v1 bound: read_paragraphs is a SNAPSHOT of where a block's source sat at mark
 * time. The in-session highlight follows the block by id (correct across edits), but
 * if the user edits text ABOVE a marked block and then saves + reloads, the persisted
 * line range re-projects onto whatever block now occupies those lines — so the on-disk
 * truth an agent reads can shift off the originally-marked block. Acceptable for v1
 * (an attention aid, not content); a flush-time re-derive of ranges from the live
 * block spans would close it.
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
   *  goes stale (dimming vanishes, count shows 0). */
  loadKey: number;
}): JSX.Element => {
  const [adhd, setAdhd] = useState<AdhdState>({});
  // Force a re-render on every editor edit so the "Read N/M" count below reflects
  // the live document (block add/delete). The editor's document is imperative, so
  // without this the count freezes until an unrelated state change.
  const [, forceTick] = useState(0);
  useEffect(() => editor.onChange?.(() => forceTick((n) => n + 1)), [editor]);
  // The read blocks by id — the in-session dimming truth. Seeded from the canonical
  // source-line ranges on load, then tracked by id (stable across edits) so typing
  // doesn't drift the highlight the way re-projecting line numbers would.
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());

  const keywords = useMemo(() => adhd.highlight_keywords ?? [], [adhd]);

  // Load adhd.yaml on open, on file switch, AND on every reload (loadKey) — a reload
  // re-applies disk content with fresh block ids + a rebuilt shared.byId, so we must
  // re-project ranges → ids against the new document. Gated on seedReady: the live
  // document and shared.byId are only meaningful once the disk content is applied.
  // Re-fetching on reload also picks up an agent's concurrent adhd.yaml edit (the v1
  // "reopen to re-read" gap shrinks to "reload to re-read").
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey is the intentional re-run trigger; the body re-reads the now-current document/byId and reads nothing off loadKey itself.
  useEffect(() => {
    if (!seedReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = (await window.bh.run('adhd.get', { file })) as AdhdState | null;
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
  const runAdhd = useCallback(
    async (command: string, args: Record<string, unknown>): Promise<void> => {
      try {
        const res = (await window.bh.run(command, { file, ...args })) as AdhdState | null;
        setAdhd(res ?? {});
      } catch {
        /* best-effort — leave the UI as-is on a failed write */
      }
    },
    [file],
  );

  const removeKeyword = useCallback(
    (kw: string) => void runAdhd('adhd.removeKeyword', { keyword: kw }),
    [runAdhd],
  );

  // Right-click a selected word → add/remove it as a highlight keyword (the
  // spec's keyword gesture: select a word, choose from the context menu). The
  // listener lives on the editor body and only acts on a non-empty selection, so
  // an empty-selection right-click still gets the default menu. Matching is
  // case-insensitive: a selection that equals an existing keyword offers REMOVE
  // (using the stored casing), otherwise ADD.
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
              run: () => void runAdhd('adhd.addKeyword', { keyword: selected }),
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
              void window.bh.clipboardReadText().then((t) => {
                if (t) view.dispatch(view.state.tr.insertText(t));
                view.focus();
              }),
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
  }, [editor, keywords, removeKeyword, runAdhd]);

  // Toggle one top-level block's read state — the spec's per-block checkbox click.
  // The block's id resolves to its canonical SOURCE line span (so the agent reads
  // the same ranges back); read state is also tracked by id for the in-session dim.
  const toggleBlockRead = useCallback(
    (blockId: string) => {
      const blocks = editor.document;
      const span = blockSourceSpan(blocks, blockId, shared.byId, countNewlines(shared.frontmatter));
      if (!span) return;
      const isRead = readIds.has(blockId);
      void runAdhd(isRead ? 'adhd.markUnread' : 'adhd.markRead', {
        start: span.start,
        end: span.end,
      });
      setReadIds((prev) => {
        const next = new Set(prev);
        if (isRead) next.delete(blockId);
        else next.add(blockId);
        return next;
      });
    },
    [editor, shared, readIds, runAdhd],
  );

  // The left-gutter checkboxes are rendered by the decoration plugin (lib/
  // adhdHighlight) as widgets carrying `data-bh-block-id`. Handle their clicks by
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

  const markAll = useCallback(
    (read: boolean) => {
      // Whole-file span from the LIVE document, not shared.lastDisk: lastDisk lags
      // behind un-flushed edits (autosave is debounced), so using it would persist a
      // range that under-covers freshly-typed tail blocks — they'd come back unread on
      // reopen despite "All". The last block's source span end IS the file's last line.
      const blocks = editor.document;
      const last = blocks[blocks.length - 1];
      const span = last
        ? blockSourceSpan(blocks, last.id, shared.byId, countNewlines(shared.frontmatter))
        : null;
      const end = span ? span.end : countNewlines(shared.lastDisk) + 1;
      void runAdhd(read ? 'adhd.markRead' : 'adhd.markUnread', { start: 1, end });
      setReadIds(read ? new Set(blocks.map((b) => b.id)) : new Set());
    },
    [editor, shared, runAdhd],
  );

  // "Read N/M" — M = top-level block count, N = read blocks still present. Computed
  // inline every render (NOT memoized on editor/readIds, which are stable refs that
  // don't change on a doc edit) and kept live by the editor.onChange tick above, so a
  // deleted read block drops out of N and a new block grows M. (The decoration set
  // self-heals separately — the plugin rebuilds on docChanged.)
  const blocks = editor.document;
  const total = blocks.length;
  let readCount = 0;
  for (const b of blocks) if (readIds.has(b.id)) readCount += 1;

  return (
    <div style={barStyle}>
      {/* Keywords: add/remove by right-clicking a selected word in the text (see the
          contextmenu handler above). The chips show what's active + offer removal. */}
      <span style={{ color: color.textTertiary }}>
        {keywords.length > 0
          ? 'Highlighting — right-click a word to add or remove'
          : 'Reading mode — right-click a word to highlight it'}
      </span>
      {keywords.map((kw) => (
        <span key={kw} style={chipStyle}>
          {kw}
          <button
            type="button"
            aria-label={`Remove keyword ${kw}`}
            onClick={() => removeKeyword(kw)}
            style={chipCloseStyle}
          >
            ×
          </button>
        </span>
      ))}
      <span style={{ flex: 1 }} />
      {/* Read progress + whole-file shortcuts. Per-block marking is the gutter
          checkboxes; these cover the whole note at once. */}
      <span style={{ color: color.textTertiary }}>
        Read {readCount}/{total}
      </span>
      <button type="button" onClick={() => markAll(true)} style={toolButtonStyle}>
        All
      </button>
      <button type="button" onClick={() => markAll(false)} style={toolButtonStyle}>
        Clear
      </button>
    </div>
  );
};

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: space[2],
  padding: `${space[2]}px ${space[4]}px`,
  borderBottom: `1px solid ${color.divider}`,
  background: color.surfaceMuted,
  flexShrink: 0,
  fontFamily: font.sans,
  fontSize: font.size.caption,
};

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: space[1],
  padding: `2px ${space[2]}px`,
  borderRadius: radius.sm,
  background: color.warningSoft,
  color: color.warning,
};

const chipCloseStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: color.warning,
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  fontSize: font.size.caption,
};

const toolButtonStyle: CSSProperties = {
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.surface,
  color: color.textTertiary,
  cursor: 'pointer',
  padding: `2px ${space[2]}px`,
  fontFamily: font.sans,
  fontSize: font.size.caption,
};

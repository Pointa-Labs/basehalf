import { type CSSProperties, type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { color, font, radius, space } from '../design.js';
import type { LineRange } from '../lib/adhd.js';
import { type AdhdEditorApi, pushAdhdDecorations } from '../lib/adhdHighlight.js';
import {
  type FocusBlock,
  blockSourceSpan,
  countNewlines,
  linesToBlockIds,
  topLevelBlockOf,
} from '../lib/editorFocus.js';
import { isImeComposing } from '../lib/imeGuard.js';
import type { SharedDoc } from '../lib/liveDoc.js';

/**
 * ADHD reading-aids controls for the PANEL Markdown editor — keyword chips plus
 * read/unread marking. The sister surface to CodeReader's toolbar, but here read
 * state targets BlockNote BLOCKS: the highlight (a dimmed block, via decorations in
 * lib/adhdHighlight) is tracked by block id in-session, while persistence stays the
 * canonical SOURCE line-ranges in adhd.yaml. The two address spaces meet at this
 * seam: source lines → block ids on load (so an agent-written range shows up), and a
 * marked block → its source-line span on write (so the agent reads it back).
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
  const [draftKw, setDraftKw] = useState('');
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
  // whenever either changes. Meta-only dispatch → no document change → no autosave.
  useEffect(() => {
    if (!seedReady) return;
    pushAdhdDecorations(editor, { readBlockIds: [...readIds], keywords });
  }, [editor, seedReady, readIds, keywords]);

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

  const addKeyword = useCallback(() => {
    const kw = draftKw.trim();
    if (kw === '') return;
    setDraftKw('');
    void runAdhd('adhd.addKeyword', { keyword: kw });
  }, [draftKw, runAdhd]);

  const removeKeyword = useCallback(
    (kw: string) => void runAdhd('adhd.removeKeyword', { keyword: kw }),
    [runAdhd],
  );

  // The TOP-LEVEL blocks the user means right now: a multi-block selection, else the
  // single block the cursor sits in. Resolved to top level (and de-duped) so the
  // dimmed-block highlight and the persisted line span address the same units.
  const selectedTopLevel = useCallback((): FocusBlock[] => {
    const blocks = editor.document;
    const sel = editor.getSelection();
    const targets = sel?.blocks?.length ? sel.blocks : [editor.getTextCursorPosition().block];
    const out: FocusBlock[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
      const tl = topLevelBlockOf(blocks, t.id);
      if (tl && !seen.has(tl.block.id)) {
        seen.add(tl.block.id);
        out.push(tl.block);
      }
    }
    return out;
  }, [editor]);

  const markSelection = useCallback(
    (read: boolean) => {
      const blocks = editor.document;
      const frontmatterLines = countNewlines(shared.frontmatter);
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      const ids: string[] = [];
      for (const b of selectedTopLevel()) {
        const span = blockSourceSpan(blocks, b.id, shared.byId, frontmatterLines);
        if (!span) continue;
        lo = Math.min(lo, span.start);
        hi = Math.max(hi, span.end);
        ids.push(b.id);
      }
      if (ids.length === 0 || lo > hi) return;
      void runAdhd(read ? 'adhd.markRead' : 'adhd.markUnread', { start: lo, end: hi });
      setReadIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (read) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [editor, shared, selectedTopLevel, runAdhd],
  );

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
      <span style={{ color: color.textTertiary }}>Highlight</span>
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
      <input
        value={draftKw}
        onChange={(e) => setDraftKw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isImeComposing(e)) {
            e.preventDefault();
            addKeyword();
          }
        }}
        placeholder="Add keyword…"
        style={inputStyle}
      />
      <span style={{ flex: 1 }} />
      <span style={{ color: color.textTertiary }}>
        Read {readCount}/{total}
      </span>
      <button
        type="button"
        title="Mark the selected blocks (or the block at the cursor) read"
        onClick={() => markSelection(true)}
        style={toolButtonStyle}
      >
        Mark read
      </button>
      <button
        type="button"
        title="Mark the selected blocks (or the block at the cursor) unread"
        onClick={() => markSelection(false)}
        style={toolButtonStyle}
      >
        Mark unread
      </button>
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

const inputStyle: CSSProperties = {
  flex: '0 1 140px',
  minWidth: 90,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.surface,
  color: color.textPrimary,
  padding: `2px ${space[2]}px`,
  fontFamily: font.sans,
  fontSize: font.size.caption,
  outline: 'none',
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

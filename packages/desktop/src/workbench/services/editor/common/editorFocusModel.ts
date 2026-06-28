/**
 * Map a BlockNote block back to its line in the .md SOURCE — the bridge that lets
 * the rich editor emit the spec's `focus.cursor` / `focus.visible_lines`.
 *
 * BlockNote is block-organized and has no source-line mapping of its own. But the
 * save machinery (see lib/mdSegment) already keeps `byId`: each editable block's
 * id → its verbatim source tile (`raw` = prefix + source + sep). Walking the LIVE
 * block order and summing those tiles' newlines reconstructs the byte offset — and
 * therefore the line — of any block, with no re-parse and no document mutation:
 *
 *   line(block) = frontmatterLines
 *               + Σ newlines(tile) for every block BEFORE it
 *               + newlines(its own leading whitespace)
 *               + 1
 *
 * This matches the load-time source line exactly for an unedited document and stays
 * live-accurate when blocks are added or removed. The one soft spot: a block the
 * user TYPED this session has no tile yet, so its newline count is estimated from
 * the separator the splice-save would synthesize (its inner line breaks are unknown
 * and assumed 0) — a few lines of drift below such a block until the next load
 * rebuilds the index. Acceptable: focus is a best-effort attention signal, and the
 * live fields are optional in the spec.
 */
import { RAW_PASSTHROUGH, type ReuseEntry } from './mdSegment.js';

/** The minimal shape of a BlockNote block this module reads. `editor.document`
 *  returns only TOP-LEVEL blocks; deeper blocks (a sub-list item, a paragraph
 *  nested under a list item) live in `children`, so the cursor can land on an id
 *  that isn't at the top level — blockFileLine descends `children` to find it. */
export interface FocusBlock {
  readonly id: string;
  readonly type?: string;
  readonly props?: { readonly raw?: string };
  readonly children?: readonly FocusBlock[];
}

/** Count of '\n' in a string (CRLF still counts its '\n', so this equals the
 *  number of line breaks regardless of EOL style). */
export function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) === 10) n += 1;
  return n;
}

// Mirrors mdSegment.defaultSep: a brand-new list item is tight (one newline), any
// other new block is blank-line separated (two). Used only for blocks with no tile.
const LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);

/** Newlines a block contributes to the body source when it sits BEFORE the target.
 *  Indexed block (unchanged or edited) → its verbatim tile's newlines; read-only
 *  passthrough → its carried raw; brand-new block → the splice-save separator. */
function tileNewlines(block: FocusBlock, byId: Map<string, ReuseEntry>): number {
  if (block.type === RAW_PASSTHROUGH) return countNewlines(block.props?.raw ?? '');
  const entry = byId.get(block.id);
  if (entry) return countNewlines(entry.raw);
  return LIST_ITEM_TYPES.has(block.type ?? '') ? 1 : 2;
}

/** Is `targetId` this block or anywhere in its subtree? Lets a cursor that sits in
 *  a NESTED block resolve to its enclosing top-level block (whose tile spans the
 *  whole subtree, so its source line is the right coarse "where you are"). */
function subtreeHasId(block: FocusBlock, targetId: string): boolean {
  if (block.id === targetId) return true;
  if (!block.children) return false;
  for (const child of block.children) if (subtreeHasId(child, targetId)) return true;
  return false;
}

/** 1-based FILE line where `targetId`'s source begins, or null if the id isn't in
 *  the tree. A nested target resolves to its enclosing TOP-LEVEL block's line (the
 *  segment tiles only go one level deep, so deeper blocks share their ancestor's
 *  tile). Pure — see the module note for the formula and its drift bound. */
export function blockFileLine(
  blocks: readonly FocusBlock[],
  targetId: string,
  byId: Map<string, ReuseEntry>,
  frontmatterLines: number,
): number | null {
  let before = 0;
  for (const block of blocks) {
    if (subtreeHasId(block, targetId)) {
      // Skip the block's own LEADING whitespace: the source starts after the prefix.
      // Passthrough blocks don't carry a prefix and can't hold the cursor anyway.
      const entry = block.type === RAW_PASSTHROUGH ? undefined : byId.get(block.id);
      const prefixNewlines = entry ? countNewlines(entry.prefix) : 0;
      return frontmatterLines + before + prefixNewlines + 1;
    }
    before += tileNewlines(block, byId);
  }
  return null;
}

/** 1-based ordinal of `targetId` among ALL blocks in document order — depth-first,
 *  a parent counted before its children — i.e. the "Nth block the user sees",
 *  counting nested blocks the way the rendered editor enumerates them. This is the
 *  STABLE notion of "which row I'm on": one block is
 *  one rendered row regardless of soft-wrap, and blank-line separators / multi-line
 *  blocks (code fences, hard breaks) don't inflate it the way the source line does.
 *  null if the id isn't in the tree. Pure. */
export function blockOrdinal(blocks: readonly FocusBlock[], targetId: string): number | null {
  let seen = 0;
  const walk = (list: readonly FocusBlock[]): number | null => {
    for (const block of list) {
      seen += 1;
      if (block.id === targetId) return seen;
      if (block.children) {
        const found = walk(block.children);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(blocks);
}

export type LinePrecision = 'exact' | 'block_start' | 'estimated';

/** The TOP-LEVEL block whose subtree contains `targetId`, and whether `targetId`
 *  IS that block (`direct`) or one of its nested descendants. null if not found. */
export function topLevelBlockOf(
  blocks: readonly FocusBlock[],
  targetId: string,
): { block: FocusBlock; direct: boolean } | null {
  for (const block of blocks) {
    if (block.id === targetId) return { block, direct: true };
    if (block.children && subtreeHasId(block, targetId)) return { block, direct: false };
  }
  return null;
}

/** Source newlines inside a tile's node bytes (raw minus its leading prefix and
 *  trailing separator) — i.e. (block source line count − 1). 0 means the block is a
 *  single source line. */
export function tileSourceNewlines(entry: ReuseEntry): number {
  return countNewlines(entry.raw) - countNewlines(entry.prefix) - countNewlines(entry.sep);
}

/** Refine the cursor's source line and how trustworthy it is. `blockStart` is the
 *  block's first source line (from blockFileLine). The precision ladder:
 *   - no saved tile (freshly typed) → `estimated` (blockStart is a separator guess);
 *   - single-source-line block → `exact` (the cursor can only be on that one line);
 *   - fenced CODE block, cursor in it directly → `exact`, adding the in-fence line
 *     offset (`codeWithinOffset`, 0-based, past the opening ``` fence line);
 *   - any other multi-line block (multi-line paragraph, blockquote, nested cursor)
 *     → `block_start` (we can't map a rendered offset back to a source line). */
export function refineCursorLine(args: {
  blockStart: number;
  hasEntry: boolean;
  blockSourceNewlines: number;
  directHit: boolean;
  codeWithinOffset: number | null;
}): { line: number; precision: LinePrecision } {
  const { blockStart, hasEntry, blockSourceNewlines, directHit, codeWithinOffset } = args;
  if (!hasEntry) return { line: blockStart, precision: 'estimated' };
  if (blockSourceNewlines === 0) return { line: blockStart, precision: 'exact' };
  if (directHit && codeWithinOffset !== null) {
    return { line: blockStart + 1 + codeWithinOffset, precision: 'exact' };
  }
  return { line: blockStart, precision: 'block_start' };
}

/** The 1-based FILE source-line range `[start, end]` a block occupies, or null if
 *  the id isn't in the tree. `start` is {@link blockFileLine}; `end` adds the
 *  block's own source newlines (its top-level tile's span). A block with no saved
 *  tile (freshly typed, or a read-only passthrough) collapses to a single line
 *  `[start, start]` — best-effort, like blockFileLine's estimate. A nested id
 *  resolves to its enclosing top-level block's span (tiles go one level deep). Pure. */
export function blockSourceSpan(
  blocks: readonly FocusBlock[],
  targetId: string,
  byId: Map<string, ReuseEntry>,
  frontmatterLines: number,
): { start: number; end: number } | null {
  const start = blockFileLine(blocks, targetId, byId, frontmatterLines);
  if (start === null) return null;
  const tl = topLevelBlockOf(blocks, targetId);
  const entry = tl && tl.block.type !== RAW_PASSTHROUGH ? byId.get(tl.block.id) : undefined;
  return { start, end: entry ? start + tileSourceNewlines(entry) : start };
}

/** The source-line range to persist when a block is marked READ — {@link
 *  blockSourceSpan} extended FORWARD to swallow the blank-line separator(s) up to
 *  the next top-level block. Per the spec (§adhd: 空行的已读状态默认和上一行一致), a
 *  blank line inherits the read state of the line ABOVE it, so the separator belongs
 *  to the preceding block. `blockSourceSpan` ends a block on its last CONTENT line
 *  (tileSourceNewlines drops the trailing `sep`), so without this, marking two
 *  consecutive paragraphs read would leave the blank line between them outside every
 *  read range — a false "unread" island an agent reading adhd.yaml literally would
 *  see. (The in-editor dimming is unaffected: blank lines aren't blocks, so nothing
 *  renders for them; this is purely about what lands in read_paragraphs.) The two
 *  extended spans of adjacent read blocks become gap-adjacent, so the ADHD range
 *  normalizer coalesces them into one range. The LAST block has no following
 *  block to bound a gap, so it keeps its content-end (a trailing blank at EOF sits
 *  after the last paragraph, not between two, so it can't create a hole). A tight
 *  separator (one newline, e.g. list items with no blank line) yields nextStart−1 ==
 *  end, so nothing is absorbed. Pure. */
export function blockReadSpan(
  blocks: readonly FocusBlock[],
  targetId: string,
  byId: Map<string, ReuseEntry>,
  frontmatterLines: number,
): { start: number; end: number } | null {
  const span = blockSourceSpan(blocks, targetId, byId, frontmatterLines);
  if (span === null) return null;
  const tl = topLevelBlockOf(blocks, targetId);
  if (!tl) return span;
  const idx = blocks.findIndex((b) => b.id === tl.block.id);
  const next = idx >= 0 ? blocks[idx + 1] : undefined;
  if (!next) return span; // last block: nothing after to bound a separator gap
  const nextStart = blockFileLine(blocks, next.id, byId, frontmatterLines);
  if (nextStart === null) return span;
  // Lines (span.end, nextStart) are the blank/separator lines between the two
  // blocks; absorb them so the blank inherits this (above) block's read state.
  return { start: span.start, end: Math.max(span.end, nextStart - 1) };
}

/** Ids of every TOP-LEVEL block whose source-line span intersects any of `ranges`
 *  (canonical adhd `read_paragraphs`, 1-based inclusive). The inverse of
 *  read_paragraphs → blocks: used once, when a file opens, to seed the read-block
 *  highlight set. Thereafter the rich editor tracks read blocks by id (stable across
 *  edits) rather than re-projecting drifting line numbers. Single pass, mirroring
 *  blockFileLine's accumulation so the two agree. Pure. */
export function linesToBlockIds(
  blocks: readonly FocusBlock[],
  byId: Map<string, ReuseEntry>,
  frontmatterLines: number,
  ranges: readonly (readonly [number, number])[],
): string[] {
  if (ranges.length === 0) return [];
  const ids: string[] = [];
  let before = 0;
  for (const block of blocks) {
    const entry = block.type === RAW_PASSTHROUGH ? undefined : byId.get(block.id);
    const prefixNewlines = entry ? countNewlines(entry.prefix) : 0;
    const start = frontmatterLines + before + prefixNewlines + 1;
    const end = entry ? start + tileSourceNewlines(entry) : start;
    // Overlap test: [start,end] meets [s,e] when start ≤ e and end ≥ s.
    if (ranges.some(([s, e]) => start <= e && end >= s)) ids.push(block.id);
    before += tileNewlines(block, byId);
  }
  return ids;
}

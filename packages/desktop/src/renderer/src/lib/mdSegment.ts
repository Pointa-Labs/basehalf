/**
 * File-as-truth Markdown projection for the editor.
 *
 * The on-disk Markdown is the single source of truth; BlockNote is only an
 * editing surface. To honor that, a save must leave every byte the user did NOT
 * touch IDENTICAL — never a whole-document re-serialization (which is what
 * `blocksToMarkdownLossy(document)` did, normalizing the whole file and dropping
 * constructs BlockNote can't model).
 *
 * Mechanism — content-addressed verbatim reuse:
 *  1. `segmentBody` tiles the body into ordered top-level "segments" using a real
 *     positioned Markdown parser (mdast), descending one level into top-level
 *     lists so each list ITEM is its own segment (BlockNote treats list items as
 *     separate top-level blocks). Each segment carries `source` (the exact node
 *     bytes, for content-keying) and `raw` (the full source tile including the
 *     original surrounding whitespace) such that concatenating every `raw`
 *     reproduces the body byte-for-byte.
 *  2. `buildLoadProjection` parses each segment through BlockNote. A segment that
 *     BlockNote nukes to nothing (HTML comments, exotic raw HTML) becomes a
 *     read-only `rawPassthrough` block carrying its verbatim `raw`. A segment
 *     that yields exactly one block is indexed by its BlockNote-normalized form
 *     (`key → [raw…]`, FIFO, duplicate-aware).
 *  3. `spliceSave` walks the edited document; a block whose normalized form still
 *     matches an unconsumed segment key emits that segment's verbatim `raw`; an
 *     edited/new block emits its own (normalized) Markdown. Untouched content is
 *     therefore byte-identical; normalization is confined to blocks the user
 *     actually changed.
 *
 * FAIL-SAFE: every ambiguous path emits the block's own content. The system can
 * over-normalize (cosmetic) but cannot drop content — mdast covers 100% of the
 * body's bytes and an unmatched block always serializes itself.
 *
 * Known v1 limitation: a segment that BlockNote splits into MORE than one block
 * (e.g. a multi-paragraph blockquote) is not verbatim-indexed, so it normalizes
 * on the first edit elsewhere. No content is lost; this is strictly better than
 * the old whole-document normalization and is covered by tests.
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

/** Custom block type that carries a verbatim Markdown source tile BlockNote can't
 *  model. Defined here (not in blocknoteSchema) so this module stays free of any
 *  BlockNote import and `segmentBody` is unit-testable in a plain Node env. */
export const RAW_PASSTHROUGH = 'rawPassthrough';

export interface Segment {
  /** Exact node bytes (no surrounding whitespace) — used to compute the content key. */
  source: string;
  /** The full source tile: node bytes plus surrounding whitespace, so that
   *  concatenating every segment's `raw` reproduces the body verbatim. */
  raw: string;
}

/** Minimal structural view of the BlockNote editor we depend on. The real methods
 *  may be sync or async depending on version; awaiting both is safe. */
export interface MdEditorApi {
  tryParseMarkdownToBlocks(md: string): Promise<unknown[]> | unknown[];
  blocksToMarkdownLossy(blocks: unknown[]): Promise<string> | string;
}

export interface LoadProjection {
  /** PartialBlock[] to hand to `editor.replaceBlocks` (typed loosely; the caller casts). */
  blocks: unknown[];
  /** Content key → verbatim source tiles, in document order (FIFO consumption). */
  segIndex: Map<string, string[]>;
}

interface Unit {
  start: number;
  end: number;
}

function offsetsOf(node: {
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}): {
  start: number;
  end: number;
} | null {
  const s = node.position?.start?.offset;
  const e = node.position?.end?.offset;
  return typeof s === 'number' && typeof e === 'number' ? { start: s, end: e } : null;
}

/** Ordered top-level units, descending one level into top-level lists so each
 *  list item aligns with a BlockNote top-level block. */
function collectUnits(body: string): Unit[] {
  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as { children?: Array<{ type: string; position?: unknown; children?: unknown[] }> };
  const units: Unit[] = [];
  for (const node of tree.children ?? []) {
    const np = offsetsOf(node as never);
    if (!np) continue;
    if (node.type === 'list' && Array.isArray(node.children) && node.children.length > 0) {
      let descended = false;
      for (const item of node.children) {
        const ip = offsetsOf(item as never);
        if (!ip) {
          descended = false;
          break;
        }
        units.push(ip);
        descended = true;
      }
      if (!descended) units.push(np); // an item lacked position → keep the whole list as one unit
    } else {
      units.push(np);
    }
  }
  return units;
}

export function segmentBody(body: string): Segment[] {
  if (body === '') return [];
  const units = collectUnits(body);
  if (units.length === 0) {
    // Whitespace-only / wholly unparseable body — preserve verbatim as one tile.
    return [{ source: body, raw: body }];
  }
  const segs: Segment[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u) continue;
    const next = units[i + 1];
    const tileStart = i === 0 ? 0 : u.start;
    const tileEnd = next ? next.start : body.length;
    segs.push({ source: body.slice(u.start, u.end), raw: body.slice(tileStart, tileEnd) });
  }
  return segs;
}

function isEmptyParagraph(b: { type?: string; content?: unknown }): boolean {
  if (!b || b.type !== 'paragraph') return false;
  const c = b.content;
  if (!Array.isArray(c) || c.length === 0) return true;
  return c.every(
    (n) =>
      (n as { type?: string; text?: string })?.type === 'text' &&
      ((n as { text?: string }).text ?? '') === '',
  );
}

/** A segment BlockNote can't model — it parses to nothing meaningful, so it would
 *  vanish on save unless we carry it verbatim. */
function isDropped(blocks: unknown[]): boolean {
  if (!blocks || blocks.length === 0) return true;
  return blocks.every((b) => isEmptyParagraph(b as { type?: string; content?: unknown }));
}

async function normalize(editor: MdEditorApi, blocks: unknown[]): Promise<string> {
  return (await editor.blocksToMarkdownLossy(blocks)).trimEnd();
}

function pushIndex(index: Map<string, string[]>, key: string, raw: string): void {
  const bucket = index.get(key);
  if (bucket) bucket.push(raw);
  else index.set(key, [raw]);
}

/** Parse a body into editor blocks + the verbatim-reuse index. Does NOT touch the
 *  editor document (the caller does `replaceBlocks`). Safe to call again after a
 *  save to refresh the index against the new on-disk truth. */
export async function buildLoadProjection(
  editor: MdEditorApi,
  body: string,
): Promise<LoadProjection> {
  const segs = segmentBody(body);
  const blocks: unknown[] = [];
  const segIndex = new Map<string, string[]>();
  for (const seg of segs) {
    let parsed: unknown[] = [];
    try {
      parsed = await editor.tryParseMarkdownToBlocks(seg.source);
    } catch {
      parsed = [];
    }
    if (isDropped(parsed)) {
      blocks.push({ type: RAW_PASSTHROUGH, props: { raw: seg.raw, source: seg.source } });
      continue;
    }
    // Only single-block segments are verbatim-indexed (per-block save matching).
    // Multi-block segments are kept (no loss) but will normalize on edit.
    if (parsed.length === 1) {
      pushIndex(segIndex, await normalize(editor, parsed), seg.raw);
    }
    for (const b of parsed) blocks.push(b);
  }
  return { blocks, segIndex };
}

interface Piece {
  verbatim: boolean;
  text: string;
}

function joinPieces(pieces: Piece[]): string {
  let out = '';
  let lastFresh = false;
  for (const p of pieces) {
    if (p.verbatim) {
      out += p.text;
      lastFresh = false;
      continue;
    }
    if (out.length > 0 && !out.endsWith('\n\n')) {
      out += out.endsWith('\n') ? '\n' : '\n\n';
    }
    out += p.text;
    out += '\n\n';
    lastFresh = true;
  }
  // A verbatim-terminated document keeps its exact original trailing bytes. Only
  // when a fresh (edited/new) block ended the document do we normalize the tail
  // to a single newline.
  if (lastFresh) out = out.replace(/\n+$/, '\n');
  return out;
}

/** Serialize the edited document back to Markdown, reusing verbatim source for
 *  every block the user didn't change. `segIndex` is cloned, not mutated. */
export async function spliceSave(
  editor: MdEditorApi,
  document: unknown[],
  frontmatter: string,
  segIndex: Map<string, string[]>,
): Promise<string> {
  const pool = new Map<string, string[]>();
  for (const [k, v] of segIndex) pool.set(k, [...v]);

  const pieces: Piece[] = [];
  for (const block of document) {
    const b = block as { type?: string; props?: { raw?: string } };
    if (b.type === RAW_PASSTHROUGH) {
      pieces.push({ verbatim: true, text: b.props?.raw ?? '' });
      continue;
    }
    const cur = await normalize(editor, [block]);
    const bucket = pool.get(cur);
    if (bucket && bucket.length > 0) {
      pieces.push({ verbatim: true, text: bucket.shift() as string });
    } else {
      pieces.push({
        verbatim: false,
        text: (await editor.blocksToMarkdownLossy([block])).trimEnd(),
      });
    }
  }
  return frontmatter + joinPieces(pieces);
}

/**
 * File-as-truth Markdown projection for the editor.
 *
 * The on-disk Markdown is the single source of truth; BlockNote is only an
 * editing surface. To honor that, a save must leave every byte the user did NOT
 * touch IDENTICAL — never a whole-document re-serialization (which is what
 * `blocksToMarkdownLossy(document)` did, normalizing the whole file and dropping
 * constructs BlockNote can't model).
 *
 * Mechanism — identity-addressed verbatim reuse:
 *  1. `segmentBody` tiles the body into ordered top-level "segments" using a real
 *     positioned Markdown parser (mdast), descending one level into top-level
 *     lists so each list ITEM is its own segment (BlockNote treats list items as
 *     separate top-level blocks). Each segment carries `source` (the exact node
 *     bytes, for content-keying) and `raw` (the full source tile including the
 *     original surrounding whitespace) such that concatenating every `raw`
 *     reproduces the body byte-for-byte.
 *  2. `buildLoadProjection` parses each segment through BlockNote. A segment whose
 *     round-trip would DROP content — nuked to nothing (a standalone HTML comment)
 *     OR partially stripped (an inline comment / raw tag inside a paragraph) —
 *     becomes a read-only `rawPassthrough` block carrying its verbatim `raw`, so
 *     editing can't silently delete it. A cleanly round-tripping single-block
 *     segment is recorded in `byId` keyed by that block's stable id → its
 *     normalized form + verbatim tile.
 *  3. `spliceSave` walks the edited document; each block emits ITSELF plus its
 *     own trailing separator, so concatenation alone rebuilds the document.
 *     Unchanged block → its verbatim tile; edited block → its new Markdown wrapped
 *     in its ORIGINAL surrounding whitespace (so editing one item of a tight list
 *     can't turn it loose); new block → its Markdown + a type-appropriate
 *     separator. Untouched content is byte-identical; normalization is confined to
 *     blocks the user actually changed.
 *
 * Why identity, not content: BlockNote preserves a block's id across edits and
 * through `replaceBlocks`, so keying by id (not by content) means two
 * byte-identical-but-differently-spaced paragraphs each map to their OWN tile —
 * editing one can never rewrite the other's surrounding bytes.
 *
 * FAIL-SAFE: every ambiguous path emits the block's own content. The system can
 * over-normalize (cosmetic) but cannot drop content — mdast covers 100% of the
 * body's bytes and an unmatched block always serializes itself.
 *
 * Known v1 limitation: a segment that BlockNote splits into MORE than one block
 * (e.g. a multi-paragraph blockquote) is not id-indexed, so it normalizes on the
 * first edit elsewhere. No content is lost; this is strictly better than the old
 * whole-document normalization and is covered by tests.
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
  /** The full source tile (`prefix + source + sep`) — concatenating every
   *  segment's `raw` reproduces the body verbatim. */
  raw: string;
  /** Leading whitespace owned by this tile (only the first segment carries the
   *  document's leading gap; otherwise ''). */
  prefix: string;
  /** Trailing whitespace after the node up to the next segment — the EXACT
   *  separator to its neighbour. Reused verbatim even when the node is edited,
   *  so a localized edit can't turn a tight list loose or change spacing. */
  sep: string;
}

/** Minimal structural view of the BlockNote editor we depend on. The real methods
 *  may be sync or async depending on version; awaiting both is safe. */
export interface MdEditorApi {
  tryParseMarkdownToBlocks(md: string): Promise<unknown[]> | unknown[];
  blocksToMarkdownLossy(blocks: unknown[]): Promise<string> | string;
}

/** A reusable source tile keyed by the block that owns it: `key` is the block's
 *  BlockNote-normalized Markdown at load (to detect later edits), `raw` is the
 *  verbatim tile to re-emit while the block is unchanged, and `prefix`/`sep` are
 *  its exact original surrounding whitespace — reused even when the node is
 *  edited so an edit keeps the original separators (no tight→loose list churn). */
export interface ReuseEntry {
  key: string;
  raw: string;
  prefix: string;
  sep: string;
  /** True for the synthetic entries of a MULTI-block segment (a span BlockNote
   *  splits into several blocks, e.g. a multi-paragraph blockquote). These carry
   *  the segment's source newlines so line-projection (lib/editorFocus) accumulates
   *  exactly, but they are NOT verbatim single-block tiles: spliceSave must ignore
   *  them and re-serialize the block (its current behavior for such segments). */
  multi?: boolean;
}

export interface LoadProjection {
  /** PartialBlock[] to hand to `editor.replaceBlocks` (typed loosely; the caller casts). */
  blocks: unknown[];
  /** Live block id → its verbatim source tile, for identity-addressed reuse. */
  byId: Map<string, ReuseEntry>;
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
    return [{ source: body, raw: body, prefix: '', sep: '' }];
  }
  const segs: Segment[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u) continue;
    const next = units[i + 1];
    const tileStart = i === 0 ? 0 : u.start;
    const tileEnd = next ? next.start : body.length;
    segs.push({
      source: body.slice(u.start, u.end),
      raw: body.slice(tileStart, tileEnd),
      prefix: body.slice(tileStart, u.start), // doc leading gap (first segment only)
      sep: body.slice(u.end, tileEnd), // exact separator to the next segment
    });
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

/** Runs of letters/digits — the document's CONTENT, ignoring markup/whitespace.
 *  `\p{L}\p{N}` covers CJK etc., not just ASCII. */
export function contentTokens(md: string): string {
  return (md.match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

/** HTML comments verbatim. Compared separately because a SYMBOL-only comment
 *  (`<!-- !!! -->`) carries no letter/digit tokens, so the token check alone
 *  wouldn't notice BlockNote dropping it. */
function htmlComments(md: string): string {
  return (md.match(/<!--[\s\S]*?-->/g) ?? []).join(' ');
}

/** True when BlockNote's round-trip of a segment DROPS content (not just reflows
 *  formatting) — e.g. an inline HTML comment or raw tag inside an otherwise
 *  editable paragraph. `parsed.length === 1` doesn't catch these (the paragraph
 *  survives), so we compare content tokens AND HTML comments: if either differs,
 *  editing the block would silently delete the construct, so it stays read-only. */
export function losesContent(source: string, normalized: string): boolean {
  return (
    contentTokens(source) !== contentTokens(normalized) ||
    htmlComments(source) !== htmlComments(normalized)
  );
}

async function normalize(editor: MdEditorApi, blocks: unknown[]): Promise<string> {
  return (await editor.blocksToMarkdownLossy(blocks)).trimEnd();
}

function idOf(block: unknown): string | undefined {
  const id = (block as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/** bh's own bookkeeping marker — an HTML comment of the form `<!-- bh:… -->`
 *  (e.g. the workspace-hint marker bh writes into a hint file). It must survive
 *  a save byte-for-byte, but it's our plumbing, not the user's content, so the
 *  editor keeps it invisible rather than surfacing it as a block. */
function isOwnMarker(source: string): boolean {
  return /^\s*<!--\s*bh:/.test(source);
}

/** A read-only passthrough block carrying a span verbatim: hidden when it's bh's
 *  own marker, shown quietly when it's the user's content. */
function passthroughBlock(seg: Segment): unknown {
  return {
    type: RAW_PASSTHROUGH,
    props: { raw: seg.raw, source: seg.source, hidden: isOwnMarker(seg.source) },
  };
}

/** Parse a body into editor blocks + the identity-addressed reuse index. The
 *  blocks carry the ids that `replaceBlocks` will preserve, so `byId` stays valid
 *  for the live document across edits. Does NOT touch the editor document. */
export async function buildLoadProjection(
  editor: MdEditorApi,
  body: string,
): Promise<LoadProjection> {
  const segs = segmentBody(body);
  const blocks: unknown[] = [];
  const byId = new Map<string, ReuseEntry>();
  for (const seg of segs) {
    let parsed: unknown[] = [];
    try {
      parsed = await editor.tryParseMarkdownToBlocks(seg.source);
    } catch {
      parsed = [];
    }
    if (isDropped(parsed)) {
      // BlockNote can't model this span at all (HTML comment / exotic raw HTML).
      blocks.push(passthroughBlock(seg));
      continue;
    }
    const norm = await normalize(editor, parsed);
    if (losesContent(seg.source, norm)) {
      // The span parses to a real block but BlockNote DROPS part of it (e.g. an
      // inline HTML comment in a paragraph). Editing it would silently delete the
      // construct, so keep the whole span read-only verbatim rather than lossy.
      blocks.push(passthroughBlock(seg));
      continue;
    }
    if (parsed.length === 1) {
      // Single-block segment → a verbatim tile keyed by its stable block id.
      const id = idOf(parsed[0]);
      if (id) byId.set(id, { key: norm, raw: seg.raw, prefix: seg.prefix, sep: seg.sep });
    } else {
      // Multi-block segment (e.g. a multi-paragraph blockquote): BlockNote splits it
      // into several blocks. They reflow on edit but (having passed the loss check)
      // never drop content. We still record `multi` tiles so line-projection
      // accumulates the segment's EXACT source newlines (else every following block's
      // source line drifts). The whole segment's bytes sit on the LAST block; earlier
      // blocks are weightless. That way all the segment's blocks project to its start
      // (the last one spans its body) and the newline total lands AFTER them — so the
      // following block's line is exact and no interior block collides with it.
      // spliceSave ignores `multi` entries and re-serializes (its existing behavior for
      // such segments), so the save stays byte-for-byte the same.
      parsed.forEach((b, i) => {
        const id = idOf(b);
        if (!id) return;
        byId.set(
          id,
          i === parsed.length - 1
            ? { key: norm, raw: seg.raw, prefix: seg.prefix, sep: seg.sep, multi: true }
            : { key: norm, raw: '', prefix: '', sep: '', multi: true },
        );
      });
    }
    for (const b of parsed) blocks.push(b);
  }
  // Seed one empty paragraph when there's nothing the user can type into — an
  // empty/frontmatter-only body (no blocks) OR a raw-only note (all passthrough
  // blocks, which have `content: 'none'`). Without it such a note has no editable
  // cursor target. Saving stays gated on a real edit, so the seeded paragraph is
  // never written unless the user actually types into it.
  const hasEditable = blocks.some((b) => (b as { type?: string }).type !== RAW_PASSTHROUGH);
  if (!hasEditable) blocks.push({ type: 'paragraph' });
  return { blocks, byId };
}

const LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);

/** Default trailing separator for a brand-new block (no original tile to reuse):
 *  a single newline keeps list items tight; a blank line separates other blocks. */
function defaultSep(block: unknown): string {
  return LIST_ITEM_TYPES.has((block as { type?: string }).type ?? '') ? '\n' : '\n\n';
}

/** Serialize the edited document back to Markdown. Each block emits itself plus
 *  its OWN trailing separator, so concatenation alone reconstructs the document —
 *  no separators are synthesized between blocks:
 *   - unchanged block (id known, content matches) → its exact original tile;
 *   - edited block (id known, content changed) → original prefix + new Markdown +
 *     original separator, so spacing/list tightness is preserved around the edit;
 *   - new block (no id) → its Markdown + a type-appropriate default separator.
 *  Matching is by block id, so duplicate content can't cross-pollinate. `byId`
 *  is read, never mutated. */
export async function spliceSave(
  editor: MdEditorApi,
  document: unknown[],
  frontmatter: string,
  byId: Map<string, ReuseEntry>,
): Promise<string> {
  let out = '';
  let lastSynthesized = false;
  for (const block of document) {
    const b = block as { type?: string; props?: { raw?: string } };
    if (b.type === RAW_PASSTHROUGH) {
      out += b.props?.raw ?? '';
      lastSynthesized = false;
      continue;
    }
    const id = idOf(block);
    const found = id ? byId.get(id) : undefined;
    // A `multi` entry isn't a verbatim single-block tile (it only carries the
    // segment's newline accounting for line-projection); treat it as no tile so the
    // block re-serializes normally — the same path a multi-block segment took before
    // these entries existed, keeping the save byte-for-byte identical.
    const entry = found && !found.multi ? found : undefined;
    if (entry && (await normalize(editor, [block])) === entry.key) {
      // Unchanged → re-emit the exact original bytes (prefix + source + sep).
      out += entry.raw;
      lastSynthesized = false;
    } else {
      const fresh = (await editor.blocksToMarkdownLossy([block])).trimEnd();
      if (entry) {
        // Edited in place → keep the node's ORIGINAL surrounding whitespace.
        out += entry.prefix + fresh + entry.sep;
        lastSynthesized = false;
      } else {
        // Brand-new block → no original tile; pick a separator from its type.
        out += fresh + defaultSep(block);
        lastSynthesized = true;
      }
    }
  }
  // If the document ends on a brand-new block we picked the trailing whitespace
  // ourselves; normalize it to a single newline. A verbatim/edited tail keeps its
  // exact original trailing bytes.
  if (lastSynthesized) out = out.replace(/\n+$/, '\n');
  // Preserved frontmatter from a file whose closing `---` sat at EOF with NO
  // trailing newline (a supported shape agents emit) would otherwise glue the
  // body straight onto the fence (`---hello`), breaking the YAML block + losing
  // the user's metadata. Insert the file's prevailing EOL between a
  // non-newline-terminated frontmatter and a non-empty body.
  if (frontmatter !== '' && out !== '' && !/\n$/.test(frontmatter)) {
    const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n';
    return frontmatter + eol + out;
  }
  return frontmatter + out;
}

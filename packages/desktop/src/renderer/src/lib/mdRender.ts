import { BlockNoteEditor } from '@blocknote/core';

/**
 * Markdown → HTML conversion for read-only previews, using BlockNote itself —
 * so a previewed file renders with the *same* engine as the editor (no second
 * markdown flavor to drift from). This runs in the Electron renderer (Chromium
 * has a DOM); it would NOT work in the Node-side core, which is why rendering
 * lives here, not behind a `.bh` cache produced by core.
 *
 * One shared, off-screen converter instance serves every tile (mounting a real
 * editor per badge would be far too heavy). Conversions are serialized through
 * a promise chain so concurrent tile mounts can't interleave on the shared
 * instance.
 */

let converter: BlockNoteEditor | undefined;
function getConverter(): BlockNoteEditor {
  if (!converter) converter = BlockNoteEditor.create();
  return converter;
}

let chain: Promise<unknown> = Promise.resolve();
const CONVERT_TIMEOUT_MS = 3000;

export function markdownToHtml(md: string): Promise<string> {
  // Time-bound each conversion so one hung parse can't wedge the whole queue
  // (and every subsequent tile preview behind it). On timeout the caller falls
  // back to a raw excerpt; the chain advances either way.
  const step = Promise.race([
    chain.then(async () => {
      const editor = getConverter();
      const blocks = await editor.tryParseMarkdownToBlocks(md);
      return editor.blocksToHTMLLossy(blocks);
    }),
    new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('markdown render timeout')), CONVERT_TIMEOUT_MS);
    }),
  ]);
  // chain advances when `step` settles (≤ timeout), even if the conversion hung.
  chain = step.catch(() => undefined);
  return step;
}

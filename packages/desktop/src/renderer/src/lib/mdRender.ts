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

// Elements that have no place in a read-only note preview and could execute or
// exfiltrate if a Markdown file (e.g. one cloned from someone else's repo under
// a workspace) embedded raw HTML. blocksToHTMLLossy emits clean BlockNote HTML,
// but markdown can carry raw HTML through the parser, so we sanitize the output
// before it is ever set via innerHTML. Renderer-only (uses the DOM parser).
const DANGEROUS_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'LINK',
  'META',
  'BASE',
  'FORM',
  'INPUT',
  'BUTTON',
]);

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (DANGEROUS_TAGS.has(el.tagName)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      // Strip every inline event handler (onclick, onerror, …) and any
      // javascript:/data:text/html URL that could run script on click.
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (
        (name === 'href' || name === 'src' || name === 'xlink:href') &&
        (value.startsWith('javascript:') || value.startsWith('data:text/html'))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

export function markdownToHtml(md: string): Promise<string> {
  // Time-bound each conversion so one hung parse can't wedge the whole queue
  // (and every subsequent tile preview behind it). On timeout the caller falls
  // back to a raw excerpt; the chain advances either way.
  const step = Promise.race([
    chain.then(async () => {
      const editor = getConverter();
      const blocks = await editor.tryParseMarkdownToBlocks(md);
      return sanitizeHtml(await editor.blocksToHTMLLossy(blocks));
    }),
    new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('markdown render timeout')), CONVERT_TIMEOUT_MS);
    }),
  ]);
  // chain advances when `step` settles (≤ timeout), even if the conversion hung.
  chain = step.catch(() => undefined);
  return step;
}

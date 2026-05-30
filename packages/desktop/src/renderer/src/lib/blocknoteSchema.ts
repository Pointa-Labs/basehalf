/**
 * The single BlockNote schema used by the editor — default blocks plus one
 * custom, read-only `rawPassthrough` block.
 *
 * Why this exists: BlockNote's markdown round-trip (md → HTML → blocks and
 * back) is lossy by design and DROPS constructs it can't model — most visibly
 * HTML comments (`<!-- … -->`) and other raw-HTML that parses to ZERO blocks.
 * Under the file-as-truth model (see mdSegment.ts) every byte of the document
 * must survive a save, so a top-level source span that BlockNote nukes to
 * nothing is carried in a `rawPassthrough` block instead: it holds the exact
 * source bytes and the splice-save emits `props.raw` verbatim — never through
 * BlockNote's lossy exporter.
 *
 * Two presentations, set by `props.hidden`:
 *  - hidden=false → the user's own raw construct: shown QUIETLY (dim monospace
 *    source behind a thin rule, no badge/box) so it's visible and removable
 *    without shouting. We show the SOURCE, not a render — an HTML comment
 *    rendered to HTML is invisible, which would read as a blank, broken block.
 *  - hidden=true → bh's own marker (e.g. the workspace-hint comment): kept
 *    byte-for-byte but rendered invisibly, so our own bookkeeping never shows
 *    up as if it were the user's content.
 */
import { BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { color, font, space } from '../design.js';
import { RAW_PASSTHROUGH } from './mdSegment.js';

interface PassthroughProps {
  raw?: string;
  source?: string;
  hidden?: boolean;
}

/**
 * `raw` is the FULL source tile for this span (the node bytes plus the original
 * surrounding whitespace, per mdSegment's tiling) — it's what the save path
 * emits verbatim. `source` is the trimmed node text shown to the user. `hidden`
 * marks bh's own bookkeeping so it's preserved but not rendered.
 */
const rawPassthroughSpec = createBlockSpec(
  {
    type: RAW_PASSTHROUGH,
    propSchema: {
      raw: { default: '' },
      source: { default: '' },
      hidden: { default: false },
    },
    content: 'none',
  },
  {
    render: (block) => {
      const props = block.props as PassthroughProps;

      // bh's own marker — preserved on save, but never shown to the user.
      if (props.hidden) {
        const slot = document.createElement('span');
        slot.setAttribute('data-bh-raw-passthrough', 'hidden');
        slot.style.display = 'none';
        return { dom: slot };
      }

      // The user's own raw construct — kept verbatim, shown quietly.
      const text = (props.source ?? props.raw ?? '').replace(/^\n+|\n+$/g, '');
      const dom = document.createElement('div');
      dom.setAttribute('data-bh-raw-passthrough', '');
      dom.style.margin = `${space[1]}px 0`;
      dom.style.paddingLeft = `${space[2]}px`;
      dom.style.borderLeft = `2px solid ${color.divider}`;

      const pre = document.createElement('pre');
      pre.textContent = text;
      pre.style.margin = '0';
      pre.style.fontFamily = font.mono;
      pre.style.fontSize = `${font.size.caption}px`;
      pre.style.lineHeight = '1.5';
      pre.style.color = color.textTertiary;
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      dom.appendChild(pre);

      return { dom };
    },
    // Only used for BlockNote-internal exports (copy/paste). Our save path reads
    // props.raw directly and never routes a passthrough block through this.
    toExternalHTML: (block) => {
      const props = block.props as PassthroughProps;
      const pre = document.createElement('pre');
      pre.textContent = props.source ?? props.raw ?? '';
      return { dom: pre };
    },
  },
)();

export const bhSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    [RAW_PASSTHROUGH]: rawPassthroughSpec,
  },
});

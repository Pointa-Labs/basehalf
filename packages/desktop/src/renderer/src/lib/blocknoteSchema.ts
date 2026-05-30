/**
 * The single BlockNote schema used by the editor — default blocks plus one
 * custom, read-only `rawPassthrough` block.
 *
 * Why this exists: BlockNote's markdown round-trip (md → HTML → blocks and
 * back) is lossy by design and DROPS constructs it can't model — most visibly
 * HTML comments (`<!-- … -->`) and other raw-HTML that parses to ZERO blocks.
 * Under the file-as-truth model (see mdSegment.ts) every byte of the document
 * must survive a save, so a top-level source span that BlockNote nukes to
 * nothing is wrapped in a `rawPassthrough` block instead: it carries the exact
 * source bytes, renders them read-only, and the splice-save emits `props.raw`
 * verbatim — never through BlockNote's lossy exporter.
 *
 * The block shows the SOURCE (not a rendered preview) on purpose: an HTML
 * comment rendered to HTML is invisible, which would read as a blank, broken
 * block. Showing `<!-- bh:workspace-hint -->` as text is honest about what the
 * region is and that it's preserved verbatim.
 */
import { BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { color, font, radius, space } from '../design.js';
import { RAW_PASSTHROUGH } from './mdSegment.js';

/**
 * `raw` is the FULL source tile for this span (the node bytes plus the original
 * surrounding whitespace, per mdSegment's tiling) — it's what the save path
 * emits verbatim. `source` is the trimmed node text shown to the user.
 */
const rawPassthroughSpec = createBlockSpec(
  {
    type: RAW_PASSTHROUGH,
    propSchema: {
      raw: { default: '' },
      source: { default: '' },
    },
    content: 'none',
  },
  {
    render: (block) => {
      const props = block.props as { raw?: string; source?: string };
      const text = (props.source ?? props.raw ?? '').replace(/^\n+|\n+$/g, '');

      const dom = document.createElement('div');
      dom.setAttribute('data-bh-raw-passthrough', '');
      dom.style.position = 'relative';
      dom.style.margin = `${space[1]}px 0`;
      dom.style.padding = `${space[3]}px`;
      dom.style.paddingTop = `${space[4]}px`;
      dom.style.borderLeft = `2px solid ${color.border}`;
      dom.style.background = color.surfaceMuted;
      dom.style.borderRadius = `${radius.md}px`;

      const tag = document.createElement('span');
      tag.textContent = 'raw';
      tag.style.position = 'absolute';
      tag.style.top = `${space[1]}px`;
      tag.style.left = `${space[3]}px`;
      tag.style.fontFamily = font.sans;
      tag.style.fontSize = `${font.size.micro}px`;
      tag.style.letterSpacing = String(font.trackedCaps);
      tag.style.textTransform = 'uppercase';
      tag.style.color = color.textTertiary;
      dom.appendChild(tag);

      const pre = document.createElement('pre');
      pre.textContent = text;
      pre.style.margin = '0';
      pre.style.fontFamily = font.mono;
      pre.style.fontSize = `${font.size.caption}px`;
      pre.style.lineHeight = '1.5';
      pre.style.color = color.textSecondary;
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      dom.appendChild(pre);

      return { dom };
    },
    // Only used for BlockNote-internal exports (copy/paste). Our save path reads
    // props.raw directly and never routes a passthrough block through this.
    toExternalHTML: (block) => {
      const props = block.props as { raw?: string; source?: string };
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

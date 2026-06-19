/**
 * ADHD reading-aids highlight layer for the BlockNote Markdown editor.
 *
 * The core `adhd` module stores reading aids as .md SOURCE data — keyword strings
 * plus read line-ranges (see private-docs/focus_mode_spec). The read-only code/text
 * viewer (CodeReader) renders them directly because there a source line == a
 * rendered row 1:1. The rich editor has no such mapping, so this module projects the
 * same aids onto BlockNote BLOCKS *without touching the document*: a ProseMirror
 * decoration plugin paints read blocks (a node decoration) and keyword hits (an
 * inline decoration), purely presentationally. Decorations are view-only and never
 * serialized, so the file-as-truth invariant holds and the Yjs binding is untouched
 * — this is exactly why adhd could finally come to .md without a fork or a write-back.
 *
 * Targets flow in as block ids (read) + keyword strings via a meta transaction
 * dispatched straight on the EditorView — NOT `editor.transact`, whose generic-tr
 * gate can drop a meta-only transaction. A meta-only tr changes no content, so
 * BlockNote's onChange (autosave) never fires. On any document edit the plugin
 * rebuilds from the LAST payload against the new doc, so highlights track edits
 * (local or Yjs-remote) by block id.
 */
import { createExtension } from '@blocknote/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { keywordHits } from './adhd.js';
import type { FocusBlock } from './editorFocus.js';

/** The highlight targets: which TOP-LEVEL blocks are read, plus the keywords to
 *  highlight everywhere. Read state is addressed by block id (not line number) so a
 *  highlight stays on its block across edits — BlockNote keeps a block's id, and the
 *  source-line projection that derives these ids runs only when adhd changes. */
export interface AdhdDecoPayload {
  readonly readBlockIds: readonly string[];
  readonly keywords: readonly string[];
}

/** The minimal editor surface this layer reads (the real BlockNoteEditor satisfies
 *  it). Kept structural so callers pass the editor without a hard BlockNote type. */
export interface AdhdEditorApi {
  readonly document: readonly FocusBlock[];
  readonly prosemirrorView?: EditorView;
  getSelection(): { readonly blocks: readonly { readonly id: string }[] } | undefined;
  getTextCursorPosition(): { readonly block: { readonly id: string } };
  /** Subscribe to document changes; returns an unsubscribe fn. */
  onChange?(cb: () => void): (() => void) | undefined;
}

interface AdhdPluginState {
  readonly payload: AdhdDecoPayload;
  readonly decorations: DecorationSet;
}

const EMPTY_PAYLOAD: AdhdDecoPayload = { readBlockIds: [], keywords: [] };

export const adhdHighlightKey = new PluginKey<AdhdPluginState>('bhAdhdHighlight');

/** Build the decoration set for one doc + payload in a single `descendants` walk: a
 *  node decoration (CSS class) for every read block, and an inline decoration for
 *  every keyword hit inside a text node. Positions are document positions; for a text
 *  node at `pos`, char offset `i` sits at document pos `pos + i`.
 *
 *  A BlockNote block is a `blockContainer` node (it carries the `data-id`) whose
 *  content is `blockContent blockGroup?` — the optional `blockGroup` holds NESTED
 *  child blocks. Decorating the whole container would cascade the read-dim onto those
 *  (separately-tracked, possibly UNREAD) children, so we decorate only the container's
 *  first child (the blockContent — the block's OWN line), leaving nested blocks alone.
 *
 *  Perf note: this rebuilds on every doc-change transaction (see the plugin). It's
 *  O(doc) and runs on the typing hot path, but the common case is free — an
 *  aids-less note short-circuits below — and notes are small; a map-through +
 *  changed-range-only keyword recompute is a possible future optimization. */
function buildDecorations(doc: PmNode, payload: AdhdDecoPayload): DecorationSet {
  const { readBlockIds, keywords } = payload;
  if (readBlockIds.length === 0 && keywords.length === 0) return DecorationSet.empty;
  const readSet = new Set(readBlockIds);
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    const id = (node.attrs as { id?: string } | undefined)?.id;
    if (id && readSet.has(id) && node.firstChild) {
      // Decorate just the block's own content (firstChild = blockContent at pos+1),
      // not the container's subtree, so nested child blocks aren't dimmed.
      const innerStart = pos + 1;
      decos.push(
        Decoration.node(innerStart, innerStart + node.firstChild.nodeSize, {
          class: 'bh-adhd-read',
        }),
      );
    }
    if (node.isText && node.text && keywords.length > 0) {
      for (const [s, e] of keywordHits(node.text, keywords)) {
        decos.push(Decoration.inline(pos + s, pos + e, { class: 'bh-adhd-kw' }));
      }
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

function adhdHighlightPlugin(): Plugin<AdhdPluginState> {
  return new Plugin<AdhdPluginState>({
    key: adhdHighlightKey,
    state: {
      init: () => ({ payload: EMPTY_PAYLOAD, decorations: DecorationSet.empty }),
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(adhdHighlightKey) as AdhdDecoPayload | undefined;
        if (meta) {
          return { payload: meta, decorations: buildDecorations(newState.doc, meta) };
        }
        // An edit (local or Yjs-remote) moves blocks / text — rebuild from the last
        // payload against the new doc so node + keyword highlights follow along.
        if (tr.docChanged) {
          return {
            payload: value.payload,
            decorations: buildDecorations(newState.doc, value.payload),
          };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return adhdHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/** The BlockNote extension carrying the decoration plugin. Pass at editor create
 *  time (`extensions: [makeAdhdHighlightExtension()]`) — it is ADDITIVE to the
 *  built-in extensions. Harmless when no payload is pushed (empty decoration set),
 *  so it can be installed unconditionally and only fed in the panel editor. */
export function makeAdhdHighlightExtension() {
  return createExtension({
    key: 'bhAdhdHighlight',
    prosemirrorPlugins: [adhdHighlightPlugin()],
  });
}

/** Push new highlight targets into the live editor. Dispatched directly on the
 *  EditorView so a meta-only (no-doc-change) transaction reliably reaches the plugin
 *  without being dropped by `editor.transact`'s generic-tr gate, and without
 *  tripping onChange/autosave. No-op before the view exists. */
export function pushAdhdDecorations(
  editor: Pick<AdhdEditorApi, 'prosemirrorView'>,
  payload: AdhdDecoPayload,
): void {
  const view = editor.prosemirrorView;
  if (!view) return;
  view.dispatch(view.state.tr.setMeta(adhdHighlightKey, payload));
}

/**
 * ADHD reading-aids highlight layer for the BlockNote Markdown editor.
 *
 * The core `adhd` module stores reading aids as .md SOURCE data — keyword strings
 * plus read line-ranges (see private-docs/focus_mode_spec). Reading aids are a
 * Markdown-only surface, and the rich editor has no source-line→row mapping, so this
 * module projects the aids onto BlockNote BLOCKS *without touching the document*: a
 * ProseMirror decoration plugin paints a right-gutter read checkbox per top-level
 * block, dims read blocks (node decorations), and highlights keyword hits (inline
 * decorations), purely presentationally. Decorations are view-only and never
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
 *  source-line projection that derives these ids runs only when adhd changes.
 *
 *  `enabled` is reading mode: only then does the layer paint at all — the per-block
 *  read checkboxes appear, read blocks dim, keywords highlight. Off → nothing
 *  (a plain writing surface), which is also how an unmount clears the layer. */
export interface AdhdDecoPayload {
  readonly enabled: boolean;
  readonly readBlockIds: readonly string[];
  readonly keywords: readonly string[];
}

/** The minimal editor surface this layer reads (the real BlockNoteEditor satisfies
 *  it). Kept structural so callers pass the editor without a hard BlockNote type. */
export interface AdhdEditorApi {
  readonly document: readonly FocusBlock[];
  readonly prosemirrorView?: EditorView;
}

interface AdhdPluginState {
  readonly payload: AdhdDecoPayload;
  readonly decorations: DecorationSet;
}

const EMPTY_PAYLOAD: AdhdDecoPayload = { enabled: false, readBlockIds: [], keywords: [] };

/** A top-level block's read checkbox. The spec puts it on the LEFT, but the left
 *  margin is BlockNote's side menu (+ / drag handle), so we render it in the RIGHT
 *  gutter instead (CSS .bh-adhd-check) to avoid the collision. Carries the block id
 *  so the editor's delegated click handler (AdhdControls) knows which block to mark;
 *  purely a view widget, never document content. */
function renderCheckbox(id: string, read: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = read ? 'bh-adhd-check bh-adhd-check--on' : 'bh-adhd-check';
  el.setAttribute('data-bh-block-id', id);
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('role', 'checkbox');
  el.setAttribute('aria-checked', read ? 'true' : 'false');
  el.title = read ? 'Mark unread' : 'Mark read';
  return el;
}

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
  const { enabled, readBlockIds, keywords } = payload;
  if (!enabled) return DecorationSet.empty;
  const readSet = new Set(readBlockIds);
  const decos: Decoration[] = [];
  // Top-level blocks are the blockContainers directly under the doc's root
  // blockGroup — the unit the spec puts a read checkbox beside. Nested children
  // (inside a block's own blockGroup) get neither a checkbox nor the read-dim.
  const rootGroup = doc.firstChild;
  doc.descendants((node, pos, parent) => {
    const id = (node.attrs as { id?: string } | undefined)?.id;
    if (id && node.firstChild && parent === rootGroup) {
      const read = readSet.has(id);
      // The container gets position:relative + a reserved RIGHT gutter (CSS) so the
      // absolutely-placed checkbox anchors to the block's top-right without clipping
      // (right, not left, to clear BlockNote's left side menu).
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'bh-adhd-blk' }));
      decos.push(
        Decoration.widget(pos + 1, () => renderCheckbox(id, read), {
          side: -1,
          // Keying on read state forces the widget DOM to refresh when toggled.
          key: `bh-check-${id}-${read ? 1 : 0}`,
          ignoreSelection: true,
        }),
      );
    }
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
 *  tripping onChange/autosave. No-op before the view exists — or once it's gone:
 *  a clear-on-unmount (reading mode toggled off) can race the BlockNote view's
 *  own teardown, and dispatching on a destroyed view throws. Presentational
 *  push → swallow that. */
export function pushAdhdDecorations(
  editor: Pick<AdhdEditorApi, 'prosemirrorView'>,
  payload: AdhdDecoPayload,
): void {
  const view = editor.prosemirrorView;
  if (!view) return;
  try {
    view.dispatch(view.state.tr.setMeta(adhdHighlightKey, payload));
  } catch {
    /* view already destroyed (unmount race) — nothing to decorate */
  }
}

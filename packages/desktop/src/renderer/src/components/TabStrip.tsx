import { type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import type { LeafPane } from '../lib/paneTree.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FileGlyph, badgeType } from './FileGlyph.js';

const basenameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

// The DnD type marker for a tab drag. A CUSTOM type (not 'Files') so the
// App-level folder-drop overlay — which keys off the 'Files' type — ignores it.
// Shared with the pane DropOverlay so it can recognise a tab drag on dragover.
export const TAB_DND_TYPE = 'application/bh-tab';

/**
 * One pane's tab strip, modeled on a mature code editor's editor-group tabs:
 *  - opens on MOUSEDOWN (not click) for snappiness;
 *  - the PREVIEW tab is italic and gets replaced in place — double-click (or
 *    editing) pins it;
 *  - middle-click closes; the × shows on the active tab and on hover;
 *  - drag-to-reorder with a left/right insertion bar.
 * Scoped to `pane` (the leaf) — every action targets `pane.id`.
 */
export const TabStrip = ({ pane }: { pane: LeafPane }): JSX.Element => {
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const pinTab = useWorkspaceStore((s) => s.pinTab);
  const dropTabOnStrip = useWorkspaceStore((s) => s.dropTabOnStrip);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const setTabDrag = useWorkspaceStore((s) => s.setTabDrag);
  const newNote = useWorkspaceStore((s) => s.newNote);

  const paneId = pane.id;
  const [dropTarget, setDropTarget] = useState<{ index: number; side: 'left' | 'right' } | null>(
    null,
  );
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  // Whether ANY tab is being dragged (from this pane or another) — read off the
  // shared store so a tab from a different pane can drop onto this strip.
  const dragActive = (): boolean => useWorkspaceStore.getState().tabDrag !== null;

  const clearDrag = (): void => {
    setDropTarget(null);
    setTabDrag(null);
  };

  return (
    <div
      role="tablist"
      // Double-click the EMPTY strip area (not a tab) → a new blank note in this
      // pane, like a code editor's empty-tab-bar gesture. The target===currentTarget
      // guard keeps a double-click ON a tab (which pins it) from also firing this.
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) void newNote(paneId);
      }}
      // Accept a tab dropped on the strip's EMPTY area (past the last tab) →
      // append it to this pane. (Drops ON a tab are handled per-tab below; they
      // stopPropagation so they don't also bubble here.)
      onDragOver={(e) => {
        if (dragActive()) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.target === e.currentTarget && dragActive()) {
          e.preventDefault();
          dropTabOnStrip(paneId, pane.tabs.length);
          clearDrag();
        }
      }}
      title="Double-click for a new note"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        height: 36,
        borderBottom: `1px solid ${color.border}`,
        background: color.surfaceMuted,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {pane.tabs.map((file, index) => {
        const active = file === pane.activeFile;
        const isPreview = file === pane.previewFile;
        const showClose = active || hoveredFile === file;
        const indicate = dropTarget?.index === index ? dropTarget.side : null;
        return (
          <div
            key={file}
            role="tab"
            aria-selected={active}
            title={file}
            data-testid="editor-tab"
            data-active={active ? 'true' : 'false'}
            data-preview={isPreview ? 'true' : 'false'}
            draggable
            onMouseDown={(e) => {
              if (e.button === 0) {
                // Open on mousedown (not click) — activates the tab + focuses this
                // pane the instant the button goes down. A drag still reorders.
                openInPanel(file, { paneId });
              } else if (e.button === 1) {
                // Middle-click closes — preventDefault stops the autoscroll cursor.
                e.preventDefault();
                closeTab(paneId, file);
              }
            }}
            onDoubleClick={() => pinTab(paneId, file)}
            onMouseEnter={() => setHoveredFile(file)}
            onMouseLeave={() => setHoveredFile((f) => (f === file ? null : f))}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData(TAB_DND_TYPE, file);
              // Publish to the store so OTHER panes' strips + the pane DropOverlay
              // can pick up which tab + source pane on drop (cross-pane drag).
              setTabDrag({ file, sourcePaneId: paneId });
            }}
            onDragOver={(e) => {
              if (!dragActive()) return; // not a tab drag
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const side: 'left' | 'right' =
                e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
              setDropTarget((p) => (p?.index === index && p.side === side ? p : { index, side }));
            }}
            onDrop={(e) => {
              if (!dragActive()) return;
              e.preventDefault();
              e.stopPropagation(); // don't also fire the container's end-drop
              const target = e.currentTarget.getBoundingClientRect();
              const after = e.clientX - target.left >= target.width / 2;
              dropTabOnStrip(paneId, after ? index + 1 : index);
              clearDrag();
            }}
            onDragEnd={clearDrag}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: space[1.5],
              padding: `0 ${space[2]}px 0 ${space[3]}px`,
              maxWidth: 200,
              minWidth: 0,
              cursor: 'pointer',
              borderRight: `1px solid ${color.border}`,
              background: active ? color.surface : 'transparent',
              color: active ? color.textPrimary : color.textTertiary,
              fontFamily: font.sans,
              fontSize: font.size.caption,
              fontStyle: isPreview ? 'italic' : 'normal',
              // Accent top-rule on the active tab (the editor-group idiom).
              boxShadow: active ? `inset 0 2px 0 ${color.accent}` : 'none',
              transition: transition(['background', 'color']),
            }}
          >
            {/* Drag insertion bar on the indicated side. */}
            {indicate && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  [indicate]: -1,
                  width: 2,
                  background: color.accent,
                }}
              />
            )}
            <FileGlyph
              type={badgeType(basenameOf(file), false)}
              tone={active ? color.accent : color.textGhost}
              size={13}
            />
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {basenameOf(file)}
            </span>
            <button
              type="button"
              title="Close tab"
              aria-label={`Close ${basenameOf(file)}`}
              data-testid="editor-tab-close"
              // Stop the tab's mousedown (open/activate) from firing when hitting ×.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(paneId, file);
              }}
              style={{
                flexShrink: 0,
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                opacity: showClose ? 0.65 : 0,
                cursor: 'pointer',
                fontSize: 15,
                lineHeight: 1,
                padding: `0 ${space[0.5]}px`,
                borderRadius: radius.sm,
                transition: transition(['opacity']),
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = showClose ? '0.65' : '0';
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};

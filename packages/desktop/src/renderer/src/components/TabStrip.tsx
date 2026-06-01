import { type JSX, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FileGlyph, badgeType } from './FileGlyph.js';

const basenameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

// The DnD type marker for an in-strip tab drag. A CUSTOM type (not 'Files') so
// the App-level folder-drop overlay — which keys off the 'Files' type — ignores
// it.
const TAB_DND_TYPE = 'application/bh-tab';

/**
 * The right panel's tab strip, modeled on a mature code editor's editor-group
 * tabs:
 *  - opens on MOUSEDOWN (not click) for snappiness;
 *  - the PREVIEW tab is italic and gets replaced in place — double-click (or
 *    editing) pins it;
 *  - middle-click closes; the × shows on the active tab and on hover;
 *  - drag-to-reorder with a left/right insertion bar.
 * Horizontally scrollable when tabs overflow.
 */
export const TabStrip = (): JSX.Element => {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const currentFile = useWorkspaceStore((s) => s.currentFile);
  const previewFile = useWorkspaceStore((s) => s.previewFile);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const pinTab = useWorkspaceStore((s) => s.pinTab);
  const moveTab = useWorkspaceStore((s) => s.moveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  const draggedFile = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; side: 'left' | 'right' } | null>(
    null,
  );
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  const clearDrag = (): void => {
    draggedFile.current = null;
    setDropTarget(null);
  };

  return (
    <div
      role="tablist"
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
      {tabs.map((file, index) => {
        const active = file === currentFile;
        const isPreview = file === previewFile;
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
                // Open on mousedown (not click) — the editor activates the instant
                // the button goes down. A subsequent drag still reorders.
                openInPanel(file);
              } else if (e.button === 1) {
                // Middle-click closes — preventDefault stops the autoscroll cursor.
                e.preventDefault();
                closeTab(file);
              }
            }}
            onDoubleClick={() => pinTab(file)}
            onMouseEnter={() => setHoveredFile(file)}
            onMouseLeave={() => setHoveredFile((f) => (f === file ? null : f))}
            onDragStart={(e) => {
              draggedFile.current = file;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData(TAB_DND_TYPE, file);
            }}
            onDragOver={(e) => {
              if (draggedFile.current === null) return; // not an in-strip tab drag
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
              setDropTarget((p) => (p?.index === index && p.side === side ? p : { index, side }));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const dragged = draggedFile.current;
              if (dragged !== null) {
                const target = e.currentTarget.getBoundingClientRect();
                const after = e.clientX - target.left >= target.width / 2;
                moveTab(dragged, after ? index + 1 : index);
              }
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
                closeTab(file);
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

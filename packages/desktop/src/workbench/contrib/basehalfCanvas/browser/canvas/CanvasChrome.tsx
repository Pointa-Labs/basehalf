import type { JSX } from 'react';
import { FileGlyph } from '../../../../browser/labels/FileGlyph.js';
import { Breadcrumb } from '../../../../browser/parts/editor/Breadcrumb.js';
import {
  color,
  font,
  motion,
  radius,
  shadow,
  space,
  transition,
} from '../../../../browser/style/design.js';
import { Button } from '../../../../browser/ui/primitives/Button.js';

export const CanvasChrome = ({
  overlayOpen,
  sidebarInset,
  folderScope,
  error,
  truncated,
  onEditFolderPrompt,
  onNewNote,
}: {
  overlayOpen: boolean;
  sidebarInset: number;
  folderScope: string | null;
  error: string;
  truncated: number;
  onEditFolderPrompt: () => void;
  onNewNote: () => void;
}): JSX.Element => (
  <>
    {!overlayOpen && (
      <div
        style={{
          position: 'absolute',
          top: 52,
          right: space[3],
          zIndex: 8,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
        }}
      >
        <Button onClick={onNewNote} title="Create a new note here (⌘N)">
          New note
        </Button>
      </div>
    )}
    {!overlayOpen && (
      <div
        data-testid="canvas-breadcrumb"
        style={{ position: 'absolute', top: 0, left: sidebarInset, right: 0, zIndex: 8 }}
      >
        <Breadcrumb
          actions={
            <button
              type="button"
              data-testid="edit-folder-prompt"
              onClick={onEditFolderPrompt}
              title={
                folderScope
                  ? "Edit this folder's prompt (read as the intent when you add the folder to Agent Context)"
                  : 'Edit the workspace prompt (read as the intent when you add the workspace to Agent Context)'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: space[1],
                padding: `${space[0.5]}px ${space[1]}px`,
                fontSize: font.size.ui,
                fontFamily: font.sans,
                fontWeight: font.weight.medium,
                color: color.textTertiary,
                background: 'transparent',
                border: 'none',
                borderRadius: radius.sm,
                cursor: 'pointer',
                transition: transition(['color', 'background']),
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = color.textPrimary;
                e.currentTarget.style.background = color.divider;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = color.textTertiary;
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <FileGlyph type="edit" tone="currentColor" size={13} />
              Edit prompt
            </button>
          }
        />
      </div>
    )}
    {error && (
      <div
        style={{
          position: 'absolute',
          top: 56,
          right: space[3],
          background: color.surface,
          border: `1px solid ${color.danger}33`,
          padding: `${space[2]}px ${space[3]}px`,
          fontSize: font.size.caption,
          fontFamily: font.sans,
          color: color.danger,
          borderRadius: radius.md,
          boxShadow: shadow.raised,
          zIndex: 10,
          animation: `bh-banner-in ${motion.normal}`,
          maxWidth: 360,
        }}
      >
        {error}
      </div>
    )}
    {truncated > 0 && (
      <div
        style={{
          position: 'absolute',
          bottom: space[3],
          left: '50%',
          transform: 'translateX(-50%)',
          background: color.surface,
          border: `1px solid ${color.border}`,
          padding: `${space[1]}px ${space[3]}px`,
          fontSize: font.size.caption,
          fontFamily: font.sans,
          color: color.textTertiary,
          borderRadius: radius.pill,
          boxShadow: shadow.raised,
          zIndex: 10,
        }}
      >
        {truncated} more file{truncated === 1 ? '' : 's'} not shown — find them in the sidebar or ⌘K
      </div>
    )}
  </>
);

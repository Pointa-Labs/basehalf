import { type JSX, useState } from 'react';
import { FileGlyph, badgeType } from '../../../../browser/labels/FileGlyph.js';
import { useLayoutStore } from '../../../../browser/layout/layoutStore.js';
import { color, font, radius, space, transition } from '../../../../browser/style/design.js';
import { useWorkspaceStore } from '../../../../services/workspace/browser/workspaceStore.js';
import { DEFAULT_FILE_CARD_HEIGHT, DEFAULT_FILE_CARD_WIDTH } from '../badge-node/badgeNodeModel.js';

/**
 * The empty-canvas invitation: a dashed card SHAPED like the real file cards,
 * sitting where the first card would. It demonstrates the model instead of
 * describing it — click and it becomes a real `untitled.md` in the user's
 * folder (no filename dialog), open for typing.
 */
export const GhostNoteCard = ({ folderScope }: { folderScope: string | null }): JSX.Element => {
  const [hover, setHover] = useState(false);
  const where = folderScope ? `${folderScope}/` : 'your folder';
  // The sidebar FLOATS over the canvas's left edge, so "50% of the region"
  // can land partly underneath it (where its surface eats the click). Center
  // in the VISIBLE remainder instead — the same inset CanvasFramer applies
  // to fitView.
  const sidebarInset = useLayoutStore((s) => (s.sidebarOpen ? s.sidebarWidth : 0));
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: `calc(50% + ${sidebarInset / 2}px)`,
        transform: 'translate(-50%, -50%)',
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: space[3],
        // The column wrapper must not block canvas panning around the card;
        // the button itself re-enables hits.
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        data-testid="ghost-note-card"
        onClick={() => void useWorkspaceStore.getState().newNote({ folder: folderScope })}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Create a note — a real Markdown file, ready to type into"
        style={{
          width: DEFAULT_FILE_CARD_WIDTH,
          height: DEFAULT_FILE_CARD_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
          pointerEvents: 'auto',
          background: hover ? color.accentSofter : color.surface,
          border: `1.5px dashed ${hover ? color.accent : color.borderStrong}`,
          borderRadius: radius.lg,
          cursor: 'pointer',
          fontFamily: font.sans,
          color: hover ? color.accent : color.textPrimary,
          transition: transition(['background', 'border-color', 'color']),
        }}
      >
        <FileGlyph
          type={badgeType('untitled.md', false)}
          tone={hover ? color.accent : color.textTertiary}
          size={22}
        />
        <span style={{ fontSize: font.size.body, fontWeight: font.weight.medium }}>
          Write your first note
        </span>
        <span style={{ fontSize: font.size.caption, color: color.textTertiary }}>
          a real .md file in {where}
        </span>
      </button>
      <div
        style={{
          maxWidth: 340,
          textAlign: 'center',
          fontFamily: font.sans,
          fontSize: font.size.caption,
          color: color.textTertiary,
          lineHeight: 1.5,
        }}
      >
        …or drop files here — they're copied into {where}; the originals stay where they are.
      </div>
    </div>
  );
};

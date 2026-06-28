import type { BlockNoteEditor, CustomBlockNoteSchema } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import type { JSX } from 'react';
import { AdhdControls } from '../../../contrib/basehalfCanvas/browser/AdhdControls.js';
import { NoteBadge } from '../../../contrib/basehalfCanvas/browser/NoteBadge.js';
import { NoteTitle } from '../../../contrib/basehalfCanvas/browser/NoteTitle.js';
import type { AdhdEditorApi } from '../../../services/editor/browser/adhdHighlight.js';
import type { bhSchema } from '../../../services/editor/browser/blocknoteSchema.js';
import type { SharedDoc } from '../../../services/editor/browser/liveDoc.js';
import { space } from '../../style/design.js';

type BhEditor = typeof bhSchema extends CustomBlockNoteSchema<
  infer BSchema,
  infer ISchema,
  infer SSchema
>
  ? BlockNoteEditor<BSchema, ISchema, SSchema>
  : never;

interface BooleanRef {
  current: boolean;
}

export const MdEditorBody = ({
  compact,
  readingMode,
  file,
  paneId,
  editor,
  shared,
  seedReady,
  loadKey,
  viewOnly,
  compactEditable,
  initialLoad,
  isOwnerRef,
  pendingRef,
  scheduleSave,
}: {
  compact: boolean;
  readingMode: boolean;
  file: string;
  paneId: string;
  editor: BhEditor;
  shared: SharedDoc;
  seedReady: boolean;
  loadKey: number;
  viewOnly: boolean;
  compactEditable: boolean;
  initialLoad: BooleanRef;
  isOwnerRef: BooleanRef;
  pendingRef: BooleanRef;
  scheduleSave: () => void;
}): JSX.Element => (
  <>
    {!compact && readingMode && (
      <AdhdControls
        key={file}
        editor={editor as unknown as AdhdEditorApi}
        shared={shared}
        file={file}
        seedReady={seedReady}
        loadKey={loadKey}
      />
    )}
    <div className="bh-md-editor-scroll" style={{ flex: 1, overflow: 'auto' }}>
      <div
        style={{
          padding: compact
            ? `${space[2]}px ${space[3]}px ${space[3]}px`
            : `${space[10]}px ${space[5]}px ${space[8]}px`,
          ...(compact ? null : { maxWidth: 720, margin: '0 auto' }),
        }}
      >
        {!compact && <NoteTitle file={file} />}
        {!compact && <NoteBadge file={file} paneId={paneId} />}
        <BlockNoteView
          className={compact ? 'bh-card-editor' : undefined}
          editor={editor}
          autoFocus={compact && compactEditable}
          editable={!viewOnly && seedReady && compactEditable}
          formattingToolbar={compact ? false : undefined}
          linkToolbar={compact ? false : undefined}
          slashMenu={compact ? false : undefined}
          sideMenu={compact ? false : undefined}
          filePanel={compact ? false : undefined}
          tableHandles={compact ? false : undefined}
          emojiPicker={compact ? false : undefined}
          comments={compact ? false : undefined}
          theme="dark"
          onChange={() => {
            if (initialLoad.current || viewOnly || !seedReady) return;
            if (isOwnerRef.current) {
              pendingRef.current = true;
              scheduleSave();
            }
          }}
        />
      </div>
    </div>
  </>
);

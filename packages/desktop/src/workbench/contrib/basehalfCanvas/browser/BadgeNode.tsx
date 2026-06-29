import { type Node, type NodeProps, NodeResizer, useReactFlow, useStore } from '@xyflow/react';
import { type CSSProperties, type JSX, useCallback, useEffect, useState } from 'react';
import { FileGlyph, badgeType } from '../../../browser/labels/FileGlyph.js';
import { color, font, radius, shadow, space, transition } from '../../../browser/style/design.js';
import { InlineEditInput } from '../../../browser/ui/primitives/InlineEditInput.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { useGitStatusStore } from '../../scm/browser/gitStatusStore.js';
import {
  type GitDecoPalette,
  fileDecoration,
  statusTooltip,
} from '../../scm/common/gitStatusModel.js';
import { CardBadgeFace } from './CardBadgeFace.js';
import { CardTitleChip, FolderContents, KindChip } from './badge-node/BadgeCardParts.js';
import { BadgeDiffPreview, BadgePreview } from './badge-node/BadgePreviews.js';
import {
  type BadgeNodeData,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  DEFAULT_FILE_CARD_HEIGHT,
  DEFAULT_FOLDER_CARD_HEIGHT,
  countLabel,
  isPreviewableBadgeType,
  renameTargetForBadgeBasename,
  shouldShowCodeDiffPreview,
  splitBadgePath,
} from './badge-node/badgeNodeModel.js';
import { cardLodForHeight } from './badge-node/cardLod.js';
import { CanvasConnectionHandles, useCanvasConnectionHandles } from './canvasConnections/index.js';

// A badge is a *living tile*: when it's big enough on screen to read, it shows a
// real preview of the file's contents (rendered Markdown, a raw text/code
// excerpt, or an image thumbnail), so the canvas reads as "my documents in
// space," not a graph of names. A taller card reveals more of the same. Once the
// tile is too small ON SCREEN to read (shrunk by the user or zoomed out — see the
// size-aware LOD tiers below), it drops to just a name + glyph — no file read, no
// editor. This level-of-detail gate is what keeps a large, fully-framed workspace
// fast: at fit-to-all zoom EVERY tile is on screen, so viewport virtualization
// alone can't cull the per-tile preview work.

type BadgeFlowNode = Node<BadgeNodeData, 'badge'>;

// Canvas-card git-status colors (matches the file tree): added / untracked green,
// modified amber, deleted red, conflict red, renamed accent.
const CARD_GIT_PALETTE: GitDecoPalette = {
  added: color.success,
  modified: color.warning,
  deleted: color.danger,
  conflict: color.danger,
  renamed: color.accent,
  untracked: color.success,
};

export const BadgeNode = ({ id, data, selected }: NodeProps<BadgeFlowNode>): JSX.Element => {
  const d = data as unknown as BadgeNodeData;
  const isFolder = d.kind === 'folder';
  const orphan = d.orphan === true;
  const { basename, dirname } = splitBadgePath(d.label);
  const type = badgeType(d.label, isFolder);
  // git status for this card (a file, or an untracked dir reported as "label/").
  const gitDirect = useGitStatusStore((s) => s.byPath.get(d.label) ?? s.byPath.get(`${d.label}/`));
  // A folder card inherits a propagated mark when a descendant changed.
  const gitFolderAgg = useGitStatusStore((s) =>
    isFolder ? s.folderStatus.get(d.label) : undefined,
  );
  const gitFile = gitDirect ?? gitFolderAgg;
  const gitPropagated = gitDirect === undefined && gitFolderAgg !== undefined;
  const gitDeco = gitFile ? fileDecoration(gitFile, CARD_GIT_PALETTE) : null;
  // The in-card badge face's flush key. Synthetic (not a real pane) — the hook
  // registers a flusher under it AND flushes its debounced prompt edit on unmount,
  // so an in-card edit persists even though the badge face has no editor pane.
  const badgeFacePaneId = `canvas-badge:${d.label}`;

  const wsPath = useWorkspaceStore((s) => {
    const w = s.workspaces.find((ws) => ws.name === s.current);
    return w?.path ?? '';
  });
  const setCardEditing = useWorkspaceStore((s) => s.setCanvasCardEditing);
  // Inline rename: the card title becomes an input when this card is the entry
  // in rename mode (a context-menu Rename, or a just-created file/folder being
  // named). Shared signal so the sidebar + canvas use one affordance.
  const isRenaming = useWorkspaceStore((s) => s.renamingPath === id);
  const endRename = useWorkspaceStore((s) => s.endRename);
  const renameEntry = useWorkspaceStore((s) => s.renameEntry);
  const { setNodes: setFlowNodes } = useReactFlow<BadgeFlowNode>();
  // Size-aware level-of-detail: a card collapses to a name chip when it's too
  // small to read — either the user shrank it (intrinsic-height gate) or the
  // canvas is zoomed out past a single shared zoom threshold, at which point
  // EVERY card collapses together (no per-card popping). The WHEN-to-show-what
  // policy lives in badge-node/cardLod (pure + unit-tested); here we just feed it this
  // node's measured height and the canvas zoom. Selecting the tier STRING (not
  // raw px) means the store subscription re-renders the tile only when it crosses
  // the threshold, never on every zoom/resize delta (no flicker, no per-frame
  // preview churn) — and since the gate is now zoom-only, all tiles cross in the
  // same store update and re-render in one synchronized batch.
  const fallbackHeight = isFolder ? DEFAULT_FOLDER_CARD_HEIGHT : DEFAULT_FILE_CARD_HEIGHT;
  const sizeLod = useStore((s) => {
    const node = s.nodeLookup.get(id);
    const h = node?.measured?.height ?? node?.height ?? fallbackHeight;
    return cardLodForHeight(h, s.transform[2]);
  });
  // The card's flow-unit height, selected SEPARATELY (a number that changes only
  // on resize/measure, NOT on zoom) so it never forces a per-zoom re-render. It
  // feeds the mini chip's anti-overflow font cap; the live zoom itself is applied
  // purely in CSS via the --bh-zoom variable (set once per frame by the canvas).
  const cardHeightPx = useStore((s) => {
    const node = s.nodeLookup.get(id);
    return node?.measured?.height ?? node?.height ?? fallbackHeight;
  });
  const [nodeHover, setNodeHover] = useState(false);
  const [showBadgeFace, setShowBadgeFace] = useState(false);
  const connectionHandles = useCanvasConnectionHandles({ disabled: false, nodeId: id });
  // Always show a content preview for the types we can render cheaply
  // (text/markdown/code → excerpt, image → thumbnail). Orphans (missing file)
  // and folders have nothing to preview.
  const previewable = isPreviewableBadgeType(type);
  const showPreview = previewable && !orphan && !isFolder;
  // A changed CODE file shows its DIFF (red/green/±) in place of the plain
  // content — the canvas becomes a spatial "what changed" board (the multi-file
  // overview). Documents (Markdown / plain text) are read as RENDERED content, not
  // source lines, so a raw line-diff there is noise — they keep their normal
  // preview (the card's git tint still marks them changed). Images (a diff is
  // meaningless) and conflicts (a U on either side) also keep their normal preview.
  const showFileDiff = shouldShowCodeDiffPreview({
    previewable: showPreview,
    type,
    x: gitDirect?.x,
    y: gitDirect?.y,
  });
  // The badge face always forces full detail — you can't edit a collapsed chip.
  const lod = showBadgeFace ? 'full' : sizeLod;
  // The badge face (in-card prompt + refs + inbound + focus) replaces the body
  // when toggled on. Offered at full detail only (the mini chip has no room), and
  // not for an orphan folder (a missing folder has no contents to annotate).
  const canShowBadgeFace = lod === 'full' && !(isFolder && orphan);

  // Orphan = file referenced but missing on disk. We want the badge to read
  // as "placeholder" rather than "error": muted background + dashed danger
  // border + danger basename + MISSING chip. Three signals max, all
  // pointing the same way — not four overlapping ones.
  const baseBg = orphan ? color.surfaceMuted : isFolder ? color.folder : color.surface;
  const baseBorder = orphan ? color.danger : isFolder ? color.folderBorder : color.borderStrong;
  const borderStyle = orphan ? 'dashed' : 'solid';
  // Glyph tone: muted grey for files (calm on a busy canvas), warm for the
  // folder kind, danger when the target is missing.
  const glyphTone = orphan ? color.danger : isFolder ? color.folderGlyph : color.textTertiary;

  const tooltip = isFolder
    ? `${d.label} — click to select; double-click to enter this folder`
    : orphan
      ? `${d.label} — referenced but missing on disk`
      : `${d.label} — click to select; double-click to open the editor`;

  const boxShadow = shadow.card;
  const showChrome = selected || nodeHover;
  const showResizeControls = selected || nodeHover;

  // Tell the canvas this card's badge face is being edited so it suspends viewport
  // virtualization — otherwise a pan/zoom could cull this tile mid-edit and the
  // unmount would interrupt the open prompt edit. Cleared on toggle-off and on
  // unmount (idempotent in the store).
  useEffect(() => {
    setCardEditing(id, showBadgeFace || isRenaming);
    return () => setCardEditing(id, false);
  }, [id, showBadgeFace, isRenaming, setCardEditing]);

  const commitRename = useCallback(
    (name: string) => {
      endRename();
      const newRel = renameTargetForBadgeBasename(d.label, name);
      if (newRel === null) return;
      void renameEntry(d.label, newRel, d.kind);
    },
    [d.label, d.kind, endRename, renameEntry],
  );

  const selectThisNode = useCallback(() => {
    setFlowNodes((nodes) =>
      nodes.map((node) => {
        const shouldSelect = node.id === id;
        if (node.selected === shouldSelect) return node;
        return { ...node, selected: shouldSelect };
      }),
    );
  }, [id, setFlowNodes]);

  const stopNodeGesture = (event: { stopPropagation: () => void }): void => {
    event.stopPropagation();
  };

  // Two distinct visual states, kept separate because they mean different things:
  //   `pressed` = a real toggle is ON (the badge button when the face is open →
  //               filled accent bg, reads as "click again to release").
  //   `lit`     = a passive indicator (the badge button when a prompt exists →
  //               just stays visible + accent-toned glyph + dot, NO filled bg).
  // Sharing the filled-bg "pressed" look for `lit` made the badge button read as a
  // stuck toggle you couldn't un-press — it isn't a toggle, so it only lights up.
  const chromeButton = (pressed = false, lit = false): CSSProperties => ({
    position: 'relative',
    flexShrink: 0,
    width: 24,
    height: 24,
    padding: 0,
    border: `1px solid ${pressed ? color.accentSoft : showChrome ? color.borderStrong : 'transparent'}`,
    borderRadius: radius.md,
    background: pressed ? `${color.accent}1f` : 'transparent',
    color: pressed ? color.accent : color.textTertiary,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: showChrome || pressed || lit ? 1 : 0.56,
    pointerEvents: 'auto',
    transition: transition(['opacity', 'border-color', 'background', 'color']),
  });

  return (
    <div
      ref={connectionHandles.cardRef}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`canvas-card-${d.label}`}
      title={tooltip}
      onMouseEnter={() => setNodeHover(true)}
      onMouseLeave={() => setNodeHover(false)}
      onPointerMove={connectionHandles.onCardPointerMove}
      onPointerLeave={() => {
        setNodeHover(false);
        connectionHandles.onCardPointerLeave();
      }}
      style={{
        position: 'relative',
        background: baseBg,
        border: `1px ${borderStyle} ${baseBorder}`,
        borderRadius: radius.lg,
        width: '100%',
        height: '100%',
        minWidth: CARD_MIN_WIDTH,
        minHeight: CARD_MIN_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        fontFamily: font.sans,
        boxShadow,
        transition: transition(['box-shadow', 'border-color', 'background']),
        cursor: 'grab',
      }}
    >
      {gitDeco && gitFile && (
        <span
          aria-hidden
          title={gitPropagated ? 'This folder contains changes' : statusTooltip(gitFile)}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: gitDeco.color,
            border: `1.5px solid ${baseBg}`,
            zIndex: 3,
            pointerEvents: 'none',
          }}
        />
      )}
      <NodeResizer
        isVisible={showResizeControls}
        minWidth={CARD_MIN_WIDTH}
        minHeight={CARD_MIN_HEIGHT}
        lineClassName="bh-node-resize-line"
        handleClassName="bh-node-resize-handle"
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{
          width: 12,
          height: 12,
          opacity: 0,
          pointerEvents: 'all',
          background: 'transparent',
          border: '0 solid transparent',
        }}
      />
      <CanvasConnectionHandles
        connectionInProgress={connectionHandles.connectionInProgress}
        disabled={false}
        sourceAffordance={connectionHandles.sourceAffordance}
        targetAffordance={connectionHandles.targetAffordance}
        targetInteractive={connectionHandles.targetInteractive}
      />
      {/* Content clip. The card root stays overflow:visible so the resize /
          connection handles can sit OUTSIDE the border — so the actual content
          (header + body) needs its OWN hard clip. Without it, a short card zoomed
          into the 'full' tier paints its contents list past the bottom edge: a
          stray "shadow" of the first child bleeding onto the canvas. This wrapper
          fills the card and clips to the rounded border. */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: radius.lg,
        }}
      >
        {lod === 'mini' ? (
          // Collapsed to a centred glyph + name chip. No count, no contents, no
          // half-filled body — the count is shown only alongside the contents list,
          // which lives in the 'full' tier (see badge-node/cardLod).
          <CardTitleChip
            type={type}
            tone={glyphTone}
            name={basename}
            orphan={orphan}
            cardHeightPx={cardHeightPx}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              gap: space[2],
              alignItems: 'flex-start',
              padding: `${space[2]}px ${space[3]}px`,
              borderBottom:
                showPreview || (showBadgeFace && canShowBadgeFace)
                  ? `1px solid ${color.border}`
                  : 'none',
              minHeight: 42,
              flexShrink: 0,
            }}
          >
            {/* Fixed 20px box so the glyph optically centers against the
            basename's first line regardless of how many lines follow. */}
            <span
              aria-hidden
              style={{ display: 'flex', alignItems: 'center', height: 20, flexShrink: 0 }}
            >
              <FileGlyph type={type} tone={glyphTone} size={15} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[1.5] }}>
                {isRenaming ? (
                  <InlineEditInput
                    initialValue={basename}
                    onCommit={commitRename}
                    onCancel={endRename}
                    ariaLabel="New name"
                    testId="canvas-rename-input"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: font.weight.semibold,
                      fontSize: font.size.body,
                      color: color.textPrimary,
                      background: color.bg,
                      border: `1px solid ${color.accent}`,
                      borderRadius: radius.sm,
                      padding: `0 ${space[1]}px`,
                      outline: 'none',
                      letterSpacing: 0,
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontWeight: font.weight.semibold,
                      fontSize: font.size.body,
                      color: orphan ? color.danger : color.textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                      letterSpacing: 0,
                    }}
                  >
                    {basename}
                  </span>
                )}
                {isFolder && d.preview && (
                  <KindChip label={countLabel(d.preview.total)} tone="folder" />
                )}
                {/* Badge toggle: flips the card body between its content preview
                    and the in-card badge face (prompt + refs + inbound + focus).
                    Offered at full detail only (the mini chip has no room) — the
                    badge UI no longer opens a separate panel tab. Works for both
                    file and folder kinds; an orphan folder has no badge face. */}
                {canShowBadgeFace && (
                  <button
                    type="button"
                    className="nodrag nopan"
                    title={
                      showBadgeFace
                        ? 'Hide the badge — back to the preview'
                        : d.prompt && (d.notedRefs ?? 0) > 0
                          ? `Has a badge + ${d.notedRefs} explained connection${d.notedRefs === 1 ? '' : 's'} — edit it`
                          : d.prompt
                            ? 'Has a badge — edit it'
                            : 'Edit Badge'
                    }
                    aria-label={`${showBadgeFace ? 'Hide' : 'Show'} badge for ${d.label}`}
                    aria-pressed={showBadgeFace}
                    data-testid={`canvas-badge-toggle-${d.label}`}
                    onPointerDown={stopNodeGesture}
                    onMouseDown={stopNodeGesture}
                    onDoubleClick={stopNodeGesture}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectThisNode();
                      setShowBadgeFace((v) => !v);
                    }}
                    style={chromeButton(showBadgeFace, d.prompt !== undefined && d.prompt !== '')}
                  >
                    {/* "Has a note" is signalled by the accent-toned glyph (kept
                    visible at rest via `lit`). A file whose connections ALSO
                    carry notes — the fully-annotated state the brief benefits
                    from most — earns the small corner dot on top. */}
                    <FileGlyph
                      type="badge"
                      tone={
                        showBadgeFace ? color.accent : d.prompt ? color.accent : color.textTertiary
                      }
                      size={15}
                    />
                    {!showBadgeFace &&
                      d.prompt !== undefined &&
                      d.prompt !== '' &&
                      (d.notedRefs ?? 0) > 0 && (
                        <span
                          aria-hidden
                          data-testid={`badge-coverage-dot-${d.label}`}
                          style={{
                            position: 'absolute',
                            top: -2,
                            right: -2,
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: color.accent,
                            border: `1.5px solid ${baseBg}`,
                          }}
                        />
                      )}
                  </button>
                )}
                {orphan && <KindChip label="MISSING" tone="danger" />}
              </div>
              {dirname && (
                <div
                  style={{
                    fontSize: font.size.micro,
                    color: color.textTertiary,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: font.mono,
                    letterSpacing: 0,
                  }}
                >
                  {dirname}/
                </div>
              )}
            </div>
          </div>
        )}
        {/* Cards only DISPLAY: a content preview (markdown rendered to static HTML,
          a text/code excerpt, or an image thumbnail) or — via the badge toggle —
          the in-card badge face. Editing a file happens in the full-canvas editor
          overlay (double-click the card), never inside the tile, so no heavy live
          editor ever mounts per card. */}
        {lod === 'mini' ? null : showBadgeFace && canShowBadgeFace ? (
          <CardBadgeFace
            file={d.label}
            kind={isFolder ? 'folder' : 'file'}
            paneId={badgeFacePaneId}
          />
        ) : showPreview ? (
          showFileDiff ? (
            <BadgeDiffPreview type={type} label={d.label} wsPath={wsPath} />
          ) : (
            <BadgePreview type={type} label={d.label} wsPath={wsPath} />
          )
        ) : isFolder && !orphan && d.preview ? (
          <FolderContents preview={d.preview} prompt={d.prompt} />
        ) : (
          <div
            aria-hidden
            style={{
              flex: 1,
              minHeight: 0,
              padding: `${space[2]}px ${space[3]}px`,
              color: isFolder && d.prompt ? color.textSecondary : color.textGhost,
              fontSize: font.size.caption,
              lineHeight: 1.45,
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              // Fade a long folder note so the clip reads as "more below," not a hard cut.
              maskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
            }}
          >
            {/* A folder card shows its own note (the folder badge prompt) — an
              annotated folder reads as a labelled group on the canvas. An
              un-annotated folder stays clean (the glyph + name + path already
              say what it is). The old `dirname` body just duplicated the path
              subtitle above. */}
            {isFolder ? (d.prompt ?? '') : orphan ? 'Missing file' : ''}
          </div>
        )}
        {/* Annotation-coverage heat bar: what fraction of the files under this
            folder carry a note. A glanceable pull toward the act the brief
            depends on — full = accent, partial = amber, none = empty track.
            Full LOD only; at chip size the bar would be sub-pixel noise. */}
        {isFolder &&
          !orphan &&
          lod === 'full' &&
          d.coverage !== undefined &&
          d.coverage.total > 0 && (
            <div
              title={`${d.coverage.annotated} of ${d.coverage.total} files annotated`}
              data-testid={`folder-coverage-${d.label}`}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 3,
                background: color.border,
              }}
            >
              {d.coverage.annotated > 0 && (
                <div
                  style={{
                    width: `${Math.round((d.coverage.annotated / d.coverage.total) * 100)}%`,
                    height: '100%',
                    background:
                      d.coverage.annotated >= d.coverage.total ? color.accent : color.warning,
                    transition: transition(['width', 'background']),
                  }}
                />
              )}
            </div>
          )}
      </div>
    </div>
  );
};

import type { CanvasFolderPreview } from '@basehalf/core';
import { type Node, type NodeProps, NodeResizer, useReactFlow, useStore } from '@xyflow/react';
import { type CSSProperties, type JSX, useCallback, useEffect, useState } from 'react';
import { CanvasConnectionHandles, useCanvasConnectionHandles } from '../canvasConnections/index.js';
import { color, font, radius, shadow, space, transition } from '../design.js';
import {
  MINI_LABEL_CARD_HEIGHT_FRACTION,
  MINI_LABEL_MIN_FLOW_PX,
  MINI_LABEL_TARGET_SCREEN_PX,
  cardLodForHeight,
} from '../lib/cardLod.js';
import { fileUrl } from '../lib/fileUrl.js';
import { type GitDecoPalette, fileDecoration, statusTooltip } from '../lib/gitStatus.js';
import { markdownToHtml } from '../lib/mdRender.js';
import { useFileDiff } from '../lib/useFileDiff.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { CardBadgeFace } from './CardBadgeFace.js';
import { type BadgeType, FileGlyph, badgeType } from './FileGlyph.js';
import { UnifiedDiff } from './UnifiedDiff.js';
import { InlineEditInput } from './primitives/InlineEditInput.js';

// A badge is a *living tile*: when it's big enough on screen to read, it shows a
// real preview of the file's contents (rendered Markdown, a raw text/code
// excerpt, or an image thumbnail), so the canvas reads as "my documents in
// space," not a graph of names. A taller card reveals more of the same. Once the
// tile is too small ON SCREEN to read (shrunk by the user or zoomed out — see the
// size-aware LOD tiers below), it drops to just a name + glyph — no file read, no
// editor. This level-of-detail gate is what keeps a large, fully-framed workspace
// fast: at fit-to-all zoom EVERY tile is on screen, so viewport virtualization
// alone can't cull the per-tile preview work.

// Cache previews per path so a transient unmount (Canvas rebuilds nodes on file
// events) doesn't refetch/re-render. Staleness self-heals on the next refresh.
// Two caches: the raw file excerpt (text/code cards) and the rendered-Markdown
// HTML (.md cards). Markdown renders through the ONE shared off-screen converter
// (lib/mdRender) — a static, sanitized HTML string per tile, never a mounted
// editor (mounting one per card is what janked a large workspace).
type PreviewContent = { text: string };
const previewCache = new Map<string, PreviewContent>();
const mdHtmlCache = new Map<string, string>();
/** Drop all cached previews — call on workspace switch. The cache is keyed by
 *  workspace-relative path for within-workspace reuse, so a path that exists in
 *  two workspaces (e.g. README.md) would otherwise serve the wrong one's content
 *  after a switch. */
export function clearPreviewCache(): void {
  previewCache.clear();
  mdHtmlCache.clear();
}
// A tile reads (and renders) at most this many characters: enough that a taller
// card reveals more real content as you resize it, bounded so a multi-MB file
// neither crosses IPC whole nor blows up the Markdown parse.
const PREVIEW_CHARS = 8000;
// Cards can shrink all the way down to a title chip (glyph + name). The minimums
// are deliberately small so the size-aware LOD below (titleizes a card once it's
// tiny ON SCREEN) is actually reachable by resizing, not just by zooming out.
export const CARD_MIN_WIDTH = 140;
export const CARD_MIN_HEIGHT = 48;
export const DEFAULT_FILE_CARD_WIDTH = 300;
export const DEFAULT_FILE_CARD_HEIGHT = 220;
export const DEFAULT_FOLDER_CARD_WIDTH = 248;
// Tall enough to seat the header + a few contents rows (the folder card now
// previews what's inside) without the user having to resize it first.
export const DEFAULT_FOLDER_CARD_HEIGHT = 188;

// One shared file-event subscription fans out to all mounted tiles, instead of
// each tile registering its own ipcRenderer listener (which trips Node's
// MaxListeners warning past ~10 text badges and fans out O(N) per event).
type FileEvent = Parameters<Parameters<typeof window.bh.onFileEvent>[0]>[0];
const tileListeners = new Set<(e: FileEvent) => void>();
let tileHubUnsub: (() => void) | null = null;
function invalidatePreviewCache(label: string): void {
  previewCache.delete(label);
  mdHtmlCache.delete(label);
}

function invalidatePreviewCacheForEvent(event: FileEvent): void {
  if (event.type === 'change' || event.type === 'unlink') {
    invalidatePreviewCache(event.relPath);
    return;
  }
  if (event.type === 'rename') {
    invalidatePreviewCache(event.fromRelPath);
    invalidatePreviewCache(event.toRelPath);
  }
}

function subscribeTile(listener: (e: FileEvent) => void): () => void {
  if (!tileHubUnsub) {
    tileHubUnsub = window.bh.onFileEvent((event) => {
      invalidatePreviewCacheForEvent(event);
      for (const l of tileListeners) l(event);
    });
  }
  tileListeners.add(listener);
  return () => {
    tileListeners.delete(listener);
  };
}

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
  /** Folder kind only: a peek at the folder's direct contents (see listCanvas). */
  preview?: CanvasFolderPreview;
  /** File kind: how many outbound references carry a human-written note. With a
   *  prompt, distinguishes "fully annotated" (note + explained connections)
   *  from "prompt only" on the card's badge button. */
  notedRefs?: number;
  /** Folder kind: annotation coverage of the supported files under this folder
   *  (how many carry a prompt) — rendered as the thin heat bar at the card's
   *  bottom edge so annotation debt is visible at a glance. */
  coverage?: { annotated: number; total: number };
}

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
  const lastSlash = d.label.lastIndexOf('/');
  const basename = lastSlash === -1 ? d.label : d.label.slice(lastSlash + 1);
  const dirname = lastSlash === -1 ? '' : d.label.slice(0, lastSlash);
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
  // policy lives in lib/cardLod (pure + unit-tested); here we just feed it this
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
  const previewable = type === 'image' || type === 'text' || type === 'code';
  const showPreview = previewable && !orphan && !isFolder;
  // A changed text/code file shows its DIFF (red/green/±) in place of the plain
  // content — the canvas becomes a spatial "what changed" board (the multi-file
  // overview). Skip images (a diff is meaningless) and conflicts (a U on either
  // side); those keep their normal preview.
  const showFileDiff =
    showPreview &&
    type !== 'image' &&
    gitDirect != null &&
    gitDirect.x !== 'U' &&
    gitDirect.y !== 'U';
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
      // Inline rename retitles in place. A typed '/' (or '.'/'..') would turn it
      // into a cross-folder MOVE — surprising here, and it leaves a stale card at
      // the old scope until reload — so reject anything that isn't a plain basename.
      if (name.includes('/') || name === '.' || name === '..') return;
      const newRel = dirname === '' ? name : `${dirname}/${name}`;
      void renameEntry(d.label, newRel, d.kind);
    },
    [dirname, d.label, d.kind, endRename, renameEntry],
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
          // which lives in the 'full' tier (see lib/cardLod).
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
                      letterSpacing: -0.1,
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
                      letterSpacing: -0.1,
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
                    letterSpacing: -0.2,
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

// The "see inside" payload. Cheap, type-aware, and pointer-transparent so it
// never steals the badge's drag. Markdown renders to static, sanitized HTML (the
// shared off-screen converter); other text shows a faded raw excerpt, and images
// show a contained thumbnail. PDF/audio/video/other degrade to nothing extra —
// the glyph + name already say what they are, and a live thumbnail there would
// cost far more than it tells.
const BadgePreview = ({
  type,
  label,
  wsPath,
}: {
  type: BadgeType;
  label: string;
  wsPath: string;
}): JSX.Element | null => {
  const frame: CSSProperties = {
    flex: 1,
    minHeight: 0,
    padding: `${space[2]}px ${space[3]}px ${space[3]}px`,
    overflow: 'hidden',
    pointerEvents: 'none', // never intercept the badge drag
  };

  if (type === 'image') {
    return (
      <div style={frame}>
        <img
          src={fileUrl(`${wsPath}/${label}`)}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            maxWidth: '100%',
            width: '100%',
            height: '100%',
            margin: '0 auto',
            objectFit: 'contain',
            borderRadius: radius.sm,
          }}
        />
      </div>
    );
  }

  if (type === 'text' || type === 'code') {
    // Markdown renders to its formatted HTML (a window into the note); plain text
    // and source code show their raw bytes — rendering those would be a lie.
    const isMarkdown = /\.(md|markdown|mdx)$/i.test(label);
    return (
      <div style={frame}>
        {isMarkdown ? (
          <MarkdownPreview label={label} />
        ) : (
          <TextPreview label={label} mono={type === 'code'} />
        )}
      </div>
    );
  }

  return null;
};

// Fade the bottom so the truncation reads as "more below," not a hard cut.
const previewMask: CSSProperties = {
  height: '100%',
  overflow: 'hidden',
  maskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
};

// A changed file's card shows its DIFF preview (red/green/±) — the canvas as a
// spatial review board. HEAD ↔ working tree = all uncommitted changes, compact
// context. Re-fetches when the file changes on disk (the tile event hub) and
// falls back to the normal content preview while loading / on error / when empty,
// so the tile never flashes blank.
const BadgeDiffPreview = ({
  type,
  label,
  wsPath,
}: {
  type: BadgeType;
  label: string;
  wsPath: string;
}): JSX.Element => {
  const [rev, setRev] = useState(0);
  useEffect(
    () =>
      subscribeTile((e) => {
        const touched =
          e.type === 'change' || e.type === 'unlink'
            ? e.relPath === label
            : e.type === 'rename'
              ? e.fromRelPath === label || e.toRelPath === label
              : false;
        if (touched) setRev((r) => r + 1);
      }),
    [label],
  );
  const diff = useFileDiff(label, { leftRef: 'HEAD', rightWorktree: true, context: 2 }, rev);
  if (diff.status === 'ready' && diff.rows.length > 0) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={previewMask}>
          <UnifiedDiff rows={diff.rows} oldHtml={diff.oldHtml} newHtml={diff.newHtml} />
        </div>
      </div>
    );
  }
  // While the diff loads, a quiet placeholder — NOT a full <BadgePreview>, which
  // would spin up a SECOND read chain (+ a wasted Markdown render) for the same
  // file just to be replaced a frame later. Only a no-diff (matches HEAD) or an
  // error falls back to the real content preview.
  if (diff.status === 'loading') {
    return <div style={{ flex: 1, minHeight: 0 }} />;
  }
  return <BadgePreview type={type} label={label} wsPath={wsPath} />;
};

// Read (and cache) a bounded excerpt of a file's raw text, re-reading when the
// file changes on disk so the tile always matches it. Shared by the raw
// text/code preview and the Markdown render path. Returns null while loading.
function usePreviewSource(label: string): string | null {
  const [content, setContent] = useState<PreviewContent | null>(
    () => previewCache.get(label) ?? null,
  );
  // Bumped when this file changes on disk (the user edits it in the editor, or
  // an external/agent edit) — invalidates the cache so the tile re-fetches and
  // the preview always matches the file. Disk is the single source of truth.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribeTile((event) => {
      if (event.type === 'change' && event.relPath === label) {
        invalidatePreviewCache(label);
        setTick((t) => t + 1); // re-read from disk → tile matches the file
      } else if (event.type === 'unlink' && event.relPath === label) {
        invalidatePreviewCache(label); // drop stale cache; the badge orphans
      } else if (event.type === 'rename' && event.fromRelPath === label) {
        invalidatePreviewCache(label); // path reused later won't serve old content
      }
    });
  }, [label]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a refetch trigger — bumped on a disk change to invalidate the cache and re-read
  useEffect(() => {
    const cached = previewCache.get(label);
    if (cached) {
      setContent(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      let out: PreviewContent;
      try {
        // Cap the read at PREVIEW_CHARS: a tall card shows more, but a multi-MB
        // file never crosses IPC whole nor blows up the Markdown parse.
        const res = (await window.bh.run('workspace.readFile', {
          path: label,
          maxChars: PREVIEW_CHARS,
        })) as { content: string };
        out = { text: res.content.slice(0, PREVIEW_CHARS).trimEnd() };
      } catch {
        out = { text: '' };
      }
      previewCache.set(label, out);
      if (!cancelled) setContent(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [label, tick]);

  return content === null ? null : content.text;
}

const previewLoading: CSSProperties = { fontSize: font.size.micro, color: color.textTertiary };

// The raw-bytes body, shared by the text/code tile and the Markdown fallback.
const RawTextBody = ({ text, mono }: { text: string; mono: boolean }): JSX.Element => (
  <div
    style={{
      ...previewMask,
      fontSize: 'var(--bh-card-font-size)',
      fontFamily: mono ? font.mono : 'var(--bh-card-font)',
      color: mono ? color.textTertiary : 'var(--bh-card-text)',
      lineHeight: 'var(--bh-card-line-height)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}
  >
    {text === '' ? 'empty file' : text}
  </div>
);

const TextPreview = ({ label, mono }: { label: string; mono: boolean }): JSX.Element => {
  const text = usePreviewSource(label);
  if (text === null) return <div style={previewLoading}>…</div>;
  return <RawTextBody text={text} mono={mono} />;
};

// A .md tile renders the SAME way the editor would (BlockNote's own HTML) but as
// a static, sanitized string — no editor mounted, no ProseMirror per card. The
// conversion runs through the one shared off-screen converter (lib/mdRender),
// serialized + timeout-guarded; while pending or on failure we show the raw
// excerpt so the tile is never blank.
const MarkdownPreview = ({ label }: { label: string }): JSX.Element => {
  const text = usePreviewSource(label);
  const [html, setHtml] = useState<string | null>(() => mdHtmlCache.get(label) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (text === null || text === '') return;
    const cached = mdHtmlCache.get(label);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void markdownToHtml(text)
      .then((out) => {
        mdHtmlCache.set(label, out);
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setFailed(true); // raw-excerpt fallback below
      });
    return () => {
      cancelled = true;
    };
  }, [label, text]);

  if (text === null) return <div style={previewLoading}>…</div>;
  if (text === '') return <RawTextBody text="" mono={false} />; // 'empty file' affordance
  if (html === null) {
    // Render pending vs failed: while the shared converter is working, show a
    // quiet loading dot — NOT the raw `#`/`**` source (flashing source then
    // reflowing to rendered is exactly the jank we're removing). Only a real
    // conversion failure falls back to the raw excerpt, so the tile is never blank.
    return failed ? <RawTextBody text={text} mono={false} /> : <div style={previewLoading}>…</div>;
  }
  return (
    <div
      className="bh-md-preview"
      style={previewMask}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: html is sanitized in lib/mdRender (script/style/iframe/event handlers + javascript: URLs stripped) before it reaches here
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

// The collapsed card: a centred glyph + name that fills the card, so there's no
// dead space at any height. Used for EVERY kind once the card is too small ON
// SCREEN to carry its payload (see lib/cardLod) — a file's preview or a folder's
// count + contents. Pointer-transparent enough that the card still handles
// select / double-click; the chip is purely visual.
const CardTitleChip = ({
  type,
  tone,
  name,
  orphan,
  cardHeightPx,
}: {
  type: BadgeType;
  tone: string;
  name: string;
  orphan: boolean;
  cardHeightPx: number;
}): JSX.Element => {
  // Clamped counter-scale (the testable spec is miniLabelFlowFontPx in lib/cardLod):
  // the name's FLOW font-size counter-scales toward a constant ON-SCREEN size as
  // the canvas zooms out, but is floored at the caption and capped at a fraction
  // of THIS card's height so it can never overrun the shrinking card. The live
  // zoom is the CSS var --bh-zoom (set once per frame by the canvas, no React),
  // so this whole effect is pure CSS — the tile doesn't re-render on zoom.
  const capPx = Math.round(
    Math.max(MINI_LABEL_MIN_FLOW_PX, cardHeightPx * MINI_LABEL_CARD_HEIGHT_FRACTION),
  );
  const fontSize = `clamp(${MINI_LABEL_MIN_FLOW_PX}px, calc(${MINI_LABEL_TARGET_SCREEN_PX}px / var(--bh-zoom, 1)), ${capPx}px)`;
  return (
    // Outer: fills the card and TOP-aligns the glyph+name block. Same top padding
    // as the full-tier header, so a card's name stays anchored in the same spot
    // when it flips between full and mini (no jump to centre), and a wrapped name
    // grows downward from a fixed top. Clips only the rare name still too tall once
    // wrapped (no ellipsis — see the name span).
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        height: '100%',
        flex: 1,
        minWidth: 0,
        padding: `${space[2]}px ${space[3]}px`,
        fontSize,
        overflow: 'hidden',
      }}
    >
      {/* Inner: the glyph FLOATS left, so the name's first line sits beside it and
          every line after WRAPS back to the full card width (flowing under the
          glyph) instead of staying in a narrow column to its right — that's what
          frees the space the glyph used to waste. flow-root contains the float so
          the block's height (and the card's top padding) stays correct. */}
      <div style={{ display: 'flow-root', minWidth: 0 }}>
        {/* Box matched to the first line's height so the glyph optically centres on
            line one. */}
        <span
          aria-hidden
          style={{
            float: 'left',
            display: 'flex',
            alignItems: 'center',
            height: '1.35em',
            marginRight: '0.4em',
          }}
        >
          <FileGlyph type={type} tone={tone} size="1.15em" />
        </span>
        <span
          style={{
            fontWeight: font.weight.semibold,
            fontSize: '1em',
            lineHeight: 1.35,
            color: orphan ? color.danger : color.textPrimary,
            // No ellipsis: a name too long for one line WRAPS to the next instead of
            // truncating. overflow-wrap:anywhere lets a long unbroken filename (no
            // spaces) break mid-token to fit the card width; the outer overflow:hidden
            // clips only the rare name too tall to fit even when wrapped.
            overflowWrap: 'anywhere',
            letterSpacing: -0.1,
          }}
        >
          {name}
        </span>
      </div>
    </div>
  );
};

// Short, uppercased-by-KindChip count for the folder header: "EMPTY" / "1 ITEM"
// / "12 ITEMS". Tells you the size at a glance even when the card is too short to
// show every contents row.
const countLabel = (total: number): string =>
  total === 0 ? 'empty' : total === 1 ? '1 item' : `${total} items`;

// A folder card's body: a peek at its direct contents (glyph + name per child),
// folders-first, capped at FOLDER_PREVIEW_LIMIT by core — the rest collapse to
// "+N more". An annotated folder still shows its own note below, dimmer, so the
// card reads as "this labelled group, and here's what's in it." Pointer-transparent
// so it never steals the badge drag; double-clicking the card enters the folder.
const FolderContents = ({
  preview,
  prompt,
}: {
  preview: CanvasFolderPreview;
  prompt?: string;
}): JSX.Element => {
  const remaining = preview.total - preview.items.length;
  return (
    <div
      aria-hidden
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: space[1],
        padding: `${space[1.5]}px ${space[3]}px ${space[2]}px`,
        overflow: 'hidden',
        pointerEvents: 'none',
        maskImage: 'linear-gradient(to bottom, #000 86%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 86%, transparent)',
      }}
    >
      {preview.total === 0 ? (
        <span style={{ fontSize: font.size.caption, color: color.textGhost }}>Empty folder</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
          {preview.items.map((it) => {
            const isDir = it.kind === 'folder';
            return (
              <div
                key={it.name}
                style={{ display: 'flex', alignItems: 'center', gap: space[1.5], minWidth: 0 }}
              >
                <FileGlyph
                  type={badgeType(it.name, isDir)}
                  tone={isDir ? color.folderGlyph : color.textTertiary}
                  size={12}
                />
                <span
                  style={{
                    fontSize: font.size.caption,
                    color: color.textSecondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    fontFamily: isDir ? font.sans : font.mono,
                    letterSpacing: -0.1,
                  }}
                >
                  {it.name}
                  {isDir ? '/' : ''}
                </span>
              </div>
            );
          })}
          {remaining > 0 && (
            <span
              style={{
                fontSize: font.size.micro,
                color: color.textTertiary,
                paddingLeft: 12 + space[1.5],
                marginTop: 1,
              }}
            >
              +{remaining} more
            </span>
          )}
        </div>
      )}
      {prompt && (
        <div
          style={{
            marginTop: space[1],
            paddingTop: space[1.5],
            borderTop: `1px solid ${color.border}`,
            fontSize: font.size.micro,
            color: color.textTertiary,
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            wordBreak: 'break-word',
          }}
        >
          {prompt}
        </div>
      )}
    </div>
  );
};

const KindChip = ({
  label,
  tone,
}: {
  label: string;
  tone: 'folder' | 'danger';
}): JSX.Element => (
  <span
    style={{
      fontSize: 9,
      fontWeight: font.weight.semibold,
      color: tone === 'danger' ? color.danger : '#8a6c00',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      background: tone === 'danger' ? color.dangerSoft : 'rgba(0,0,0,0.04)',
      padding: '1px 5px',
      borderRadius: radius.sm,
      flexShrink: 0,
    }}
  >
    {label}
  </span>
);

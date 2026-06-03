import { type Node, type NodeProps, NodeResizer, useReactFlow } from '@xyflow/react';
import {
  type CSSProperties,
  type JSX,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { CanvasConnectionHandles, useCanvasConnectionHandles } from '../canvasConnections/index.js';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { flushDoc } from '../lib/editorFlush.js';
import { docKeyFor } from '../lib/liveDoc.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { type BadgeType, FileGlyph, badgeType } from './FileGlyph.js';
import { MdEditor } from './FilePreview.js';

// A badge is a *living tile*: it always shows a real preview of the file's
// contents (a text excerpt / image thumbnail), so the canvas reads as "my
// documents in space," not a graph of names. React-flow's transform scales the
// whole tile with zoom — so the content shrinks to a thumbnail when you zoom
// out and becomes readable as you zoom in, with no detail-toggling needed.

// Cache previews per path so a transient unmount (Canvas rebuilds nodes on file
// events) doesn't refetch/re-render. Staleness self-heals on the next refresh.
// Markdown cards use the same compact BlockNote surface for preview/edit; other
// text falls back to a raw excerpt.
type PreviewContent = { text: string };
const previewCache = new Map<string, PreviewContent>();
const PREVIEW_CHARS = 600;
export const CARD_MIN_WIDTH = 220;
export const CARD_MIN_HEIGHT = 160;
export const DEFAULT_FILE_CARD_WIDTH = 300;
export const DEFAULT_FILE_CARD_HEIGHT = 220;
export const DEFAULT_FOLDER_CARD_WIDTH = 240;
export const DEFAULT_FOLDER_CARD_HEIGHT = 132;

// One shared file-event subscription fans out to all mounted tiles, instead of
// each tile registering its own ipcRenderer listener (which trips Node's
// MaxListeners warning past ~10 text badges and fans out O(N) per event).
type FileEvent = Parameters<Parameters<typeof window.bh.onFileEvent>[0]>[0];
const tileListeners = new Set<(e: FileEvent) => void>();
let tileHubUnsub: (() => void) | null = null;
function invalidatePreviewCache(label: string): void {
  previewCache.delete(label);
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
}

type BadgeFlowNode = Node<BadgeNodeData, 'badge'>;

export const BadgeNode = ({ id, data, selected }: NodeProps<BadgeFlowNode>): JSX.Element => {
  const d = data as unknown as BadgeNodeData;
  const isFolder = d.kind === 'folder';
  const orphan = d.orphan === true;
  const lastSlash = d.label.lastIndexOf('/');
  const basename = lastSlash === -1 ? d.label : d.label.slice(lastSlash + 1);
  const dirname = lastSlash === -1 ? '' : d.label.slice(0, lastSlash);
  const type = badgeType(d.label, isFolder);
  const canInlineEdit = !isFolder && !orphan && /\.(md|markdown)$/i.test(d.label);
  const inlinePaneId = `canvas-card:${d.label}`;

  const wsPath = useWorkspaceStore((s) => {
    const w = s.workspaces.find((ws) => ws.name === s.current);
    return w?.path ?? '';
  });
  const inlineDocKey = docKeyFor(wsPath, d.label);
  const openBadgeInPanel = useWorkspaceStore((s) => s.openBadgeInPanel);
  const { setNodes: setFlowNodes } = useReactFlow<BadgeFlowNode>();
  const [nodeHover, setNodeHover] = useState(false);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineClosing, setInlineClosing] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const connectionHandles = useCanvasConnectionHandles({ disabled: inlineEditing, nodeId: id });
  const armingInlineEdit = useRef(false);
  const inlineCloseBlocked = useRef(false);
  // Always show a content preview for the types we can render cheaply
  // (text/markdown/code → excerpt, image → thumbnail). Orphans (missing file)
  // and folders have nothing to preview.
  const previewable = type === 'image' || type === 'text' || type === 'code';
  const showPreview = previewable && !orphan && !isFolder;
  const usesMarkdownCardSurface = canInlineEdit && showPreview;

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

  const tooltip = inlineEditing
    ? `${d.label} — editing on canvas`
    : isFolder
      ? `${d.label} — click to select; double-click to enter this folder`
      : orphan
        ? `${d.label} — referenced but missing on disk`
        : `${d.label} — click to select; double-click to open in the right panel`;

  const boxShadow = shadow.card;
  const showChrome = selected || nodeHover;
  const showResizeControls = selected || nodeHover;
  const finishInlineEdit = useCallback(async () => {
    if (!inlineEditing || inlineClosing) return;
    setInlineClosing(true);
    setInlineError('');
    inlineCloseBlocked.current = false;
    try {
      const ok = await flushDoc(inlineDocKey, { forceSerialize: true });
      if (ok) {
        invalidatePreviewCache(d.label);
        inlineCloseBlocked.current = false;
        setInlineEditing(false);
      } else {
        inlineCloseBlocked.current = true;
        setInlineError('Resolve the edit before leaving this card.');
      }
    } finally {
      setInlineClosing(false);
    }
  }, [d.label, inlineClosing, inlineDocKey, inlineEditing]);

  useEffect(() => {
    if (!inlineEditing) return;
    if (selected) {
      armingInlineEdit.current = false;
      return;
    }
    if (armingInlineEdit.current) return;
    if (inlineCloseBlocked.current) return;
    void finishInlineEdit();
  }, [finishInlineEdit, inlineEditing, selected]);

  useEffect(() => {
    if (!inlineEditing) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      void finishInlineEdit();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [finishInlineEdit, inlineEditing]);

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

  const routeInlineEditorWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>): void => {
      if (!inlineEditing) return;
      const scroller = event.currentTarget.querySelector<HTMLElement>('.bh-md-editor-scroll');
      event.preventDefault();
      event.stopPropagation();
      if (!scroller) return;
      scroller.scrollTop += event.deltaY;
      scroller.scrollLeft += event.deltaX;
    },
    [inlineEditing],
  );

  const chromeButton = (active = false): CSSProperties => ({
    position: 'relative',
    flexShrink: 0,
    width: 24,
    height: 24,
    padding: 0,
    border: `1px solid ${active ? color.accentSoft : showChrome ? color.borderStrong : 'transparent'}`,
    borderRadius: radius.md,
    background: active ? `${color.accent}1f` : 'transparent',
    color: active ? color.accent : color.textTertiary,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: showChrome || inlineEditing || active ? 1 : 0.56,
    pointerEvents: 'auto',
    transition: transition(['opacity', 'border-color', 'background', 'color']),
  });

  return (
    <div
      ref={connectionHandles.cardRef}
      data-selected={selected ? 'true' : 'false'}
      data-editing={inlineEditing ? 'true' : 'false'}
      data-testid={`canvas-card-${d.label}`}
      className={inlineEditing ? 'nowheel' : undefined}
      title={tooltip}
      onMouseEnter={() => setNodeHover(true)}
      onMouseLeave={() => setNodeHover(false)}
      onPointerMove={connectionHandles.onCardPointerMove}
      onWheelCapture={inlineEditing ? routeInlineEditorWheel : undefined}
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
        cursor: inlineEditing ? 'default' : 'grab',
      }}
    >
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
        disabled={inlineEditing}
        sourceAffordance={connectionHandles.sourceAffordance}
        targetAffordance={connectionHandles.targetAffordance}
        targetInteractive={connectionHandles.targetInteractive}
      />
      <div
        style={{
          display: 'flex',
          gap: space[2],
          alignItems: 'flex-start',
          padding: `${space[2]}px ${space[3]}px`,
          borderBottom: showPreview || inlineEditing ? `1px solid ${color.border}` : 'none',
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
            {canInlineEdit && (
              <button
                type="button"
                className="nodrag nopan"
                title={inlineEditing ? 'Finish editing on canvas' : 'Edit on canvas'}
                aria-label={`Edit on canvas for ${d.label}`}
                aria-pressed={inlineEditing}
                data-testid={`canvas-inline-edit-button-${d.label}`}
                onPointerDown={stopNodeGesture}
                onMouseDown={stopNodeGesture}
                onDoubleClick={stopNodeGesture}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectThisNode();
                  if (inlineEditing) {
                    void finishInlineEdit();
                  } else {
                    armingInlineEdit.current = true;
                    inlineCloseBlocked.current = false;
                    setInlineError('');
                    setInlineEditing(true);
                  }
                }}
                style={chromeButton(inlineEditing)}
              >
                <FileGlyph
                  type="edit"
                  tone={inlineEditing ? color.accent : color.textTertiary}
                  size={15}
                />
              </button>
            )}
            {!isFolder && (
              <button
                type="button"
                className="nodrag nopan"
                title="Edit File Badge"
                aria-label={`Edit File Badge for ${d.label}`}
                onPointerDown={stopNodeGesture}
                onMouseDown={stopNodeGesture}
                onDoubleClick={stopNodeGesture}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectThisNode();
                  openBadgeInPanel(d.label);
                }}
                style={chromeButton(d.prompt !== undefined && d.prompt !== '')}
              >
                <FileGlyph
                  type="badge"
                  tone={d.prompt ? color.accent : color.textTertiary}
                  size={15}
                />
                {d.prompt && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: 3,
                      right: 3,
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: color.accent,
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
      {usesMarkdownCardSurface ? (
        <div
          className={inlineEditing ? 'nodrag nopan nowheel' : undefined}
          data-testid={inlineEditing ? `canvas-inline-editor-${d.label}` : undefined}
          onMouseDown={inlineEditing ? (e) => e.stopPropagation() : undefined}
          onDoubleClick={inlineEditing ? (e) => e.stopPropagation() : undefined}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            cursor: inlineEditing ? 'text' : 'grab',
            background: color.surface,
            pointerEvents: inlineEditing ? 'auto' : 'none',
            maskImage: inlineEditing
              ? undefined
              : 'linear-gradient(to bottom, #000 70%, transparent)',
            WebkitMaskImage: inlineEditing
              ? undefined
              : 'linear-gradient(to bottom, #000 70%, transparent)',
          }}
        >
          <MdEditor
            file={d.label}
            paneId={inlinePaneId}
            docKey={inlineDocKey}
            compact
            cardEditable={inlineEditing}
            promoteOnEdit={false}
            onDiscardClose={() => {
              inlineCloseBlocked.current = false;
              setInlineEditing(false);
            }}
          />
          {inlineError && (
            <div
              style={{
                position: 'absolute',
                left: space[2],
                right: space[2],
                bottom: space[2],
                padding: `${space[1]}px ${space[2]}px`,
                borderRadius: radius.md,
                background: color.warningSoft,
                color: color.warning,
                fontSize: font.size.micro,
                boxShadow: shadow.card,
              }}
            >
              {inlineError}
            </div>
          )}
        </div>
      ) : showPreview ? (
        <BadgePreview type={type} label={d.label} wsPath={wsPath} />
      ) : (
        <div
          aria-hidden
          style={{
            flex: 1,
            minHeight: 0,
            padding: `${space[2]}px ${space[3]}px`,
            color: color.textGhost,
            fontSize: font.size.caption,
            lineHeight: 1.45,
          }}
        >
          {isFolder ? dirname || basename : orphan ? 'Missing file' : ''}
        </div>
      )}
    </div>
  );
};

// The non-Markdown "see inside" payload. Cheap, type-aware, and
// pointer-transparent so it never steals the badge's drag. Markdown cards use
// MdEditor directly above; other text shows a faded raw excerpt, and images show
// a contained thumbnail. PDF/audio/video/other degrade to nothing extra — the
// glyph + name already say what they are, and a live thumbnail there would cost
// far more than it tells.
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
          src={`file://${wsPath}/${label}`}
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
    return (
      <div style={frame}>
        <TextPreview label={label} mono={type === 'code'} />
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

const TextPreview = ({
  label,
  mono,
}: {
  label: string;
  mono: boolean;
}): JSX.Element => {
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
        previewCache.delete(label);
        setTick((t) => t + 1); // re-read from disk → tile matches the file
      } else if (event.type === 'unlink' && event.relPath === label) {
        previewCache.delete(label); // drop stale cache; the badge orphans
      } else if (event.type === 'rename' && event.fromRelPath === label) {
        previewCache.delete(label); // path reused later won't serve old content
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
        // Cap the read: a tile only ever shows PREVIEW_CHARS, so don't ship a
        // multi-MB file across IPC for a small canvas excerpt. The headroom
        // leaves enough room for code/text files whose useful first lines land
        // just past a short prologue while still bounding the read.
        const res = (await window.bh.run('workspace.readFile', {
          path: label,
          maxChars: PREVIEW_CHARS + 16_384,
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

  if (content === null) {
    return <div style={{ fontSize: font.size.micro, color: color.textTertiary }}>…</div>;
  }
  return (
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
      {content.text === '' ? 'empty file' : content.text}
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

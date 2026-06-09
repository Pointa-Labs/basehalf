import { type Node, type NodeProps, NodeResizer, useReactFlow, useStore } from '@xyflow/react';
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
import { markdownToHtml } from '../lib/mdRender.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { type BadgeType, FileGlyph, badgeType } from './FileGlyph.js';
import { MdEditor } from './FilePreview.js';

// A badge is a *living tile*: when it's big enough on screen to read, it shows a
// real preview of the file's contents (rendered Markdown, a raw text/code
// excerpt, or an image thumbnail), so the canvas reads as "my documents in
// space," not a graph of names. A taller card reveals more of the same. Below
// PREVIEW_ZOOM_THRESHOLD the tile is too small to read, so it drops to just a
// name + glyph — no file read, no editor. This level-of-detail gate is what keeps
// a large, fully-framed workspace fast: at fit-to-all zoom EVERY tile is on
// screen, so viewport virtualization alone can't cull the per-tile preview work.

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
export const CARD_MIN_WIDTH = 220;
export const CARD_MIN_HEIGHT = 160;
export const DEFAULT_FILE_CARD_WIDTH = 300;
export const DEFAULT_FILE_CARD_HEIGHT = 220;
export const DEFAULT_FOLDER_CARD_WIDTH = 240;
export const DEFAULT_FOLDER_CARD_HEIGHT = 132;
// Below this zoom a default 300px card is < ~150px wide on screen — too small to
// read the content preview, so cards drop to name + glyph only (see BadgeNode).
// Tune to taste: higher = previews kick in only when zoomed closer.
export const PREVIEW_ZOOM_THRESHOLD = 0.5;

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
  const setCardEditing = useWorkspaceStore((s) => s.setCanvasCardEditing);
  const { setNodes: setFlowNodes } = useReactFlow<BadgeFlowNode>();
  // Level-of-detail: only render the (expensive) content preview when the canvas
  // is zoomed in enough to actually read it. The boolean selector re-renders the
  // tile only when CROSSING the threshold, not on every zoom delta (no flicker).
  const showDetail = useStore((s) => s.transform[2] >= PREVIEW_ZOOM_THRESHOLD);
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

  // Tell the canvas this card is being inline-edited so it suspends viewport
  // virtualization — otherwise a pan/zoom could cull this tile mid-edit and the
  // unmount would CANCEL (not flush) the debounced autosave, losing keystrokes.
  // Cleared on exit and on unmount (idempotent in the store).
  useEffect(() => {
    setCardEditing(id, inlineEditing);
    return () => setCardEditing(id, false);
  }, [id, inlineEditing, setCardEditing]);

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
      {/* Markdown cards mount the heavy live editor (BlockNote + Yjs) ONLY while
          inline-editing — never as the resting preview. Otherwise every .md card
          on the canvas mounts its own ProseMirror editor (e.g. ~48 at once inside
          a decisions/ folder), janking the whole canvas. At rest, markdown falls
          through to the cheap BadgePreview excerpt below (it is type 'text'). */}
      {usesMarkdownCardSurface && inlineEditing ? (
        <div
          className="nodrag nopan nowheel"
          data-testid={`canvas-inline-editor-${d.label}`}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            cursor: 'text',
            background: color.surface,
            pointerEvents: 'auto',
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
      ) : showPreview && showDetail ? (
        <BadgePreview type={type} label={d.label} wsPath={wsPath} />
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

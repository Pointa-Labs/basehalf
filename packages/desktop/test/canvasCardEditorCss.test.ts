import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../src/renderer/src/globals.css'), 'utf-8');
const badgeNodeSource = readFileSync(
  join(__dirname, '../src/renderer/src/components/BadgeNode.tsx'),
  'utf-8',
);
const canvasSource = readFileSync(
  join(__dirname, '../src/renderer/src/components/Canvas.tsx'),
  'utf-8',
);
const canvasSnapGuidesSource = readFileSync(
  join(__dirname, '../src/renderer/src/components/CanvasSnapGuides.tsx'),
  'utf-8',
);
const canvasFlowSnapSource = readFileSync(
  join(__dirname, '../src/renderer/src/lib/canvasFlowSnap.ts'),
  'utf-8',
);
const connectionGeometrySource = readFileSync(
  join(__dirname, '../src/renderer/src/canvasConnections/geometry.ts'),
  'utf-8',
);
const connectionEdgesSource = readFileSync(
  join(__dirname, '../src/renderer/src/canvasConnections/edges.ts'),
  'utf-8',
);
const connectionHandlesSource = readFileSync(
  join(__dirname, '../src/renderer/src/canvasConnections/CanvasConnectionHandles.tsx'),
  'utf-8',
);
const referenceEdgeSource = readFileSync(
  join(__dirname, '../src/renderer/src/canvasConnections/ReferenceEdge.tsx'),
  'utf-8',
);
const filePreviewSource = readFileSync(
  join(__dirname, '../src/renderer/src/components/FilePreview.tsx'),
  'utf-8',
);
const mdRenderSource = readFileSync(
  join(__dirname, '../src/renderer/src/lib/mdRender.ts'),
  'utf-8',
);

describe('canvas card editor CSS', () => {
  it('uses the compact BlockNote card typography contract', () => {
    expect(css).toContain('--bh-card-font:');
    expect(css).toContain('.bh-card-editor .bn-editor.bn-default-styles');
    expect(css).toMatch(
      /\.bh-card-editor\s+\.bn-editor\.bn-default-styles[\s\S]*font-family:\s*var\(--bh-card-font\)/,
    );
    expect(css).toMatch(
      /\.bh-card-editor\s+\.bn-editor\.bn-default-styles[\s\S]*font-size:\s*var\(--bh-card-font-size\)/,
    );
    expect(css).toMatch(
      /\.bh-card-editor\s+\.bn-editor\.bn-default-styles[\s\S]*color:\s*var\(--bh-card-text\)/,
    );
  });

  it('renders a resting Markdown tile as static, sanitized HTML (no editor mounted)', () => {
    // A .md card at rest shows its RENDERED note (formatted — not raw `#`/`**`
    // source) via the ONE shared off-screen converter (lib/mdRender), emitted as
    // a static sanitized HTML string. This is NOT the live editor — that still
    // mounts only while editing (asserted in the next test). The earlier
    // "raw excerpt at rest" rule was reverted: raw markdown source on the canvas
    // defeats the point of a thinking/notes surface.
    expect(css).toContain('.bh-md-preview');
    expect(badgeNodeSource).toContain('markdownToHtml');
    expect(badgeNodeSource).toContain('<MarkdownPreview label={label} />');
    expect(badgeNodeSource).toContain('className="bh-md-preview"');
    // The HTML is set via innerHTML, so it MUST be sanitized upstream.
    expect(mdRenderSource).toContain('function sanitizeHtml');
    expect(mdRenderSource).toContain('DANGEROUS_TAGS');
    expect(mdRenderSource).toMatch(/sanitizeHtml\(await editor\.blocksToHTMLLossy/);
  });

  it('mounts the heavy card editor only while inline-editing, not for the resting preview', () => {
    expect(badgeNodeSource).toContain(
      'const usesMarkdownCardSurface = canInlineEdit && showPreview;',
    );
    // The live BlockNote+Yjs editor mounts ONLY while inline-editing — mounting it
    // for the resting preview would put one ProseMirror editor on every .md card
    // and jank a large workspace. At rest, markdown renders through BadgePreview
    // as a static HTML string (cheap, shared converter), never a mounted editor.
    expect(badgeNodeSource).toMatch(
      /\{usesMarkdownCardSurface && inlineEditing \? \([\s\S]*<MdEditor[\s\S]*cardEditable=\{inlineEditing\}/,
    );
    expect(badgeNodeSource).toMatch(/\) : showPreview && showDetail \? \(\s*<BadgePreview/);
    // Level-of-detail: the preview body is gated on showDetail (zoom), so a fully
    // framed large workspace doesn't render every card's preview at once.
    expect(badgeNodeSource).toContain('s.transform[2] >= PREVIEW_ZOOM_THRESHOLD');
    expect(filePreviewSource).toContain('cardEditable = true');
    expect(filePreviewSource).toMatch(/autoFocus=\{compact && compactEditable\}/);
    expect(filePreviewSource).toMatch(/editable=\{!viewOnly && seedReady && compactEditable\}/);
    expect(filePreviewSource).toMatch(/ownerPriority:\s*\(\)\s*=>\s*ownerPriorityRef\.current/);
  });

  it('uses quiet dynamic side handles for canvas connections', () => {
    expect(connectionGeometrySource).toContain(
      'export const CANVAS_CONNECTION_SIDES: readonly CanvasConnectionSide[] = [',
    );
    expect(connectionGeometrySource).toContain('sourceAffordanceForPointer');
    expect(connectionGeometrySource).toContain(
      'type CanvasConnectionAffordance = CanvasConnectionSide',
    );
    expect(connectionGeometrySource).toContain('CANVAS_CONNECTION_POINT_SIZE = 15');
    expect(connectionGeometrySource).toContain('CANVAS_CONNECTION_TARGET_HIT_DEPTH = 48');
    expect(connectionGeometrySource).toContain('targetAffordanceForPoint');
    expect(connectionGeometrySource).toContain('x >= 0 && x <= rect.width');
    expect(connectionGeometrySource).toContain("side: 'top', distance: y");
    expect(connectionHandlesSource).toContain(
      'const connectionState = useConnection((connection) => ({',
    );
    expect(connectionHandlesSource).toContain('fromNodeId: connection.fromNode?.id ?? null');
    expect(connectionHandlesSource).toContain("window.addEventListener('mousemove'");
    expect(connectionHandlesSource).toContain('targetAffordanceForPoint(rect, point.clientX');
    expect(connectionGeometrySource).toContain('return nearest.side;');
    expect(connectionEdgesSource).toContain('export function badgesToConnectionEdges');
    expect(connectionEdgesSource).toContain('export function sideFromHandle');
    expect(connectionHandlesSource).toContain("left: '50%'");
    expect(connectionHandlesSource).toContain("top: '50%'");
    expect(connectionHandlesSource).toContain('top: 0');
    expect(connectionHandlesSource).toContain('right: 0');
    expect(badgeNodeSource).toContain("overflow: 'visible'");
    expect(connectionGeometrySource).not.toContain('Math.round(connectAffordance.x)');
    expect(connectionHandlesSource).toContain('data-active={active ?');
    expect(connectionHandlesSource).toContain('isConnectableEnd={false}');
    expect(connectionHandlesSource).toContain(
      'connectPointStyle(side, active, !connectionInProgress, 21)',
    );
    expect(connectionHandlesSource).toContain('const targetInteractive = connectionInProgress');
    expect(connectionHandlesSource).toContain('connectTargetHitStyle(side, targetInteractive, 20)');
    expect(connectionHandlesSource).toContain('isConnectableStart={false}');
    expect(connectionHandlesSource).toContain('isConnectableEnd={targetInteractive}');
    expect(connectionHandlesSource).toContain('data-active={targetActive ?');
    expect(badgeNodeSource).toContain('<CanvasConnectionHandles');
    expect(canvasSource).toContain("from '../canvasConnections/index.js'");
    expect(css).toContain('.react-flow__handle.bh-connect-point-handle[data-active="true"]');
    expect(css).toContain('.react-flow__handle.bh-connect-target-handle');
    expect(css).not.toContain('.react-flow__node-badge:hover .react-flow__handle');
    expect(canvasSource).toContain('connectionMode={ConnectionMode.Loose}');
    expect(connectionEdgesSource).toContain('sourceHandle: fromSide');
    expect(connectionEdgesSource).toContain('targetHandle: toSide');
    expect(referenceEdgeSource).toContain('export const ReferenceEdge');
    expect(referenceEdgeSource).toContain('{active && note && (');
  });

  it('locks the cursor while reconnecting an existing edge', () => {
    expect(referenceEdgeSource).toContain(
      "EDGE_RECONNECTING_CURSOR_CLASS = 'bh-edge-reconnecting'",
    );
    expect(referenceEdgeSource).toContain('lockEdgeReconnectCursor');
    expect(referenceEdgeSource).toContain(
      'releaseReconnectCursorRef.current = lockEdgeReconnectCursor();',
    );
    expect(referenceEdgeSource).toContain('endReconnectGesture();');
    expect(css).toContain('body.bh-edge-reconnecting');
    expect(css).toMatch(/body\.bh-edge-reconnecting\s+\*[\s\S]*cursor:\s*grabbing\s*!important/);
  });

  it('uses canvas-space snap guides for move and resize alignment', () => {
    expect(canvasFlowSnapSource).toContain('SNAP_GUIDE_SCREEN_THRESHOLD = 5');
    expect(canvasFlowSnapSource).toContain('snapTranslateRect');
    expect(canvasFlowSnapSource).toContain('snapResizeRect');
    expect(canvasFlowSnapSource).toContain('dragGuidesForMovedAxes');
    expect(canvasSource).toContain('snapFlowNodeChanges');
    expect(canvasSource).not.toContain('function snapNodeChanges');
    expect(canvasSnapGuidesSource).toContain('<ViewportPortal>');
    expect(canvasSnapGuidesSource).toContain('data-testid="canvas-snap-guide"');
    expect(canvasSnapGuidesSource).toContain('repeating-linear-gradient');
    expect(canvasSnapGuidesSource).toContain('opacity: 0.48');
  });

  it('keeps resize controls centered on the card edge', () => {
    expect(css).toContain('.react-flow__node-badge .react-flow__resize-control');
    expect(css).toMatch(
      /\.react-flow__node-badge\s+\.react-flow__resize-control[\s\S]*z-index:\s*12/,
    );
    expect(badgeNodeSource).toContain('const showResizeControls = selected || nodeHover;');
    expect(badgeNodeSource).toContain('isVisible={showResizeControls}');
    expect(badgeNodeSource).toContain("lineStyle={{ borderColor: 'transparent' }}");
    expect(badgeNodeSource).toContain('width: 12');
    expect(badgeNodeSource).toContain('height: 12');
    expect(badgeNodeSource).toContain("pointerEvents: 'all'");
    expect(badgeNodeSource).toContain("background: 'transparent'");
    expect(badgeNodeSource).toContain("border: '0 solid transparent'");
    expect(badgeNodeSource).not.toContain('color={color.accent}');
    expect(badgeNodeSource).not.toContain(
      '\'button, input, textarea, [contenteditable="true"], .react-flow__resize-control\'',
    );
    expect(connectionHandlesSource).toContain(
      'connectPointStyle(side, active, !connectionInProgress, 21)',
    );
    expect(css).toMatch(/\.bh-node-resize-line[\s\S]*opacity:\s*0/);
    expect(css).toMatch(/\.bh-node-resize-line\.right[\s\S]*transform:\s*translate\(-50%, 0\)/);
    expect(css).toMatch(/\.bh-node-resize-line\.bottom[\s\S]*transform:\s*translate\(0, -50%\)/);
    expect(css).toMatch(/\.bh-node-resize-handle[\s\S]*translate:\s*-50% -50%/);
    expect(css).toMatch(/\.bh-node-resize-handle[\s\S]*opacity:\s*0/);
    expect(css).toMatch(/\.bh-node-resize-handle[\s\S]*pointer-events:\s*all/);
    expect(css).toMatch(/\.bh-node-resize-handle[\s\S]*background:\s*transparent/);
    expect(css).toMatch(/\.bh-node-resize-handle[\s\S]*border-color:\s*transparent/);
    expect(css).toMatch(/\.bh-node-resize-handle[\s\S]*box-shadow:\s*none/);
    expect(css).not.toMatch(
      /\.react-flow__node-badge\s+\.bh-node-resize-handle\s*\{[^}]*display:\s*none/,
    );
    expect(css).not.toContain('translate: -100% -100%');
  });

  it('keeps canvas selection functional without drawing a blue outer frame', () => {
    expect(badgeNodeSource).toContain("data-selected={selected ? 'true' : 'false'}");
    expect(badgeNodeSource).toContain('const showChrome = selected || nodeHover;');
    expect(badgeNodeSource).toContain('const showResizeControls = selected || nodeHover;');
    expect(badgeNodeSource).toContain('const boxShadow = shadow.card;');
    expect(badgeNodeSource).not.toContain('shadow.selectedNode');
    expect(badgeNodeSource).not.toContain('${selected ? color.accent : baseBorder}');
  });

  it('keeps the card editor scrollbar from narrowing the text column', () => {
    expect(css).toContain('.bh-md-editor-card .bh-md-editor-scroll');
    expect(css).toMatch(
      /\.bh-md-editor-card\s+\.bh-md-editor-scroll[\s\S]*scrollbar-width:\s*none/,
    );
    expect(css).toMatch(
      /\.bh-md-editor-card\s+\.bh-md-editor-scroll::-webkit-scrollbar[\s\S]*width:\s*0/,
    );
  });

  it('keeps wheel gestures inside an active card editor', () => {
    expect(badgeNodeSource).toContain('routeInlineEditorWheel');
    expect(badgeNodeSource).toContain("className={inlineEditing ? 'nowheel' : undefined}");
    expect(badgeNodeSource).toContain('onWheelCapture={inlineEditing ? routeInlineEditorWheel');
    expect(badgeNodeSource).toContain("querySelector<HTMLElement>('.bh-md-editor-scroll')");
    expect(badgeNodeSource).toContain('event.preventDefault();');
    expect(badgeNodeSource).toContain('scroller.scrollTop += event.deltaY');
    // The card editor wrapper renders only while inline-editing, so it is
    // unconditionally nodrag/nopan/nowheel — gestures stay inside the editor.
    expect(badgeNodeSource).toContain('className="nodrag nopan nowheel"');
  });

  it('focuses the compact editor when a card enters edit mode', () => {
    expect(filePreviewSource).toContain('surfaceRef');
    expect(filePreviewSource).toContain(
      'if (!compact || !compactEditable || viewOnly || !seedReady) return;',
    );
    expect(filePreviewSource).toContain('(editor as { focus?: () => void }).focus?.();');
    expect(filePreviewSource).toContain('.bn-editor[contenteditable="true"]');
    expect(filePreviewSource).toContain('focus({ preventScroll: true })');
  });

  it('stabilizes compact BlockNote vertical rhythm and disables block transitions', () => {
    expect(css).toMatch(
      /\.bh-card-editor\s+\.bn-block-content[\s\S]*padding:\s*var\(--bh-card-block-pad-y\)\s+0/,
    );
    expect(css).toMatch(/\.bh-card-editor\s+\.bn-block-content[\s\S]*transition:\s*none/);
    expect(css).toMatch(
      /\.bh-card-editor[\s\S]*\.bn-block-outer:first-child[\s\S]*padding-top:\s*0/,
    );
  });

  it('keeps card headings from reverting to browser or BlockNote defaults', () => {
    expect(css).toMatch(
      /\.bh-card-editor\s+\[data-content-type="heading"\][\s\S]*--level:\s*var\(--bh-card-h1-size\)/,
    );
    expect(css).toMatch(
      /\.bh-card-editor\s+\[data-content-type="heading"\]\s*>\s*\.bn-inline-content[\s\S]*font-weight:\s*inherit/,
    );
    expect(css).toMatch(/letter-spacing:\s*0/);
  });
});

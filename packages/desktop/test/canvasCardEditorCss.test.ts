import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../src/workbench/browser/style/workbench.css'), 'utf-8');
const badgeNodeSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/BadgeNode.tsx'),
  'utf-8',
);
const badgePreviewSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/badge-node/BadgePreviews.tsx'),
  'utf-8',
);
const canvasSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/Canvas.tsx'),
  'utf-8',
);
const canvasNodeCommandsSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/useCanvasNodeCommands.ts'),
  'utf-8',
);
const canvasEdgeCommandsSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/useCanvasEdgeCommands.ts'),
  'utf-8',
);
const canvasWorkspaceDataSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/useCanvasWorkspaceData.ts'),
  'utf-8',
);
const canvasSnapGuidesSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/CanvasSnapGuides.tsx'),
  'utf-8',
);
const canvasControlsSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/CanvasControls.tsx'),
  'utf-8',
);
const canvasFlowSnapSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/canvasFlowSnap.ts'),
  'utf-8',
);
const connectionGeometrySource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/canvasConnections/geometry.ts'),
  'utf-8',
);
const connectionEdgesSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/canvasConnections/edges.ts'),
  'utf-8',
);
const connectionHandlesSource = readFileSync(
  join(
    __dirname,
    '../src/workbench/contrib/basehalfCanvas/browser/canvasConnections/CanvasConnectionHandles.tsx',
  ),
  'utf-8',
);
const referenceEdgeSource = readFileSync(
  join(
    __dirname,
    '../src/workbench/contrib/basehalfCanvas/browser/canvasConnections/ReferenceEdge.tsx',
  ),
  'utf-8',
);
const mdEditorSource = readFileSync(
  join(__dirname, '../src/workbench/browser/parts/editor/MdEditor.tsx'),
  'utf-8',
);
const mdRenderSource = readFileSync(
  join(__dirname, '../src/workbench/contrib/basehalfCanvas/browser/badge-node/mdRender.ts'),
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
    // source) via the ONE shared off-screen converter (badge-node/mdRender), emitted as
    // a static sanitized HTML string. This is NOT the live editor — that still
    // mounts only while editing (asserted in the next test). The earlier
    // "raw excerpt at rest" rule was reverted: raw markdown source on the canvas
    // defeats the point of a thinking/notes surface.
    expect(css).toContain('.bh-md-preview');
    expect(badgeNodeSource).toContain("from './badge-node/BadgePreviews.js'");
    expect(badgePreviewSource).toContain('markdownToHtml');
    expect(badgePreviewSource).toContain('<MarkdownPreview label={label} />');
    expect(badgePreviewSource).toContain('className="bh-md-preview"');
    // The HTML is set via innerHTML, so it MUST be sanitized upstream.
    expect(mdRenderSource).toContain('function sanitizeHtml');
    expect(mdRenderSource).toContain('DANGEROUS_TAGS');
    expect(mdRenderSource).toMatch(/sanitizeHtml\(await editor\.blocksToHTMLLossy/);
  });

  it('cards only DISPLAY — no heavy editor ever mounts per tile (edit is the overlay)', () => {
    // The card body is either the badge face or a static preview — never a live
    // BlockNote+Yjs editor. Editing a file happens in the full-canvas editor
    // overlay (double-click), so no ProseMirror editor mounts per .md card (which
    // would jank a large workspace). The card no longer imports MdEditor at all.
    expect(badgeNodeSource).not.toContain('MdEditor');
    expect(badgeNodeSource).not.toContain('inlineEditing');
    expect(badgeNodeSource).toMatch(/showBadgeFace && canShowBadgeFace \? \(\s*<CardBadgeFace/);
    // A changed file's card shows a LIGHTWEIGHT unified-diff preview (plain HTML via
    // <UnifiedDiff>, NOT a monaco editor); otherwise the normal content preview.
    // Both only DISPLAY — no heavy per-tile editor.
    expect(badgeNodeSource).toMatch(
      /\) : showPreview \? \(\s*showFileDiff \? \(\s*<BadgeDiffPreview/,
    );
    expect(badgeNodeSource).toMatch(/\) : \(\s*<BadgePreview/);
    expect(badgePreviewSource).toContain('<UnifiedDiff rows={diff.rows}');
    expect(badgeNodeSource).not.toContain('createDiffEditor');
    expect(badgePreviewSource).not.toContain('createDiffEditor');
    // Size-aware level-of-detail: the WHEN-to-show-what decision is delegated to
    // the pure, unit-tested badge-node/cardLod policy; the component just feeds it the
    // node's measured height and the canvas zoom. A card too small (shrunk) or the
    // canvas zoomed out past the shared threshold collapses to a centred title chip.
    expect(badgeNodeSource).toMatch(
      /import\s*\{[\s\S]*?\bcardLodForHeight\b[\s\S]*?\}\s*from '\.\/badge-node\/cardLod\.js';/,
    );
    expect(badgeNodeSource).toMatch(/return cardLodForHeight\(h, s\.transform\[2\]\);/);
    expect(badgeNodeSource).toMatch(/\{lod === 'mini' \? null :/);
    expect(badgeNodeSource).toMatch(/lod === 'mini' \? \(\s*\/\/[\s\S]*?<CardTitleChip/);
    expect(mdEditorSource).toMatch(/ownerPriority:\s*\(\)\s*=>\s*ownerPriorityRef\.current/);
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
    expect(connectionEdgesSource).toContain('export function canvasEdgesToConnectionEdges');
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
    expect(canvasSource).toContain("from './canvasConnections/index.js'");
    expect(css).toContain('.react-flow__handle.bh-connect-point-handle[data-active="true"]');
    expect(css).toContain('.react-flow__handle.bh-connect-target-handle');
    expect(css).not.toContain('.react-flow__node-badge:hover .react-flow__handle');
    expect(canvasSource).toContain('connectionMode={ConnectionMode.Loose}');
    expect(connectionEdgesSource).toContain('sourceHandle: fromSide');
    expect(connectionEdgesSource).toContain('targetHandle: toSide');
    expect(referenceEdgeSource).toContain('export const ReferenceEdge');
    // The note label reveals on hover/selection — including the no-note state,
    // whose hover label teaches the double-click-to-annotate gesture — and the
    // inline editor branch replaces the label while a note is being written.
    expect(referenceEdgeSource).toContain('{editingNote ? (');
    expect(referenceEdgeSource).toContain('(active || hover) && (');
    expect(referenceEdgeSource).toContain("'Double-click to say why'");
    expect(referenceEdgeSource).toContain('tabIndex={0}');
    expect(referenceEdgeSource).toContain('role="button"');
    expect(referenceEdgeSource).toContain('Press Enter to edit this note');
    expect(referenceEdgeSource).toContain("event.key === 'Delete'");
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
    expect(canvasSource).toContain('useCanvasNodeCommands');
    expect(canvasNodeCommandsSource).toContain('snapFlowNodeChanges');
    expect(canvasNodeCommandsSource).not.toContain('function snapNodeChanges');
    expect(canvasSnapGuidesSource).toContain('<ViewportPortal>');
    expect(canvasSnapGuidesSource).toContain('data-testid="canvas-snap-guide"');
    expect(canvasSnapGuidesSource).toContain('repeating-linear-gradient');
    expect(canvasSnapGuidesSource).toContain('opacity: 0.48');
  });

  it('guards async canvas refreshes against stale workspace and folder context', () => {
    expect(canvasWorkspaceDataSource).toContain('loadContextKeyRef.current !== loadContextKey');
    expect(canvasWorkspaceDataSource).toContain('loadSeqRef.current += 1');
    expect(canvasWorkspaceDataSource).toContain('${currentReachable ??');
    expect(canvasEdgeCommandsSource).toContain('stillShowingContext');
    expect(canvasEdgeCommandsSource).toContain('state.current === workspace');
    expect(canvasEdgeCommandsSource).toContain('state.folderScope ?? null');
  });

  it('names icon-only canvas controls for assistive technology', () => {
    expect(canvasControlsSource).toContain('aria-label={title}');
    expect(canvasControlsSource).toContain('title="Zoom in"');
    expect(canvasControlsSource).toContain('title="Zoom out"');
    expect(canvasControlsSource).toContain('title="Fit to view"');
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

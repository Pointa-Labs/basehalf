import {
  Background,
  ConnectionMode,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type OnSelectionChangeFunc,
  ReactFlow,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type JSX, type MouseEvent as ReactMouseEvent, useCallback, useRef } from 'react';
import { openContextMenu } from '../../../../platform/contextview/browser/contextMenuService.js';
import { prompt } from '../../../../platform/dialogs/browser/dialogService.js';
import { droppedPaths, handleExternalDrop } from '../../../browser/dnd/importDrop.js';
import { useLayoutStore } from '../../../browser/layout/layoutStore.js';
import { color } from '../../../browser/style/design.js';
import { badgeService } from '../../../services/mirror/browser/badgeService.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { isWorkspaceEditorOverlayOpen } from '../../../services/workspace/common/workspaceModel.js';
import { buildFileMenu } from '../../files/browser/fileMenu.js';
import { BadgeNode } from './BadgeNode.js';
import { CanvasControls } from './CanvasControls.js';
import { CanvasSnapGuides } from './CanvasSnapGuides.js';
import type { BadgeNodeData } from './badge-node/badgeNodeModel.js';
import { CanvasChrome } from './canvas/CanvasChrome.js';
import { GhostNoteCard } from './canvas/CanvasEmptyState.js';
import { CanvasFramer, CanvasViewportTracker } from './canvas/CanvasViewportContributions.js';
import { canvasPointForClient } from './canvas/canvasModel.js';
import { CanvasConnectionLine, ReferenceEdge } from './canvasConnections/index.js';
import { useCanvasEdgeCommands } from './useCanvasEdgeCommands.js';
import { useCanvasNodeCommands } from './useCanvasNodeCommands.js';
import { useCanvasViewportModel } from './useCanvasViewportModel.js';
import { useCanvasWorkspaceData } from './useCanvasWorkspaceData.js';

const NODE_TYPES: NodeTypes = { badge: BadgeNode };
const EDGE_TYPES: EdgeTypes = { reference: ReferenceEdge };

export const Canvas = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const currentWorkspaceViewport = useWorkspaceStore((s) => {
    const currentName = s.current;
    return currentName
      ? (s.workspaces.find((w) => w.name === currentName)?.viewport ?? null)
      : null;
  });
  // The editor overlay (opaque, covers this region) is up when a file is open.
  // Its own breadcrumb header then owns navigation, so the canvas's floating
  // chrome (breadcrumb pill, New-note button) hides rather than bleed on top.
  const openFile = useWorkspaceStore((s) => s.openFile);
  const overlayOpen = useWorkspaceStore(isWorkspaceEditorOverlayOpen);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const setCanvasSelection = useWorkspaceStore((s) => s.setCanvasSelection);
  // While a card is being inline-edited, suspend viewport virtualization so a
  // pan/zoom can't cull the editing tile mid-edit (which would cancel its
  // unsaved autosave). Boolean selector → re-renders only on the 0↔1 transition.
  const cardEditing = useWorkspaceStore((s) => s.canvasEditingCardIds.size > 0);
  const sidebarInset = useLayoutStore((s) => (s.sidebarOpen ? s.sidebarWidth : 0));
  // The canvas region's DOM node — drop-position math needs its screen rect.
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const { viewportRef, rootViewportRef, folderScopeRef, onMove, onMoveEnd, onViewport } =
    useCanvasViewportModel({
      canvasRootRef,
      current,
      currentReachable,
      currentWorkspaceViewport,
      folderScope,
      openFile,
    });

  const {
    nodes,
    edges,
    snapGuides,
    error,
    truncated,
    frame,
    nodesRef,
    setNodes,
    setEdges,
    setSnapGuides,
    setError,
  } = useCanvasWorkspaceData({
    current,
    currentReachable,
    currentWorkspaceViewport,
    folderScope,
    rootViewportRef,
  });

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const data = node.data as unknown as BadgeNodeData;
      if (data.kind === 'folder') {
        // Double-clicking a folder badge scopes INTO it — the canvas shows just
        // that folder's contents, and the toolbar offers an explicit context action.
        void setFolderScope(node.id);
        return;
      }
      // File card → open it in the full-canvas editor overlay. The card itself is
      // the canvas preview, so there is no intermediate floating viewer.
      openInPanel(node.id);
    },
    [setFolderScope, openInPanel],
  );

  // Right-click a card → the shared file menu (Open, New File/Folder here, Rename,
  // Delete) targeting that card's file/folder. Rename runs inline on the card
  // (via renamingPath → BadgeNode); new items land in this folder.
  const onNodeContextMenu = useCallback<NodeMouseHandler>(
    (event, node) => {
      event.preventDefault();
      const data = node.data as unknown as BadgeNodeData;
      const kind = data.kind;
      openContextMenu(
        event.clientX,
        event.clientY,
        buildFileMenu({
          target: { path: node.id, kind },
          // New File/Folder is suppressed on cards (see includeCreate): a card can
          // target a folder NOT at the current scope, where the new entry couldn't
          // render to be inline-named. Create from the pane background instead.
          newItemDir: folderScope,
          includeCreate: false,
          onOpen: (t) => (t.kind === 'folder' ? void setFolderScope(t.path) : openInPanel(t.path)),
        }),
      );
    },
    [folderScope, setFolderScope, openInPanel],
  );

  // Right-click empty canvas → New File / New Folder in the folder currently in
  // view (folderScope, null = workspace root).
  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      openContextMenu(event.clientX, event.clientY, buildFileMenu({ newItemDir: folderScope }));
    },
    [folderScope],
  );

  const { onNodesChange, onNodeDragStart, onNodeDragStop } = useCanvasNodeCommands({
    folderScopeRef,
    setNodes,
    setSnapGuides,
    viewportRef,
  });

  const { renderedEdges, onConnect, onEdgesDelete } = useCanvasEdgeCommands({
    edges,
    current,
    folderScope,
    nodesRef,
    setEdges,
    setError,
    setNodes,
  });

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      const data = node.data as unknown as BadgeNodeData;
      if (event.detail >= 2) return;
      if (data.kind === 'folder') {
        setCanvasSelection({ kind: 'folder', folder: node.id, source: 'canvas' });
        return;
      }
      setCanvasSelection({ kind: 'file', files: [node.id], source: 'canvas' });
    },
    [setCanvasSelection],
  );

  const onSelectionChange = useCallback<OnSelectionChangeFunc<Node<BadgeNodeData>, Edge>>(
    ({ nodes: selectedNodes }) => {
      const files = selectedNodes
        .filter((node) => (node.data as unknown as BadgeNodeData).kind !== 'folder')
        .map((node) => node.id);
      if (selectedNodes.length === 0) {
        setCanvasSelection(null);
        return;
      }
      if (files.length > 0) {
        setCanvasSelection({ kind: 'file', files, source: 'canvas' });
        return;
      }
      const folder = selectedNodes[0]?.id;
      setCanvasSelection(folder ? { kind: 'folder', folder, source: 'canvas' } : null);
    },
    [setCanvasSelection],
  );

  // No empty/recovery branch here: Workbench selectRegion owns those — Canvas mounts
  // ONLY for a reachable workspace (region === 'canvas'). The no-workspace case is
  // <Welcome/> and the folder-missing case is <WorkspaceMissing/>, each the sole
  // occupant of the region.

  // Empty canvas → the GHOST NOTE CARD: a dashed card shaped like the real
  // file cards, sitting where the first card would. It doesn't describe the
  // product, it demonstrates it — click and it becomes a real `untitled.md`
  // in the user's folder (no filename dialog), open for typing. The caption
  // names the other first move: drop files in (they're copied, originals
  // stay put). Inside a folder scope the note is created in THAT folder.
  const showGhostCard = nodes.length === 0;

  // Edit the prompt for the CURRENT folder — a scoped subfolder, OR the workspace
  // root itself (the main-canvas prompt). Both are folder badges, so one path
  // serves the canvas root and any sub-canvas. The root folder's rel path is '.'
  // (NOT '' — the shared path guard rejects an empty rel path); path.join
  // normalizes '.' to the same root `.bh/badges/.badge.json`.
  const handleEditFolderPrompt = async (): Promise<void> => {
    const folder = folderScope ?? '.';
    const isRoot = folderScope === null;
    const existing = await badgeService.get(folder, 'folder');
    const next = await prompt({
      title: isRoot ? 'Workspace prompt' : `Folder prompt — /${folder}`,
      body: isRoot
        ? 'What the AI agent should know about this whole workspace — read as the turn intent when you add the workspace to Agent Context. Leave blank to clear.'
        : "What the AI agent should know about this folder — it's read as the turn intent when you add the folder to Agent Context. Leave blank to clear.",
      label: 'Prompt',
      defaultValue: existing?.description ?? '',
      placeholder: isRoot
        ? 'e.g. Research notes for the Q3 launch — start with overview.md'
        : 'e.g. Chapter 3 supporting material — read first',
    });
    if (next === null) return;
    try {
      await badgeService.set(folder, { kind: 'folder', description: next.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleNewNote = useCallback((): void => {
    void useWorkspaceStore.getState().newNote({ folder: folderScope });
  }, [folderScope]);

  return (
    <div
      ref={canvasRootRef}
      style={{ width: '100%', height: '100%' }}
      // OS file drops land ON the map: copy into the workspace folder and
      // place the new card under the cursor. preventDefault (without
      // stopPropagation) marks the drop handled — Workbench's catch-all sees
      // defaultPrevented, clears its overlay, and skips re-routing.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files') || e.defaultPrevented) return;
        e.preventDefault();
        const rect = canvasRootRef.current?.getBoundingClientRect();
        const vp = viewportRef.current;
        const canvasPoint = canvasPointForClient({
          clientX: e.clientX,
          clientY: e.clientY,
          rect,
          viewport: vp,
        });
        void (async () => {
          await handleExternalDrop(await droppedPaths(e.dataTransfer), {
            canvasPoint,
            folderScope,
          });
        })();
      }}
    >
      <CanvasChrome
        overlayOpen={overlayOpen}
        sidebarInset={sidebarInset}
        folderScope={folderScope}
        error={error}
        truncated={truncated}
        onEditFolderPrompt={() => void handleEditFolderPrompt()}
        onNewNote={handleNewNote}
      />
      {showGhostCard && <GhostNoteCard folderScope={folderScope} />}
      <ReactFlow
        nodes={nodes}
        edges={renderedEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onPaneClick={() => setCanvasSelection(null)}
        // Trackpad-native viewport (the design-tool model): a two-finger swipe
        // pans, a pinch zooms. macOS emits a pinch as a ctrl+wheel event, which
        // React Flow routes to zoom even while panOnScroll is on; a plain
        // two-finger swipe (no ctrl) pans. zoomOnScroll is OFF so a bare scroll
        // never zooms out from under the user.
        panOnScroll
        // 1:1 finger tracking. React Flow's default panOnScrollSpeed is 0.5, so
        // the canvas travels only half the trackpad delta — the "lagging behind
        // my fingers" feel. 1 maps a two-finger swipe directly to the pan.
        panOnScrollSpeed={1}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick
        // Left-drag on the empty pane draws a selection box (panning moved to the
        // trackpad + middle/right mouse). Partial = a card is picked when the box
        // TOUCHES it (forgiving), not only when fully enclosed. Mouse users still
        // pan with middle/right drag.
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        multiSelectionKeyCode="Shift"
        // All edges render through the canvasConnections ReferenceEdge (see EDGE_TYPES): the line is
        // always visible, the note reveals on hover/selection — no colliding
        // always-on midpoint labels. Animation off; the custom edge owns its
        // stroke + accent-on-interaction styling AND draws its own arrowhead as
        // part of the same stroke (no marker — see ReferenceEdge), so the line
        // and its tip are one continuous pen stroke, not a triangle glued on.
        defaultEdgeOptions={{
          type: 'reference',
          animated: false,
        }}
        // The live drag previews the same side-midpoint snap that will be
        // saved on drop, so the line never appears to float beside a card.
        connectionLineComponent={CanvasConnectionLine}
        connectionLineStyle={{ stroke: color.accent, strokeWidth: 2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={4}
        // Only mount nodes inside the viewport. A folder with many direct children
        // can hold lots of badges; without this, every one mounts (and every
        // markdown card's editor with it) even far off-screen. Nodes carry
        // initialWidth/initialHeight (see badgeToNode) so culling has bounds before
        // measurement. SUSPENDED while a card is being inline-edited, so a pan/zoom
        // can't cull the editing tile and cancel its unsaved autosave.
        onlyRenderVisibleElements={!cardEditing}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={color.border} />
        <CanvasViewportTracker onViewport={onViewport} />
        <CanvasSnapGuides guides={snapGuides} />
        <CanvasControls />
        <CanvasFramer frame={frame} />
      </ReactFlow>
    </div>
  );
};

// Re-export useReactFlow so children can re-center programmatically later.
export { useReactFlow } from '@xyflow/react';

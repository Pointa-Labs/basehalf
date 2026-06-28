import {
  type Viewport,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useViewport,
} from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { ViewportState } from '../../../../../platform/workspaces/common/workspaces.js';
import { useLayoutStore } from '../../../../browser/layout/layoutStore.js';

export const CanvasViewportTracker = ({
  onViewport,
}: { onViewport: (viewport: Viewport) => void }): null => {
  const viewport = useViewport();
  useEffect(() => {
    onViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
  }, [onViewport, viewport.x, viewport.y, viewport.zoom]);
  return null;
};

/**
 * Frames the canvas after each refresh. Rendered inside <ReactFlow> so the
 * hooks have a provider. For every refresh (identified by `frame.key`) it
 * applies exactly once, but only after `useNodesInitialized` reports the
 * current nodes have measured dimensions.
 *
 * - saved viewport present -> RESTORE it (reload / re-open keeps your place)
 * - no saved viewport -> FIT to all badges
 */
export const CanvasFramer = ({
  frame,
}: { frame: { key: string; vp: ViewportState | null } | null }): null => {
  const { setViewport, fitView, getNodes } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  // React Flow's measured pane width. It can keep SETTLING for a beat after the
  // nodes initialize, so the fit waits for it to stabilize.
  const rfWidth = useStore((s) => s.width);
  // The sidebar FLOATS over the canvas's left, so `main` spans the full width
  // INCLUDING the area the sidebar covers. Inset the fit by the sidebar width so
  // a fresh fit lands content in the VISIBLE region.
  const sidebarInset = useLayoutStore((s) => (s.sidebarOpen ? s.sidebarWidth : 0));
  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!frame || !nodesInitialized || rfWidth === 0) return;
    // Frame once per context. Same-key refreshes must not yank the canvas out
    // from under the user mid-work.
    if (framedKey.current === frame.key) return;
    const t = setTimeout(() => {
      framedKey.current = frame.key;
      if (frame.vp) {
        setViewport({ x: frame.vp.offsetX, y: frame.vp.offsetY, zoom: frame.vp.scale });
      } else if (getNodes().length > 0) {
        // Cap the left inset so it can never exceed the pane width; leave at
        // least 160px for the content itself.
        const leftPx = Math.min(sidebarInset + 32, Math.max(0, rfWidth - 160));
        const padding =
          leftPx > 0
            ? { top: 0.2, right: 0.2, bottom: 0.2, left: `${leftPx}px` as `${number}px` }
            : 0.2;
        void fitView({ padding, maxZoom: 1, duration: 0 });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [frame, nodesInitialized, rfWidth, setViewport, fitView, getNodes, sidebarInset]);
  return null;
};

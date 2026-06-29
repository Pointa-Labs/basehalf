import type { Viewport } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { focusService } from '../../../services/mirror/browser/focusService.js';
import { mirrorWritesSuspended } from '../../../services/mirror/browser/mirrorWrites.js';
import {
  type WorkspaceCanvasViewportState,
  workspaceCanvasDataService,
} from '../../../services/workspace/browser/workspaceCanvasDataService.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import {
  VIEWPORT_DEBOUNCE,
  debounce,
  shouldPersistWorkspaceViewport,
} from './canvas/canvasModel.js';

export interface CanvasViewportModel {
  readonly viewportRef: MutableRefObject<Viewport>;
  readonly rootViewportRef: MutableRefObject<WorkspaceCanvasViewportState | null>;
  readonly folderScopeRef: MutableRefObject<string | null>;
  readonly onMove: (_event: unknown, viewport: Viewport) => void;
  readonly onMoveEnd: (_event: unknown, viewport: Viewport) => void;
  readonly onViewport: (viewport: Viewport) => void;
}

export function useCanvasViewportModel({
  canvasRootRef,
  current,
  currentReachable,
  currentWorkspaceViewport,
  folderScope,
  openFile,
}: {
  readonly canvasRootRef: MutableRefObject<HTMLDivElement | null>;
  readonly current: string | null;
  readonly currentReachable: boolean | null;
  readonly currentWorkspaceViewport: WorkspaceCanvasViewportState | null;
  readonly folderScope: string | null;
  readonly openFile: string | null;
}): CanvasViewportModel {
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const rootViewportRef = useRef<WorkspaceCanvasViewportState | null>(null);
  const rootViewportWorkspaceRef = useRef<string | null>(current);
  const folderScopeRef = useRef<string | null>(folderScope);

  useEffect(() => {
    folderScopeRef.current = folderScope;
  }, [folderScope]);

  useEffect(() => {
    if (rootViewportWorkspaceRef.current !== current) {
      rootViewportWorkspaceRef.current = current;
      rootViewportRef.current = currentWorkspaceViewport;
      return;
    }
    rootViewportRef.current = currentWorkspaceViewport;
  }, [current, currentWorkspaceViewport]);

  useEffect(() => {
    if (!current || !currentReachable) return;
    const node = openFile
      ? { path: openFile, kind: 'file' as const }
      : { path: folderScope ?? '', kind: 'folder' as const };
    if (!mirrorWritesSuspended()) {
      void focusService.set(node).catch(() => undefined);
    }
  }, [current, currentReachable, folderScope, openFile]);

  const persistViewport = useMemo(
    () =>
      debounce((viewport: WorkspaceCanvasViewportState) => {
        if (mirrorWritesSuspended()) return;
        void workspaceCanvasDataService.setViewport(viewport).catch(() => undefined);
      }, VIEWPORT_DEBOUNCE),
    [],
  );

  const persistFolderFocus = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (viewport: Viewport, folderScopeAtPan: string | null): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (mirrorWritesSuspended()) return;
        const st = useWorkspaceStore.getState();
        if (st.openFile || !st.current || st.currentReachable === false) return;
        if ((st.folderScope ?? null) !== folderScopeAtPan) return;
        const rect = canvasRootRef.current?.getBoundingClientRect();
        if (!rect) return;
        const viewport_center = {
          x: Math.round((rect.width / 2 - viewport.x) / viewport.zoom),
          y: Math.round((rect.height / 2 - viewport.y) / viewport.zoom),
        };
        void focusService
          .set({
            path: folderScopeAtPan ?? '',
            kind: 'folder',
            viewport_center,
            zoom: Number(viewport.zoom.toFixed(3)),
          })
          .catch(() => undefined);
      }, VIEWPORT_DEBOUNCE);
    };
    const cancel = (): void => {
      if (timer) clearTimeout(timer);
    };
    return { schedule, cancel };
  }, [canvasRootRef]);

  useEffect(() => () => persistFolderFocus.cancel(), [persistFolderFocus]);

  const writeZoomVar = useCallback(
    (zoom: number) => {
      canvasRootRef.current?.style.setProperty('--bh-zoom', String(zoom));
    },
    [canvasRootRef],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      viewportRef.current = viewport;
      writeZoomVar(viewport.zoom);
      const viewportState = { offsetX: viewport.x, offsetY: viewport.y, scale: viewport.zoom };
      if (shouldPersistWorkspaceViewport(folderScopeRef.current)) {
        rootViewportRef.current = viewportState;
        persistViewport(viewportState);
      }
      persistFolderFocus.schedule(viewport, folderScopeRef.current);
    },
    [persistViewport, persistFolderFocus, writeZoomVar],
  );

  const onMove = useCallback(
    (_event: unknown, viewport: Viewport) => {
      viewportRef.current = viewport;
      writeZoomVar(viewport.zoom);
    },
    [writeZoomVar],
  );

  const onViewport = useCallback(
    (viewport: Viewport) => {
      viewportRef.current = viewport;
      writeZoomVar(viewport.zoom);
    },
    [writeZoomVar],
  );

  return {
    viewportRef,
    rootViewportRef,
    folderScopeRef,
    onMove,
    onMoveEnd,
    onViewport,
  };
}

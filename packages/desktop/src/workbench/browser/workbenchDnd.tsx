import { type DragEvent, type JSX, useState } from 'react';
import { droppedPaths, handleExternalDrop } from './dnd/importDrop.js';
import { color, font, motion, radius, space } from './style/design.js';

export interface WorkbenchDropTarget {
  readonly isActive: boolean;
  readonly rootProps: {
    readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
    readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
    readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

/**
 * Workbench-level file drop handling, mirroring VS Code's dedicated
 * `workbench/browser/dnd.ts`: layout owns the drop zone, while shared import
 * routing decides whether folders become workspaces or files are copied in.
 */
export function useWorkbenchDropTarget(): WorkbenchDropTarget {
  const [dragDepth, setDragDepth] = useState(0);

  return {
    isActive: dragDepth > 0,
    rootProps: {
      onDragEnter: (event) => {
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      },
      onDragLeave: (event) => {
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setDragDepth((depth) => Math.max(0, depth - 1));
      },
      onDragOver: (event) => {
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDrop: (event) => {
        if (!isExternalFileDrag(event)) return;
        setDragDepth(0);
        if (event.defaultPrevented) return;
        event.preventDefault();
        void (async () => {
          await handleExternalDrop(await droppedPaths(event.dataTransfer));
        })();
      },
    },
  };
}

export function WorkbenchDropOverlay({
  current,
  visible,
}: {
  readonly current: string | null;
  readonly visible: boolean;
}): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(40, 100, 200, 0.08)',
        border: `3px dashed ${color.accent}`,
        zIndex: 200,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: `bh-fade-in ${motion.fast}`,
      }}
    >
      <div
        style={{
          background: color.surface,
          borderRadius: radius.xl,
          padding: `${space[4]}px ${space[6]}px`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          fontFamily: font.sans,
          fontSize: font.size.body,
          color: color.textPrimary,
          fontWeight: font.weight.medium,
          letterSpacing: -0.1,
        }}
      >
        {current
          ? 'Drop files to copy them into this workspace — or a folder to open as a workspace'
          : 'Drop a folder to add as a workspace'}
      </div>
    </div>
  );
}

function isExternalFileDrag(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes('Files');
}

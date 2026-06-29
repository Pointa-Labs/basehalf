import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
import { color, radius, space, transition } from '../../../browser/style/design.js';
import { type FocusDir, dropEdge } from '../common/terminalTree.js';
import { useTerminalStore } from './terminalStore.js';

const HANDLE_REVEAL_FACTOR = 0.2;

export const TerminalPaneGrabHandle = ({ paneId }: { paneId: string }): JSX.Element => {
  const setPaneDrag = useTerminalStore((s) => s.setPaneDrag);
  const dragging = useTerminalStore((s) => s.paneDrag?.paneId === paneId);
  const ref = useRef<HTMLDivElement | null>(null);
  const [nearTop, setNearTop] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const pane = ref.current?.parentElement;
    if (!pane) return;
    const onMove = (event: MouseEvent): void => {
      const box = pane.getBoundingClientRect();
      setNearTop(event.clientY - box.top <= Math.max(24, box.height * HANDLE_REVEAL_FACTOR));
    };
    const onLeave = (): void => setNearTop(false);
    pane.addEventListener('mousemove', onMove);
    pane.addEventListener('mouseleave', onLeave);
    return () => {
      pane.removeEventListener('mousemove', onMove);
      pane.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const shown = nearTop || hover || dragging;
  return (
    <div
      ref={ref}
      draggable={shown}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-bh-term-pane', paneId);
        setPaneDrag({ paneId });
      }}
      onDragEnd={() => setPaneDrag(null)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Drag to move this pane"
      aria-label="Move pane"
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        minWidth: 20,
        height: 11,
        padding: `0 ${space[1]}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        borderRadius: '0 0 7px 7px',
        color: hover ? '#fff' : 'rgba(255,255,255,0.6)',
        background: hover ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.06)',
        opacity: shown ? 1 : 0,
        pointerEvents: shown ? 'auto' : 'none',
        transition: transition(['opacity', 'background', 'color']),
        zIndex: 4,
      }}
    >
      <span aria-hidden style={{ fontSize: 10, lineHeight: 1, letterSpacing: 1 }}>
        ⋯
      </span>
    </div>
  );
};

export const TerminalPaneDropZones = ({ destPaneId }: { destPaneId: string }): JSX.Element => {
  const movePane = useTerminalStore((s) => s.movePane);
  const ref = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState<FocusDir | null>(null);
  return (
    <div
      ref={ref}
      onDragOver={(event) => {
        if (!useTerminalStore.getState().paneDrag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const box = ref.current?.getBoundingClientRect();
        if (!box || box.width === 0 || box.height === 0) return;
        setEdge(
          dropEdge((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height),
        );
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEdge(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const drag = useTerminalStore.getState().paneDrag;
        if (drag && edge) movePane(drag.paneId, edge, destPaneId);
        setEdge(null);
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'auto' }}
    >
      {edge && <PaneDropPreview edge={edge} />}
    </div>
  );
};

const PaneDropPreview = ({ edge }: { edge: FocusDir }): JSX.Element => {
  const box: CSSProperties =
    edge === 'left'
      ? { left: 0, top: 0, bottom: 0, width: '50%' }
      : edge === 'right'
        ? { right: 0, top: 0, bottom: 0, width: '50%' }
        : edge === 'up'
          ? { left: 0, right: 0, top: 0, height: '50%' }
          : { left: 0, right: 0, bottom: 0, height: '50%' };
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        ...box,
        background: `${color.accent}33`,
        border: `1.5px solid ${color.accent}`,
        borderRadius: radius.sm,
        pointerEvents: 'none',
        transition: transition(['left', 'right', 'top', 'bottom', 'width', 'height']),
      }}
    />
  );
};

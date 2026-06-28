import { Handle, useConnection, useUpdateNodeInternals } from '@xyflow/react';
import {
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { color } from '../../../../browser/style/design.js';
import {
  CANVAS_CONNECTION_POINT_SIZE,
  CANVAS_CONNECTION_SIDES,
  CANVAS_CONNECTION_SIDE_POSITION,
  CANVAS_CONNECTION_TARGET_HIT_DEPTH,
  type CanvasConnectionAffordance,
  sameConnectionAffordance,
  sourceAffordanceForPointer,
  targetAffordanceForPoint,
} from './geometry.js';

type UseCanvasConnectionHandlesResult = {
  readonly cardRef: RefObject<HTMLDivElement | null>;
  readonly connectionInProgress: boolean;
  readonly sourceAffordance: CanvasConnectionAffordance | null;
  readonly targetAffordance: CanvasConnectionAffordance | null;
  readonly targetInteractive: boolean;
  readonly onCardPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onCardPointerLeave: () => void;
};

export function useCanvasConnectionHandles({
  disabled,
  nodeId,
}: {
  readonly disabled: boolean;
  readonly nodeId: string;
}): UseCanvasConnectionHandlesResult {
  const updateNodeInternals = useUpdateNodeInternals();
  const connectionState = useConnection((connection) => ({
    fromNodeId: connection.fromNode?.id ?? null,
    inProgress: connection.inProgress,
  }));
  const connectionInProgress = connectionState.inProgress;
  const connectionFromThisNode = connectionState.fromNodeId === nodeId;
  const targetInteractive = connectionInProgress && !connectionFromThisNode && !disabled;
  const cardRef = useRef<HTMLDivElement>(null);
  const [sourceAffordance, setSourceAffordance] = useState<CanvasConnectionAffordance | null>(null);
  const [targetAffordance, setTargetAffordance] = useState<CanvasConnectionAffordance | null>(null);
  const sourceAffordanceKey = sourceAffordance ?? 'none';
  const targetAffordanceKey = targetAffordance ?? 'none';

  const setNextSourceAffordance = useCallback((next: CanvasConnectionAffordance | null) => {
    setSourceAffordance((prev) => (sameConnectionAffordance(prev, next) ? prev : next));
  }, []);

  const setNextTargetAffordance = useCallback((next: CanvasConnectionAffordance | null) => {
    setTargetAffordance((prev) => (sameConnectionAffordance(prev, next) ? prev : next));
  }, []);

  const onCardPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) {
        setNextSourceAffordance(null);
        return;
      }
      setNextSourceAffordance(
        sourceAffordanceForPointer({
          target: event.target,
          card: event.currentTarget,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    },
    [disabled, setNextSourceAffordance],
  );

  const onCardPointerLeave = useCallback(() => {
    setNextSourceAffordance(null);
  }, [setNextSourceAffordance]);

  useEffect(() => {
    if (disabled) setNextSourceAffordance(null);
  }, [disabled, setNextSourceAffordance]);

  useEffect(() => {
    void sourceAffordanceKey;
    void targetAffordanceKey;
    updateNodeInternals(nodeId);
  }, [nodeId, sourceAffordanceKey, targetAffordanceKey, updateNodeInternals]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => updateNodeInternals(nodeId));
    });
    observer.observe(card);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [nodeId, updateNodeInternals]);

  useEffect(() => {
    if (!targetInteractive) {
      setNextTargetAffordance(null);
      return;
    }

    const pointFromEvent = (
      event: MouseEvent | TouchEvent,
    ): { clientX: number; clientY: number } | null => {
      if ('touches' in event) {
        const touch = event.touches[0] ?? event.changedTouches[0];
        return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
      }
      return { clientX: event.clientX, clientY: event.clientY };
    };

    const updateTargetAffordance = (event: MouseEvent | TouchEvent): void => {
      const point = pointFromEvent(event);
      const rect = cardRef.current?.getBoundingClientRect();
      setNextTargetAffordance(
        point && rect ? targetAffordanceForPoint(rect, point.clientX, point.clientY) : null,
      );
    };

    window.addEventListener('mousemove', updateTargetAffordance, true);
    window.addEventListener('touchmove', updateTargetAffordance, true);
    return () => {
      window.removeEventListener('mousemove', updateTargetAffordance, true);
      window.removeEventListener('touchmove', updateTargetAffordance, true);
    };
  }, [setNextTargetAffordance, targetInteractive]);

  return {
    cardRef,
    connectionInProgress,
    sourceAffordance,
    targetAffordance,
    targetInteractive,
    onCardPointerMove,
    onCardPointerLeave,
  };
}

function connectPointStyle(
  side: CanvasConnectionAffordance,
  active: boolean,
  interactive: boolean,
  layer: number,
): CSSProperties {
  const scale = active ? 1.15 : 1;
  const base: CSSProperties = {
    width: CANVAS_CONNECTION_POINT_SIZE,
    height: CANVAS_CONNECTION_POINT_SIZE,
    background: active ? color.accent : color.surface,
    border: `2px solid ${active ? color.accentSoft : color.textTertiary}`,
    opacity: active ? 1 : 0,
    pointerEvents: active && interactive ? 'auto' : 'none',
    zIndex: layer,
  };

  if (side === 'top') {
    return {
      ...base,
      top: 0,
      left: '50%',
      transform: `translate(-50%, -50%) scale(${scale})`,
    };
  }
  if (side === 'right') {
    return {
      ...base,
      top: '50%',
      right: 0,
      transform: `translate(50%, -50%) scale(${scale})`,
    };
  }
  if (side === 'bottom') {
    return {
      ...base,
      bottom: 0,
      left: '50%',
      transform: `translate(-50%, 50%) scale(${scale})`,
    };
  }
  return {
    ...base,
    top: '50%',
    left: 0,
    transform: `translate(-50%, -50%) scale(${scale})`,
  };
}

function connectTargetHitStyle(
  side: CanvasConnectionAffordance,
  enabled: boolean,
  layer: number,
): CSSProperties {
  const base: CSSProperties = {
    background: 'transparent',
    border: '0 solid transparent',
    borderRadius: 0,
    opacity: 0,
    pointerEvents: enabled ? 'auto' : 'none',
    zIndex: layer,
  };

  if (side === 'top') {
    return {
      ...base,
      top: 0,
      left: '50%',
      width: `calc(100% + ${CANVAS_CONNECTION_TARGET_HIT_DEPTH}px)`,
      height: CANVAS_CONNECTION_TARGET_HIT_DEPTH * 2,
      transform: 'translate(-50%, -50%)',
    };
  }
  if (side === 'right') {
    return {
      ...base,
      top: '50%',
      right: 0,
      width: CANVAS_CONNECTION_TARGET_HIT_DEPTH * 2,
      height: `calc(100% - ${CANVAS_CONNECTION_TARGET_HIT_DEPTH * 2}px)`,
      transform: 'translate(50%, -50%)',
    };
  }
  if (side === 'bottom') {
    return {
      ...base,
      bottom: 0,
      left: '50%',
      width: `calc(100% + ${CANVAS_CONNECTION_TARGET_HIT_DEPTH}px)`,
      height: CANVAS_CONNECTION_TARGET_HIT_DEPTH * 2,
      transform: 'translate(-50%, 50%)',
    };
  }
  return {
    ...base,
    top: '50%',
    left: 0,
    width: CANVAS_CONNECTION_TARGET_HIT_DEPTH * 2,
    height: `calc(100% - ${CANVAS_CONNECTION_TARGET_HIT_DEPTH * 2}px)`,
    transform: 'translate(-50%, -50%)',
  };
}

export const CanvasConnectionHandles = ({
  connectionInProgress,
  disabled,
  sourceAffordance,
  targetAffordance,
  targetInteractive,
}: {
  readonly connectionInProgress: boolean;
  readonly disabled: boolean;
  readonly sourceAffordance: CanvasConnectionAffordance | null;
  readonly targetAffordance: CanvasConnectionAffordance | null;
  readonly targetInteractive: boolean;
}): JSX.Element => (
  <>
    {CANVAS_CONNECTION_SIDES.map((side) => {
      const active = sourceAffordance === side && !disabled;
      return (
        <Handle
          key={`source-${side}`}
          type="source"
          id={side}
          position={CANVAS_CONNECTION_SIDE_POSITION[side]}
          className="bh-connect-handle bh-connect-point-handle"
          data-active={active ? 'true' : 'false'}
          title={`Connect from ${side}`}
          isConnectableEnd={false}
          style={connectPointStyle(side, active, !connectionInProgress, 21)}
        />
      );
    })}
    {CANVAS_CONNECTION_SIDES.map((side) => {
      const targetActive = targetAffordance === side && !disabled;
      return (
        <Handle
          key={`target-${side}`}
          type="target"
          id={side}
          position={CANVAS_CONNECTION_SIDE_POSITION[side]}
          className="bh-connect-handle bh-connect-target-handle"
          data-active={targetActive ? 'true' : 'false'}
          isConnectableStart={false}
          isConnectableEnd={targetInteractive}
          style={connectTargetHitStyle(side, targetInteractive, 20)}
        />
      );
    })}
  </>
);

export { CanvasConnectionLine } from './CanvasConnectionLine.js';
export {
  CanvasConnectionHandles,
  useCanvasConnectionHandles,
} from './CanvasConnectionHandles.js';
export { ReferenceEdge } from './ReferenceEdge.js';
export {
  applyReferenceEdgeUpdate,
  canvasEdgesToConnectionEdges,
  inferConnectionSides,
  referenceEdgeId,
  removeReferenceEdgeUpdate,
  sideFromHandle,
} from './edges.js';
export type { ReferenceEdgeRemoval, ReferenceEdgeUpdate } from './edges.js';
export {
  ANCHOR_TO_SIDE,
  CANVAS_CONNECTION_POINT_SIZE,
  CANVAS_CONNECTION_SIDES,
  CANVAS_CONNECTION_SIDE_POSITION,
  CANVAS_CONNECTION_TARGET_HIT_DEPTH,
  SIDE_TO_ANCHOR,
  connectionPointForBoxSide,
  connectionPointForRectSide,
  distanceToRect,
  sameConnectionAffordance,
  sourceAffordanceForPointer,
  targetAffordanceForPoint,
} from './geometry.js';
export type { CanvasConnectionAffordance, CanvasConnectionSide, CanvasSide } from './geometry.js';

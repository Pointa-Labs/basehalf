export { CanvasConnectionLine } from './CanvasConnectionLine.js';
export {
  CanvasConnectionHandles,
  useCanvasConnectionHandles,
} from './CanvasConnectionHandles.js';
export { ReferenceEdge } from './ReferenceEdge.js';
export {
  applyReferenceEdgeUpdate,
  badgesToConnectionEdges,
  inferConnectionSides,
  referenceEdgeId,
  removeReferenceEdgeUpdate,
  sideFromHandle,
} from './edges.js';
export type { ReferenceEdgeRemoval, ReferenceEdgeUpdate } from './edges.js';
export {
  CANVAS_CONNECTION_POINT_SIZE,
  CANVAS_CONNECTION_SIDES,
  CANVAS_CONNECTION_SIDE_POSITION,
  CANVAS_CONNECTION_TARGET_HIT_DEPTH,
  connectionPointForBoxSide,
  connectionPointForRectSide,
  distanceToRect,
  sameConnectionAffordance,
  sourceAffordanceForPointer,
  targetAffordanceForPoint,
} from './geometry.js';
export type { CanvasConnectionAffordance, CanvasConnectionSide } from './geometry.js';

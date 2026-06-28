import type { CanvasMirrorService as CanvasMirrorServiceContract } from '../common/canvas.js';
import { type CanvasChannel, canvasChannel } from './canvasChannel.js';

export type { CanvasMirrorService } from '../common/canvas.js';

export function createCanvasMirrorService(channel: CanvasChannel): CanvasMirrorServiceContract {
  return {
    setCard: (folder, card) => channel.setCard({ folder, card }),
    connect: (args) => channel.connect(args),
    disconnect: (args) => channel.disconnect(args),
    reconnect: (args) => channel.reconnect(args),
  };
}

export const canvasMirrorService = createCanvasMirrorService(canvasChannel);

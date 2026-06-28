import type {
  CanvasCard,
  CanvasConnectArgs,
  CanvasDisconnectArgs,
  CanvasFile,
  CanvasReconnectArgs,
} from '../common/canvas.js';
import { type CanvasChannel, canvasChannel } from './canvasChannel.js';

export interface CanvasMirrorService {
  setCard(folder: string | null, card: CanvasCard): Promise<CanvasFile>;
  connect(args: CanvasConnectArgs): Promise<CanvasFile>;
  disconnect(args: CanvasDisconnectArgs): Promise<CanvasFile>;
  reconnect(args: CanvasReconnectArgs): Promise<CanvasFile>;
}

export function createCanvasMirrorService(channel: CanvasChannel): CanvasMirrorService {
  return {
    setCard: (folder, card) => channel.setCard({ folder, card }),
    connect: (args) => channel.connect(args),
    disconnect: (args) => channel.disconnect(args),
    reconnect: (args) => channel.reconnect(args),
  };
}

export const canvasMirrorService = createCanvasMirrorService(canvasChannel);

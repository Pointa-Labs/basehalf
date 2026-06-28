import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type { CanvasChannelBridge } from '../common/canvas.js';

export interface CanvasChannel extends CanvasChannelBridge {}

export function createCanvasChannel(bridge: BaseHalfSandboxApi): CanvasChannel {
  return bridge.canvas;
}

export const canvasChannel: CanvasChannel = createLazySandboxChannel(createCanvasChannel);

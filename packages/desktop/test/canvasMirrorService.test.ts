import { describe, expect, it } from 'vitest';
import type { CanvasChannel } from '../src/workbench/services/mirror/browser/canvasChannel.js';
import { createCanvasMirrorService } from '../src/workbench/services/mirror/browser/canvasMirrorService.js';

describe('canvasMirrorService', () => {
  it('maps canvas mirror operations to the canvas channel contract', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const canvas = { path: '', cards: [], edges: [] };
    const service = createCanvasMirrorService({
      setCard: async (args) => {
        calls.push({ name: 'setCard', args });
        return canvas;
      },
      connect: async (args) => {
        calls.push({ name: 'connect', args });
        return canvas;
      },
      disconnect: async (args) => {
        calls.push({ name: 'disconnect', args });
        return canvas;
      },
      reconnect: async (args) => {
        calls.push({ name: 'reconnect', args });
        return canvas;
      },
    } as CanvasChannel);

    const card = { path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 3, height: 4 };
    const edge = {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east' as const,
      to_anchor: 'west' as const,
      kind: 'file' as const,
    };

    expect(await service.setCard(null, card)).toBe(canvas);
    expect(await service.connect(edge)).toBe(canvas);
    expect(await service.disconnect({ folder: null, from: 'a.md', to: 'b.md' })).toBe(canvas);
    expect(
      await service.reconnect({
        folder: null,
        previous: { from: 'a.md', to: 'b.md' },
        next: {
          from: 'a.md',
          to: 'c.md',
          from_anchor: 'south',
          to_anchor: 'north',
          kind: 'file',
        },
      }),
    ).toBe(canvas);

    expect(calls).toEqual([
      { name: 'setCard', args: { folder: null, card } },
      { name: 'connect', args: edge },
      { name: 'disconnect', args: { folder: null, from: 'a.md', to: 'b.md' } },
      {
        name: 'reconnect',
        args: {
          folder: null,
          previous: { from: 'a.md', to: 'b.md' },
          next: {
            from: 'a.md',
            to: 'c.md',
            from_anchor: 'south',
            to_anchor: 'north',
            kind: 'file',
          },
        },
      },
    ]);
  });

  it('keeps null root folders explicit at the channel boundary', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const canvas = { path: '', cards: [], edges: [] };
    const service = createCanvasMirrorService({
      setCard: async (args) => {
        calls.push({ name: 'setCard', args });
        return canvas;
      },
    } as CanvasChannel);
    const card = { path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 3, height: 4 };
    await service.setCard(null, card);

    expect(calls).toEqual([{ name: 'setCard', args: { folder: null, card } }]);
  });
});

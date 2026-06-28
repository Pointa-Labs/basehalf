import { describe, expect, it } from 'vitest';
import type { FocusChannel } from '../src/workbench/services/mirror/browser/focusChannel.js';
import { createFocusService } from '../src/workbench/services/mirror/browser/focusService.js';

describe('focusService', () => {
  it('maps focus operations to the focus channel', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const node = {
      path: 'docs',
      kind: 'folder' as const,
      viewport_center: { x: 1, y: 2 },
      zoom: 0.5,
    };
    const channel: FocusChannel = {
      set: async (args) => {
        calls.push({ name: 'set', args });
        return args;
      },
      get: async () => null,
      clear: async () => ({ cleared: true }),
      pruneDangling: async () => {
        calls.push({ name: 'pruneDangling' });
        return { cleared: true };
      },
      relocate: async () => ({ moved: 0, repointed: false }),
      purgeNode: async () => ({ removed: 0, cleared: false }),
    };
    const service = createFocusService(channel);

    expect(await service.set(node)).toEqual(node);
    expect(await service.pruneDangling()).toEqual({ cleared: true });

    expect(calls).toEqual([{ name: 'set', args: node }, { name: 'pruneDangling' }]);
  });
});

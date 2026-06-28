import { describe, expect, it } from 'vitest';
import { createUpdateService } from '../src/platform/update/browser/updateService.js';

describe('updateService', () => {
  it('maps self-update operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const handler = (): void => {};
    const unsubscribe = (): void => {};
    const service = createUpdateService({
      getState: async () => {
        calls.push({ name: 'getState', args: [] });
        return { phase: 'idle' };
      },
      check: async () => {
        calls.push({ name: 'check', args: [] });
      },
      download: async () => {
        calls.push({ name: 'download', args: [] });
      },
      install: async () => {
        calls.push({ name: 'install', args: [] });
      },
      justInstalled: async () => {
        calls.push({ name: 'justInstalled', args: [] });
        return { version: '1.2.3', notes: 'Done' };
      },
      onState: (fn) => {
        calls.push({ name: 'onState', args: [fn] });
        return unsubscribe;
      },
    });

    expect(await service.getState()).toEqual({ phase: 'idle' });
    await service.check();
    await service.download();
    await service.install();
    expect(await service.justInstalled()).toEqual({ version: '1.2.3', notes: 'Done' });
    expect(service.onState(handler)).toBe(unsubscribe);

    expect(calls).toEqual([
      { name: 'getState', args: [] },
      { name: 'check', args: [] },
      { name: 'download', args: [] },
      { name: 'install', args: [] },
      { name: 'justInstalled', args: [] },
      { name: 'onState', args: [handler] },
    ]);
  });
});

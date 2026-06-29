import { describe, expect, it } from 'vitest';
import { createTerminalService } from '../src/workbench/services/terminal/browser/terminalService.js';

describe('terminalService', () => {
  it('maps terminal session operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const onData = (): void => {};
    const onExit = (): void => {};
    const unsubscribe = (): void => {};
    const service = createTerminalService({
      spawn: async (opts) => {
        calls.push({ name: 'spawn', args: [opts] });
        return { id: '1', cwd: '/tmp/demo' };
      },
      write: (id, data) => {
        calls.push({ name: 'write', args: [id, data] });
      },
      resize: (id, cols, rows) => {
        calls.push({ name: 'resize', args: [id, cols, rows] });
      },
      kill: (id) => {
        calls.push({ name: 'kill', args: [id] });
      },
      onData: (handler) => {
        calls.push({ name: 'onData', args: [handler] });
        return unsubscribe;
      },
      onExit: (handler) => {
        calls.push({ name: 'onExit', args: [handler] });
        return unsubscribe;
      },
    });

    expect(await service.spawn({ cols: 80, rows: 24 })).toEqual({ id: '1', cwd: '/tmp/demo' });
    service.write('1', 'a');
    service.resize('1', 100, 30);
    service.kill('1');
    expect(service.onData(onData)).toBe(unsubscribe);
    expect(service.onExit(onExit)).toBe(unsubscribe);

    expect(calls).toEqual([
      { name: 'spawn', args: [{ cols: 80, rows: 24 }] },
      { name: 'write', args: ['1', 'a'] },
      { name: 'resize', args: ['1', 100, 30] },
      { name: 'kill', args: ['1'] },
      { name: 'onData', args: [onData] },
      { name: 'onExit', args: [onExit] },
    ]);
  });

  it('normalizes legacy string spawn results at the browser service boundary', async () => {
    const service = createTerminalService({
      spawn: async () => 'legacy-id' as never,
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined,
    });

    await expect(service.spawn()).resolves.toEqual({ id: 'legacy-id' });
  });
});

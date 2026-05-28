import type { Core } from '@basehalf/core';
import { ipcMain } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerBhRunHandler, serializeError } from '../src/main/ipc.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

type Listener = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function lastRegisteredHandler(): Listener {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('no handler registered');
  return call[1] as unknown as Listener;
}

function fakeCore(run?: (name: string, args: unknown) => Promise<unknown>): Core {
  return {
    register: vi.fn(),
    has: vi.fn(),
    run: (run ?? (async () => undefined)) as Core['run'],
  };
}

describe('bh:run IPC channel', () => {
  afterEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers a handler on the "bh:run" channel', () => {
    registerBhRunHandler(fakeCore());
    expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith('bh:run', expect.any(Function));
  });

  it('wraps core.run result in { ok: true, result }', async () => {
    const runSpy = vi.fn(async () => [{ name: 'demo', path: '/tmp/demo' }]);
    registerBhRunHandler(fakeCore(runSpy));
    const handler = lastRegisteredHandler();
    const response = await handler({}, 'workspace.list', {});
    expect(response).toEqual({ ok: true, result: [{ name: 'demo', path: '/tmp/demo' }] });
    expect(runSpy).toHaveBeenCalledWith('workspace.list', {});
  });

  it('serializes thrown Error into { ok: false, error }', async () => {
    const err = Object.assign(new Error('not found'), {
      name: 'UnknownCommand',
      code: 'ENOENT',
    });
    registerBhRunHandler(
      fakeCore(async () => {
        throw err;
      }),
    );
    const handler = lastRegisteredHandler();
    const response = await handler({}, 'nope', {});
    expect(response).toEqual({
      ok: false,
      error: { name: 'UnknownCommand', message: 'not found', code: 'ENOENT' },
    });
  });

  it('rejects non-string command name with TypeError', async () => {
    registerBhRunHandler(fakeCore());
    const handler = lastRegisteredHandler();
    const response = await handler({}, 123, {});
    expect(response).toEqual({
      ok: false,
      error: { name: 'TypeError', message: expect.stringContaining('string') },
    });
  });
});

describe('serializeError', () => {
  it('preserves name, message, and optional code on Error instances', () => {
    const err = Object.assign(new Error('boom'), { code: 'EFAIL' });
    expect(serializeError(err)).toEqual({ name: 'Error', message: 'boom', code: 'EFAIL' });
  });

  it('omits code when absent', () => {
    expect(serializeError(new Error('plain'))).toEqual({ name: 'Error', message: 'plain' });
  });

  it('wraps non-Error throws as generic Error', () => {
    expect(serializeError('plain string')).toEqual({ name: 'Error', message: 'plain string' });
    expect(serializeError(42)).toEqual({ name: 'Error', message: '42' });
  });
});

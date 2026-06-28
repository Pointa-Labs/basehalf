import { describe, expect, it, vi } from 'vitest';
import { TERMINAL_IPC_CHANNELS } from '../src/platform/terminal/common/terminal.js';
import { TerminalMainChannel } from '../src/platform/terminal/electron-main/terminalMainChannel.js';
import type {
  TerminalDataDispatch,
  TerminalExitDispatch,
  TerminalMainService,
} from '../src/platform/terminal/node/terminalMainService.js';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  webContents: {
    fromId: vi.fn(),
  },
}));

type Handler = (...args: unknown[]) => unknown;

function fakeIpc(): {
  handle: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
  listeners: Map<string, Handler>;
  on: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Handler>();
  return {
    handlers,
    listeners,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: Handler) => {
      listeners.set(channel, handler);
    }),
  };
}

function fakeTerminalService(): {
  dataListeners: Array<(event: TerminalDataDispatch) => void>;
  exitListeners: Array<(event: TerminalExitDispatch) => void>;
  service: TerminalMainService;
} {
  const dataListeners: Array<(event: TerminalDataDispatch) => void> = [];
  const exitListeners: Array<(event: TerminalExitDispatch) => void> = [];
  const service = {
    onDidWriteData: vi.fn((listener: (event: TerminalDataDispatch) => void) => {
      dataListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidExit: vi.fn((listener: (event: TerminalExitDispatch) => void) => {
      exitListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    spawnTerminal: vi.fn(() => ({ id: 't1', cwd: '/workspace' })),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    killTerminal: vi.fn(),
  } as unknown as TerminalMainService;
  return { dataListeners, exitListeners, service };
}

describe('TerminalMainChannel', () => {
  it('registers terminal IPC around the terminal service', async () => {
    const ipc = fakeIpc();
    const { dataListeners, exitListeners, service } = fakeTerminalService();
    const sends: unknown[] = [];
    const wcRegistry = {
      fromId: vi.fn((id: number) => ({
        isDestroyed: () => id === 99,
        send: (channel: string, payload: unknown) => sends.push({ channel, id, payload }),
      })),
    };
    const getWorkspaceRoot = vi.fn(() => '/workspace');
    new TerminalMainChannel(service, getWorkspaceRoot, ipc, wcRegistry).register();

    expect([...ipc.handlers.keys()]).toEqual([TERMINAL_IPC_CHANNELS.spawn]);
    expect([...ipc.listeners.keys()]).toEqual([
      TERMINAL_IPC_CHANNELS.write,
      TERMINAL_IPC_CHANNELS.resize,
      TERMINAL_IPC_CHANNELS.kill,
    ]);

    const event = { sender: { id: 7 } };
    await ipc.handlers.get(TERMINAL_IPC_CHANNELS.spawn)?.(event, { cols: 80, rows: 24 });
    ipc.listeners.get(TERMINAL_IPC_CHANNELS.write)?.(event, { id: 't1', data: 'x' });
    ipc.listeners.get(TERMINAL_IPC_CHANNELS.resize)?.(event, {
      id: 't1',
      cols: 100,
      rows: 30,
    });
    ipc.listeners.get(TERMINAL_IPC_CHANNELS.kill)?.(event, { id: 't1' });
    dataListeners[0]?.({ ownerWcId: 7, id: 't1', data: 'hello' });
    exitListeners[0]?.({ ownerWcId: 7, id: 't1', exitCode: 0 });
    dataListeners[0]?.({ ownerWcId: 99, id: 'gone', data: 'ignored' });

    expect(getWorkspaceRoot).toHaveBeenCalledWith(event.sender);
    expect(service.spawnTerminal).toHaveBeenCalledWith(7, '/workspace', { cols: 80, rows: 24 });
    expect(service.writeTerminal).toHaveBeenCalledWith(7, 't1', 'x');
    expect(service.resizeTerminal).toHaveBeenCalledWith(7, 't1', 100, 30);
    expect(service.killTerminal).toHaveBeenCalledWith(7, 't1');
    expect(sends).toEqual([
      {
        id: 7,
        channel: TERMINAL_IPC_CHANNELS.data,
        payload: { id: 't1', data: 'hello' },
      },
      { id: 7, channel: TERMINAL_IPC_CHANNELS.exit, payload: { id: 't1', exitCode: 0 } },
    ]);
  });

  it('ignores malformed terminal IPC payloads before dispatching to the pty service', async () => {
    const ipc = fakeIpc();
    const { service } = fakeTerminalService();
    new TerminalMainChannel(service, () => '/workspace', ipc).register();

    const event = { sender: { id: 7 } };
    await ipc.handlers.get(TERMINAL_IPC_CHANNELS.spawn)?.(event, {
      cols: '80',
      rows: 24,
      cwd: '/tmp/demo',
    });
    ipc.listeners.get(TERMINAL_IPC_CHANNELS.write)?.(event, { id: 't1' });
    ipc.listeners.get(TERMINAL_IPC_CHANNELS.resize)?.(event, {
      id: 't1',
      cols: '100',
      rows: 30,
    });
    ipc.listeners.get(TERMINAL_IPC_CHANNELS.kill)?.(event, { id: 1 });

    expect(service.spawnTerminal).toHaveBeenCalledWith(7, '/workspace', {
      rows: 24,
      cwd: '/tmp/demo',
    });
    expect(service.writeTerminal).not.toHaveBeenCalled();
    expect(service.resizeTerminal).not.toHaveBeenCalled();
    expect(service.killTerminal).not.toHaveBeenCalled();
  });
});

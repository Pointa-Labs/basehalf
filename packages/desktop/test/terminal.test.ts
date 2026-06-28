import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TerminalMainService,
  type TerminalPtySpawner,
} from '../src/platform/terminal/node/terminalMainService.js';

// Service-level terminal isolation. The pty service owns shell lifecycle and
// guards sessions by owner webContents id; Electron IPC is covered separately by
// terminal-main-channel.test.ts.

interface FakePty {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: (cb: (d: string) => void) => { dispose: () => void };
  onExit: (cb: (e: { exitCode: number }) => void) => { dispose: () => void };
  emitData: (d: string) => void;
  emitExit: (code: number) => void;
}

const ptys: FakePty[] = [];

function makeFakePty(): FakePty {
  let dataCb: ((d: string) => void) | undefined;
  let exitCb: ((e: { exitCode: number }) => void) | undefined;
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb) => {
      dataCb = cb;
      return { dispose: vi.fn() };
    },
    onExit: (cb) => {
      exitCb = cb;
      return { dispose: vi.fn() };
    },
    emitData: (d) => dataCb?.(d),
    emitExit: (code) => exitCb?.({ exitCode: code }),
  };
}

function createService(): TerminalMainService {
  const spawnPty: TerminalPtySpawner = vi.fn(() => {
    const pty = makeFakePty();
    ptys.push(pty);
    return pty;
  });
  return new TerminalMainService(spawnPty);
}

describe('TerminalMainService', () => {
  beforeEach(() => {
    ptys.length = 0;
  });

  it('routes a pty’s output only to the window that spawned it', () => {
    const service = createService();
    const sends: unknown[] = [];
    service.onDidWriteData((event) => sends.push(event));

    service.spawnTerminal(1, '/workspace/a');
    service.spawnTerminal(2, '/workspace/b');
    ptys[0]?.emitData('from-A');
    ptys[1]?.emitData('from-B');

    expect(sends).toContainEqual({ ownerWcId: 1, id: 't1', data: 'from-A' });
    expect(sends).toContainEqual({ ownerWcId: 2, id: 't2', data: 'from-B' });
    expect(sends).not.toContainEqual({ ownerWcId: 1, id: 't2', data: 'from-B' });
    expect(sends).not.toContainEqual({ ownerWcId: 2, id: 't1', data: 'from-A' });
  });

  it('lets a window write to its own session', () => {
    const service = createService();
    const { id } = service.spawnTerminal(1, '/workspace/a');

    service.writeTerminal(1, id, 'ls\n');

    expect(ptys[0]?.write).toHaveBeenCalledWith('ls\n');
  });

  it('refuses a write to another window’s session', () => {
    const service = createService();
    const { id } = service.spawnTerminal(1, '/workspace/a');

    service.writeTerminal(2, id, 'rm -rf /\n');

    expect(ptys[0]?.write).not.toHaveBeenCalled();
  });

  it('refuses a kill of another window’s session, but allows its own', () => {
    const service = createService();
    const { id } = service.spawnTerminal(1, '/workspace/a');

    service.killTerminal(2, id);
    expect(ptys[0]?.kill).not.toHaveBeenCalled();
    service.killTerminal(1, id);

    expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it('disposeTerminalsForWindow kills only that window’s ptys', () => {
    const service = createService();
    service.spawnTerminal(1, '/workspace/a');
    service.spawnTerminal(1, '/workspace/a');
    service.spawnTerminal(2, '/workspace/b');

    service.disposeTerminalsForWindow(1);

    expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
    expect(ptys[1]?.kill).toHaveBeenCalledTimes(1);
    expect(ptys[2]?.kill).not.toHaveBeenCalled();
  });

  it('ignores a resize from a non-owner and clamps an owner resize', () => {
    const service = createService();
    const { id } = service.spawnTerminal(1, '/workspace/a');

    service.resizeTerminal(2, id, 10, 10);
    expect(ptys[0]?.resize).not.toHaveBeenCalled();
    service.resizeTerminal(1, id, 0, 20.8);

    expect(ptys[0]?.resize).toHaveBeenCalledWith(1, 20);
  });

  it('emits exit and removes the session when the pty exits', () => {
    const service = createService();
    const exits: unknown[] = [];
    service.onDidExit((event) => exits.push(event));
    const { id } = service.spawnTerminal(1, '/workspace/a');

    ptys[0]?.emitExit(127);
    service.writeTerminal(1, id, 'after-exit');

    expect(exits).toEqual([{ ownerWcId: 1, id, exitCode: 127 }]);
    expect(ptys[0]?.write).not.toHaveBeenCalled();
  });
});

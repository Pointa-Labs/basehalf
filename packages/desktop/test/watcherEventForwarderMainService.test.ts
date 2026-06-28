import type { BrowserWindow } from 'electron';
import { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WATCHER_IPC_CHANNELS, type WatcherHostEvent } from '../src/platform/files/common/files.js';
import { WatcherEventForwarderMainService } from '../src/platform/files/electron-main/watcherEventForwarderMainService.js';

type Listener = (event: WatcherHostEvent) => void;

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn() },
}));

interface FakeWindow extends BrowserWindow {
  readonly webContents: BrowserWindow['webContents'] & {
    readonly id: number;
    readonly send: ReturnType<typeof vi.fn>;
  };
}

function fakeWindow(id: number, destroyed = false): FakeWindow {
  return {
    webContents: { id, send: vi.fn() },
    isDestroyed: vi.fn(() => destroyed),
  } as unknown as FakeWindow;
}

function watcherEvent(workspaceRoot: string): WatcherHostEvent {
  return {
    type: 'change',
    workspaceRoot,
    absPath: `${workspaceRoot}/note.md`,
    relPath: 'note.md',
    isDir: false,
  };
}

describe('WatcherEventForwarderMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a core watcher listener', () => {
    const events = { on: vi.fn() };
    const service = new WatcherEventForwarderMainService({
      events,
      getWorkspaceRoot: () => null,
    });

    service.register();

    expect(events.on).toHaveBeenCalledWith('event', expect.any(Function));
  });

  it('forwards events only to live windows bound to the originating workspace', () => {
    const matching = fakeWindow(1);
    const otherWorkspace = fakeWindow(2);
    const closed = fakeWindow(3, true);
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([
      matching,
      otherWorkspace,
      closed,
    ]);
    const roots = new Map<number, string | null>([
      [1, '/ws/a'],
      [2, '/ws/b'],
      [3, '/ws/a'],
    ]);
    const events = { on: vi.fn((_event: 'event', _listener: Listener) => undefined) };
    const service = new WatcherEventForwarderMainService({
      events,
      getWorkspaceRoot: (wc) => roots.get(wc.id) ?? null,
    });
    const event = watcherEvent('/ws/a');

    service.forward(event);

    expect(matching.webContents.send).toHaveBeenCalledWith(WATCHER_IPC_CHANNELS.fileEvent, event);
    expect(otherWorkspace.webContents.send).not.toHaveBeenCalled();
    expect(closed.webContents.send).not.toHaveBeenCalled();
  });
});

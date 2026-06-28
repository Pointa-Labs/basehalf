import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MainChannelRegistry,
  type MainChannelRegistryServices,
} from '../src/code/electron-main/mainChannelRegistry.js';
import { SETTINGS_IPC_CHANNELS } from '../src/platform/configuration/common/configuration.js';
import { NATIVE_HOST_IPC_CHANNELS } from '../src/platform/native/common/native.js';
import { TERMINAL_IPC_CHANNELS } from '../src/platform/terminal/common/terminal.js';
import { UPDATE_IPC_CHANNELS } from '../src/platform/update/common/update.js';
import { WINDOW_IPC_CHANNELS } from '../src/platform/windows/common/window.js';
import { WORKSPACE_IPC_CHANNELS } from '../src/platform/workspaces/common/workspaces.js';
import { GITHUB_IPC_CHANNELS } from '../src/workbench/contrib/githubPullRequests/common/githubPullRequests.js';
import { GIT_IPC_CHANNELS } from '../src/workbench/contrib/scm/common/git.js';
import { ADHD_IPC_CHANNELS } from '../src/workbench/services/mirror/common/adhd.js';
import { BADGE_IPC_CHANNELS } from '../src/workbench/services/mirror/common/badge.js';
import { CANVAS_IPC_CHANNELS } from '../src/workbench/services/mirror/common/canvas.js';
import { FOCUS_IPC_CHANNELS } from '../src/workbench/services/mirror/common/focus.js';
import { SEARCH_IPC_CHANNELS } from '../src/workbench/services/search/common/search.js';

type Handler = (...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Handler>();
  return {
    handlers,
    listeners,
    BrowserWindow: {
      fromWebContents: vi.fn(),
      getAllWindows: vi.fn(() => []),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      on: vi.fn((channel: string, handler: Handler) => {
        listeners.set(channel, handler);
      }),
    },
    webContents: {
      fromId: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain,
  webContents: electronMock.webContents,
}));

function createServices(): MainChannelRegistryServices {
  return {
    adhd: {},
    badge: {},
    canvas: {},
    focus: {},
    git: {},
    github: {},
    nativeHost: {},
    search: {},
    settings: {},
    terminal: {
      onDidExit: vi.fn(),
      onDidWriteData: vi.fn(),
    },
    updater: {},
    watcherEvents: {
      on: vi.fn(),
    },
    workspace: {},
    workspaceWindowRouter: {},
  } as unknown as MainChannelRegistryServices;
}

describe('MainChannelRegistry', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.listeners.clear();
    vi.clearAllMocks();
  });

  it('registers the application IPC surface from one bootstrap point', () => {
    const services = createServices();
    const suppressNativeContextMenu = vi.fn();
    const getWorkspaceRoot = vi.fn(() => '/repo');

    new MainChannelRegistry({
      services,
      getWorkspaceRoot,
      suppressNativeContextMenu,
    }).register();

    expect([...electronMock.handlers.keys()]).toEqual(
      expect.arrayContaining([
        ADHD_IPC_CHANNELS.get,
        BADGE_IPC_CHANNELS.get,
        CANVAS_IPC_CHANNELS.get,
        FOCUS_IPC_CHANNELS.get,
        GIT_IPC_CHANNELS.status,
        GITHUB_IPC_CHANNELS.repository,
        NATIVE_HOST_IPC_CHANNELS.pickWorkspace,
        SEARCH_IPC_CHANNELS.query,
        SETTINGS_IPC_CHANNELS.get,
        TERMINAL_IPC_CHANNELS.spawn,
        UPDATE_IPC_CHANNELS.getState,
        WORKSPACE_IPC_CHANNELS.list,
        WINDOW_IPC_CHANNELS.workspaceOpen,
      ]),
    );
    expect([...electronMock.listeners.keys()]).toEqual(
      expect.arrayContaining([
        WINDOW_IPC_CHANNELS.workspacesChanged,
        WINDOW_IPC_CHANNELS.suppressNextContextMenu,
        TERMINAL_IPC_CHANNELS.kill,
        TERMINAL_IPC_CHANNELS.resize,
        TERMINAL_IPC_CHANNELS.write,
      ]),
    );
    expect(services.watcherEvents.on).toHaveBeenCalledWith('event', expect.any(Function));
    expect(services.terminal.onDidWriteData).toHaveBeenCalledWith(expect.any(Function));
    expect(services.terminal.onDidExit).toHaveBeenCalledWith(expect.any(Function));

    const event = { returnValue: false };
    electronMock.listeners.get(WINDOW_IPC_CHANNELS.suppressNextContextMenu)?.(event);

    expect(suppressNativeContextMenu).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe(true);
  });
});

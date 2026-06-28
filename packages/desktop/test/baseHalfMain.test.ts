import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseHalfMain } from '../src/code/electron-main/baseHalfMain.js';

const electronMock = vi.hoisted(() => ({
  app: {
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(async () => undefined),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({})),
    setApplicationMenu: vi.fn(),
  },
  nativeTheme: {
    themeSource: 'system',
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  webContents: {
    fromId: vi.fn(),
  },
}));

vi.mock('electron', () => electronMock);

class FailingBaseHalfMain extends BaseHalfMain {
  protected override async startup(): Promise<void> {
    throw new Error('startup exploded');
  }
}

describe('BaseHalfMain', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  it('logs startup failures and exits the Electron main process', async () => {
    const log = { error: vi.fn() };
    const exit = vi.fn();

    new FailingBaseHalfMain({ here: '/app/out/main', log, exit }).main();
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(expect.any(Error));
    expect(process.exitCode).toBe(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_IPC_CHANNELS } from '../src/platform/configuration/common/configuration.js';
import { SettingsMainChannel } from '../src/platform/configuration/electron-main/configurationMainChannel.js';
import type { SettingsMainService } from '../src/platform/configuration/electron-main/configurationMainService.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

type Handler = (...args: unknown[]) => unknown;

function fakeIpc(): { handle: ReturnType<typeof vi.fn>; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
}

describe('SettingsMainChannel', () => {
  it('registers settings IPC handlers around the settings service', () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const prefs = { autoUpdateCheck: false, autoDownloadUpdate: true };
    const inspect = {
      key: 'editor.readingMode',
      scope: 'workspace',
      type: 'boolean',
      defaultValue: false,
      value: true,
    };
    const settings = {
      getAppVersion: vi.fn(() => '1.2.3'),
      getPrefs: vi.fn(() => prefs),
      setPrefs: vi.fn(() => ({ ...prefs, autoUpdateCheck: true })),
      zoomWindow: vi.fn(),
      describe: vi.fn(() => [{ key: 'editor.readingMode' }]),
      inspect: vi.fn(() => inspect),
      get: vi.fn(() => true),
      setGlobal: vi.fn(() => inspect),
      setWorkspace: vi.fn(() => inspect),
      clearWorkspace: vi.fn(() => inspect),
    } as unknown as SettingsMainService;

    new SettingsMainChannel(settings, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(SETTINGS_IPC_CHANNELS));
    expect(ipc.handlers.get(SETTINGS_IPC_CHANNELS.appVersion)?.(event)).toBe('1.2.3');
    expect(ipc.handlers.get(SETTINGS_IPC_CHANNELS.prefsGet)?.(event)).toBe(prefs);
    expect(
      ipc.handlers.get(SETTINGS_IPC_CHANNELS.prefsSet)?.(event, { autoUpdateCheck: true }),
    ).toEqual({
      autoUpdateCheck: true,
      autoDownloadUpdate: true,
    });
    ipc.handlers.get(SETTINGS_IPC_CHANNELS.windowZoom)?.(event, 'reset');
    expect(ipc.handlers.get(SETTINGS_IPC_CHANNELS.describe)?.(event)).toEqual([
      { key: 'editor.readingMode' },
    ]);
    expect(ipc.handlers.get(SETTINGS_IPC_CHANNELS.inspect)?.(event, 'editor.readingMode')).toEqual(
      inspect,
    );
    expect(ipc.handlers.get(SETTINGS_IPC_CHANNELS.get)?.(event, 'editor.readingMode')).toBe(true);
    expect(
      ipc.handlers.get(SETTINGS_IPC_CHANNELS.setGlobal)?.(event, {
        key: 'editor.readingMode',
        value: true,
      }),
    ).toEqual(inspect);
    expect(
      ipc.handlers.get(SETTINGS_IPC_CHANNELS.setWorkspace)?.(event, {
        key: 'editor.readingMode',
        value: false,
      }),
    ).toEqual(inspect);
    expect(
      ipc.handlers.get(SETTINGS_IPC_CHANNELS.clearWorkspace)?.(event, 'editor.readingMode'),
    ).toEqual(inspect);

    expect(settings.setPrefs).toHaveBeenCalledWith({ autoUpdateCheck: true });
    expect(settings.zoomWindow).toHaveBeenCalledWith('reset');
    expect(settings.inspect).toHaveBeenCalledWith('/repo', 'editor.readingMode');
    expect(settings.setGlobal).toHaveBeenCalledWith('/repo', 'editor.readingMode', true);
    expect(settings.setWorkspace).toHaveBeenCalledWith('/repo', 'editor.readingMode', false);
    expect(settings.clearWorkspace).toHaveBeenCalledWith('/repo', 'editor.readingMode');
  });
});

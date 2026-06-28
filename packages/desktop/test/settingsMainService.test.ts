import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SettingsMainService } from '../src/platform/configuration/electron-main/configurationMainService.js';
import {
  FileSettingsRegistryProvider,
  type SettingsRegistryProvider,
} from '../src/platform/configuration/electron-main/configurationRegistryProvider.js';
import type { Prefs } from '../src/platform/storage/electron-main/prefsStore.js';

const defaultPrefs: Prefs = { autoUpdateCheck: true, autoDownloadUpdate: false };

describe('SettingsMainService', () => {
  it('reads app version and delegates prefs reads/writes to the prefs store', () => {
    const prefs = {
      get: vi.fn(() => defaultPrefs),
      set: vi.fn(() => ({ ...defaultPrefs, autoDownloadUpdate: true })),
    };
    const service = new SettingsMainService({
      appVersion: '9.8.7',
      prefs,
      registry: fakeRegistry(),
      zoom: { getZoomLevel: vi.fn(), applyZoomLevel: vi.fn() },
    });

    expect(service.getAppVersion()).toBe('9.8.7');
    expect(service.getPrefs()).toBe(defaultPrefs);
    expect(service.setPrefs({ autoDownloadUpdate: true })).toEqual({
      autoUpdateCheck: true,
      autoDownloadUpdate: true,
    });
    expect(prefs.set).toHaveBeenCalledWith({ autoDownloadUpdate: true });
  });

  it('maps zoom actions to the focused window zoom hooks', () => {
    let level = 2;
    const zoom = {
      getZoomLevel: vi.fn(() => level),
      applyZoomLevel: vi.fn((next: number) => {
        level = next;
      }),
    };
    const service = new SettingsMainService({
      appVersion: '1.0.0',
      prefs: fakePrefs(),
      registry: fakeRegistry(),
      zoom,
    });

    service.zoomWindow('in');
    service.zoomWindow('out');
    service.zoomWindow('reset');
    service.zoomWindow('unknown');

    expect(zoom.applyZoomLevel).toHaveBeenNthCalledWith(1, 3);
    expect(zoom.applyZoomLevel).toHaveBeenNthCalledWith(2, 2);
    expect(zoom.applyZoomLevel).toHaveBeenNthCalledWith(3, 0);
    expect(zoom.applyZoomLevel).toHaveBeenCalledTimes(3);
  });

  it('delegates registry settings through the configured provider', async () => {
    const inspect = {
      key: 'editor.readingMode',
      scope: 'workspace',
      type: 'boolean',
      defaultValue: false,
      value: true,
    };
    const registry = {
      describe: vi.fn(async () => [{ key: 'editor.readingMode' }]),
      inspect: vi.fn(async () => inspect),
      get: vi.fn(async () => true),
      setGlobal: vi.fn(async () => inspect),
      setWorkspace: vi.fn(async () => inspect),
      clearWorkspace: vi.fn(async () => inspect),
    };
    const service = new SettingsMainService({
      appVersion: '1.0.0',
      prefs: fakePrefs(),
      registry,
      zoom: { getZoomLevel: vi.fn(), applyZoomLevel: vi.fn() },
    });

    await expect(service.describe('/repo')).resolves.toEqual([{ key: 'editor.readingMode' }]);
    await expect(service.inspect('/repo', 'editor.readingMode')).resolves.toEqual(inspect);
    await expect(service.get('/repo', 'editor.readingMode')).resolves.toBe(true);
    await expect(service.setGlobal('/repo', 'editor.readingMode', true)).resolves.toEqual(inspect);
    await expect(service.setWorkspace('/repo', 'editor.readingMode', false)).resolves.toEqual(
      inspect,
    );
    await expect(service.clearWorkspace('/repo', 'editor.readingMode')).resolves.toEqual(inspect);

    expect(registry.describe).toHaveBeenCalledWith('/repo');
    expect(registry.inspect).toHaveBeenCalledWith('/repo', 'editor.readingMode');
    expect(registry.get).toHaveBeenCalledWith('/repo', 'editor.readingMode');
    expect(registry.setGlobal).toHaveBeenCalledWith('/repo', 'editor.readingMode', true);
    expect(registry.setWorkspace).toHaveBeenCalledWith('/repo', 'editor.readingMode', false);
    expect(registry.clearWorkspace).toHaveBeenCalledWith('/repo', 'editor.readingMode');
  });
});

describe('FileSettingsRegistryProvider', () => {
  it('stores layered settings in the desktop configuration store', async () => {
    await withTempConfig(async (configDir) => {
      const registry = new FileSettingsRegistryProvider({ configDir });

      await expect(registry.describe('/repo')).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'editor.readingMode' })]),
      );
      await expect(registry.get('/repo', 'editor.readingMode')).resolves.toBe(false);

      await registry.setGlobal('/repo', 'editor.readingMode', true);
      expect(await registry.inspect('/repo', 'editor.readingMode')).toMatchObject({
        globalValue: true,
        value: true,
      });

      await registry.setWorkspace('/repo', 'editor.readingMode', false);
      expect(await registry.inspect('/repo', 'editor.readingMode')).toMatchObject({
        globalValue: true,
        workspaceValue: false,
        value: false,
      });

      await registry.clearWorkspace('/repo', 'editor.readingMode');
      expect(await registry.inspect('/repo', 'editor.readingMode')).toMatchObject({
        globalValue: true,
        value: true,
      });

      const onDisk = JSON.parse(await readFile(join(configDir, 'settings.json'), 'utf8'));
      expect(onDisk).toMatchObject({
        version: 1,
        global: { 'editor.readingMode': true },
        workspaces: {},
      });
    });
  });

  it('preserves forward-version keys and ignores corrupt values', async () => {
    await withTempConfig(async (configDir) => {
      const registry = new FileSettingsRegistryProvider({ configDir });
      await writeFile(
        join(configDir, 'settings.json'),
        JSON.stringify({
          version: 1,
          global: { 'future.flag': true, 'editor.readingMode': 'garbage' },
          workspaces: { '/repo': { 'future.ws': false } },
        }),
      );

      expect(await registry.get('/repo', 'editor.readingMode')).toBe(false);
      await registry.setGlobal('/repo', 'editor.readingMode', true);

      const onDisk = JSON.parse(await readFile(join(configDir, 'settings.json'), 'utf8'));
      expect(onDisk.global['future.flag']).toBe(true);
      expect(onDisk.workspaces['/repo']['future.ws']).toBe(false);
    });
  });

  it('serializes concurrent global and workspace writes', async () => {
    await withTempConfig(async (configDir) => {
      const registry = new FileSettingsRegistryProvider({ configDir });
      await Promise.all([
        registry.setGlobal('/repo', 'editor.readingMode', true),
        registry.setWorkspace('/repo', 'editor.readingMode', false),
      ]);

      expect(await registry.inspect('/repo', 'editor.readingMode')).toMatchObject({
        globalValue: true,
        workspaceValue: false,
        value: false,
      });
    });
  });

  it('rejects unknown keys, invalid values, and unbound workspace writes', async () => {
    await withTempConfig(async (configDir) => {
      const registry = new FileSettingsRegistryProvider({ configDir });

      await expect(registry.get('/repo', 'missing.setting')).rejects.toThrow(/Unknown setting/);
      await expect(
        registry.setGlobal('/repo', 'editor.readingMode', 'yes' as unknown as boolean),
      ).rejects.toThrow(/expects a boolean/);
      await expect(registry.setWorkspace(null, 'editor.readingMode', true)).rejects.toThrow(
        /No workspace bound/,
      );
    });
  });
});

function fakePrefs(): { get: () => Prefs; set: (patch: unknown) => Prefs } {
  return {
    get: () => defaultPrefs,
    set: () => defaultPrefs,
  };
}

function fakeRegistry(): SettingsRegistryProvider {
  return {
    describe: vi.fn(),
    inspect: vi.fn(),
    get: vi.fn(),
    setGlobal: vi.fn(),
    setWorkspace: vi.fn(),
    clearWorkspace: vi.fn(),
  };
}

async function withTempConfig(run: (configDir: string) => Promise<void>): Promise<void> {
  const configDir = await mkdtemp(join(tmpdir(), 'basehalf-settings-'));
  try {
    await run(configDir);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

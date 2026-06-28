import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileWorkspaceRegistryBackendProvider,
  type WorkspaceRegistryBackendProvider,
} from '../src/platform/workspaces/electron-main/workspaceRegistryBackendProvider.js';
import { WorkspaceRegistryMainService } from '../src/platform/workspaces/electron-main/workspaceRegistryMainService.js';

describe('WorkspaceRegistryMainService', () => {
  it('delegates registry operations to the configured backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const workspace = {
      name: 'a',
      path: '/ws/a',
      addedAt: '2020-01-01T00:00:00Z',
      lastOpenedAt: '2024-01-01T00:00:00Z',
    };
    const backend = {
      async listWorkspaces(...args: []) {
        calls.push({ name: 'listWorkspaces', args });
        return [workspace];
      },
      async touchWorkspace(...args: [string]) {
        calls.push({ name: 'touchWorkspace', args });
      },
      async stopWatcher(...args: [string]) {
        calls.push({ name: 'stopWatcher', args });
      },
    } satisfies WorkspaceRegistryBackendProvider;
    const service = new WorkspaceRegistryMainService({ backend });

    await expect(service.listWorkspaces()).resolves.toEqual([workspace]);
    await expect(service.rootForName('a')).resolves.toBe('/ws/a');
    await expect(service.registeredPaths()).resolves.toEqual(['/ws/a']);
    await service.touchWorkspace('/ws/a');
    await service.touchWorkspace(null);
    await service.stopWatcher('/ws/a');

    expect(calls).toEqual([
      { name: 'listWorkspaces', args: [] },
      { name: 'listWorkspaces', args: [] },
      { name: 'listWorkspaces', args: [] },
      { name: 'touchWorkspace', args: ['/ws/a'] },
      { name: 'stopWatcher', args: ['/ws/a'] },
    ]);
  });

  it('keeps lookup helpers resilient when the registry cannot be read', async () => {
    const backend = {
      async listWorkspaces() {
        throw new Error('registry unavailable');
      },
      touchWorkspace: vi.fn(),
      stopWatcher: vi.fn(),
    } satisfies WorkspaceRegistryBackendProvider;
    const service = new WorkspaceRegistryMainService({ backend });

    await expect(service.rootForName('a')).resolves.toBeNull();
    await expect(service.registeredPaths()).resolves.toEqual([]);
  });

  it('stores workspace history in the desktop registry provider', async () => {
    await withTempConfig(async (configDir) => {
      const stopWatcher = vi.fn(async () => undefined);
      const backend = new FileWorkspaceRegistryBackendProvider({ configDir, stopWatcher });
      await writeFile(
        join(configDir, 'workspaces.json'),
        JSON.stringify({
          version: 1,
          workspaces: {
            zed: { path: '/ws/z', addedAt: '2020-01-02T00:00:00Z' },
            alpha: { path: '/ws/a', addedAt: '2020-01-01T00:00:00Z' },
          },
        }),
      );

      await expect(backend.listWorkspaces()).resolves.toEqual([
        { name: 'alpha', path: '/ws/a', addedAt: '2020-01-01T00:00:00Z' },
        { name: 'zed', path: '/ws/z', addedAt: '2020-01-02T00:00:00Z' },
      ]);

      await backend.touchWorkspace('/WS/A');
      const onDisk = JSON.parse(await readFile(join(configDir, 'workspaces.json'), 'utf8'));
      expect(onDisk.workspaces.alpha.lastOpenedAt).toEqual(expect.any(String));

      await backend.touchWorkspace('/missing');
      await backend.stopWatcher('/ws/a');
      expect(stopWatcher).toHaveBeenCalledWith('/ws/a');
    });
  });
});

async function withTempConfig(run: (configDir: string) => Promise<void>): Promise<void> {
  const configDir = await mkdtemp(join(tmpdir(), 'basehalf-workspaces-'));
  try {
    await run(configDir);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

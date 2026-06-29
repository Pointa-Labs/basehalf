import { describe, expect, it, vi } from 'vitest';
import { workspaceFilesService } from '../src/platform/files/browser/workspaceFilesService.js';
import type { WorkspaceChannel } from '../src/platform/workspaces/browser/workspaceChannel.js';
import { createWorkspaceService } from '../src/platform/workspaces/browser/workspaceService.js';

describe('workspaceService', () => {
  it('maps workspace operations to the workspace channel contract', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    vi.spyOn(workspaceFilesService, 'listFiles').mockResolvedValue({
      path: '/tmp/demo',
      entries: [],
    });
    const service = createWorkspaceService({
      startWatcher: async () => calls.push({ name: 'startWatcher' }),
      list: async () => {
        calls.push({ name: 'list' });
        return { current: 'demo', workspaces: [] };
      },
      ensureSetup: async () => {
        calls.push({ name: 'ensureSetup' });
        return {};
      },
      add: async (args) => {
        calls.push({ name: 'add', args });
        return { workspace: { name: 'demo', path: '/tmp/demo' } };
      },
      createDemo: async (args) => {
        calls.push({ name: 'createDemo', args });
        return { workspace: { name: 'demo', path: '/tmp/demo' }, filesCreated: [], setup: {} };
      },
      remove: async (args) => {
        calls.push({ name: 'remove', args });
        return { removed: args.name };
      },
      repath: async (args) => {
        calls.push({ name: 'repath', args });
        return { workspace: { name: 'demo', path: '/tmp/new' } };
      },
      rename: async (args) => {
        calls.push({ name: 'rename', args });
        return { workspace: { name: 'renamed', path: '/tmp/demo' } };
      },
      listCanvas: async (args) => {
        calls.push({ name: 'listCanvas', args });
        return { folder: args.folder, children: [], edges: [] };
      },
      setViewport: async (args) => {
        calls.push({ name: 'setViewport', args });
        return {};
      },
    } as WorkspaceChannel);

    await service.startWatcher();
    expect(await service.listWorkspaces()).toEqual({ current: 'demo', workspaces: [] });
    await service.probePath('/tmp/demo');
    await service.ensureSetup();
    expect(await service.addWorkspace('/tmp/demo', { setup: true })).toMatchObject({
      workspace: { name: 'demo' },
    });
    expect(await service.createDemo('/tmp/demo')).toMatchObject({ workspace: { name: 'demo' } });
    await service.removeWorkspace('demo');
    expect(await service.relocateWorkspace('demo', '/tmp/new', { setup: true })).toMatchObject({
      workspace: { path: '/tmp/new' },
    });
    expect(await service.renameWorkspace('demo', 'renamed')).toMatchObject({
      workspace: { name: 'renamed' },
    });
    expect(await service.listCanvas(null)).toMatchObject({ folder: null });
    await service.setViewport({ offsetX: 1, offsetY: 2, scale: 0.5 });
    expect(workspaceFilesService.listFiles).toHaveBeenCalledWith('/tmp/demo');

    expect(calls).toEqual([
      { name: 'startWatcher' },
      { name: 'list' },
      { name: 'ensureSetup' },
      { name: 'add', args: { path: '/tmp/demo', setup: true } },
      { name: 'createDemo', args: { path: '/tmp/demo' } },
      { name: 'remove', args: { name: 'demo' } },
      { name: 'repath', args: { name: 'demo', path: '/tmp/new', setup: true } },
      { name: 'rename', args: { from: 'demo', to: 'renamed' } },
      { name: 'listCanvas', args: { folder: null } },
      { name: 'setViewport', args: { viewport: { offsetX: 1, offsetY: 2, scale: 0.5 } } },
    ]);
  });
});

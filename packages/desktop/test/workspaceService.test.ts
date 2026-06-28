import { describe, expect, it } from 'vitest';
import type { WorkspaceChannel } from '../src/platform/workspaces/browser/workspaceChannel.js';
import { createWorkspaceService } from '../src/platform/workspaces/browser/workspaceService.js';

describe('workspaceService', () => {
  it('maps workspace and file operations to the workspace channel contract', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const service = createWorkspaceService({
      startWatcher: async () => calls.push({ name: 'startWatcher' }),
      list: async () => {
        calls.push({ name: 'list' });
        return { current: 'demo', workspaces: [] };
      },
      listFiles: async (args) => {
        calls.push({ name: 'listFiles', args });
        return { path: args.path, entries: [] };
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
      listSupportedFiles: async (args) => {
        calls.push({ name: 'listSupportedFiles', args });
        return { files: ['a.md'] };
      },
      readFile: async (args) => {
        calls.push({ name: 'readFile', args });
        return { path: 'a.md', content: 'hello' };
      },
      writeFile: async (args) => {
        calls.push({ name: 'writeFile', args });
        return { path: args.path, bytes: args.content.length };
      },
      renameFile: async (args) => {
        calls.push({ name: 'renameFile', args });
        return { from: args.from, to: args.to, renamed: true };
      },
      importFile: async (args) => {
        calls.push({ name: 'importFile', args });
        return { path: 'assets/a.png', name: 'a.png', imported: true, supported: true };
      },
      createFile: async (args) => {
        calls.push({ name: 'createFile', args });
        return { path: 'new.md' };
      },
      createFolder: async (args) => {
        calls.push({ name: 'createFolder', args });
        return { path: args.path };
      },
      renameEntry: async (args) => {
        calls.push({ name: 'renameEntry', args });
        return { from: args.from, to: args.to, renamed: true };
      },
      deleteEntry: async (args) => {
        calls.push({ name: 'deleteEntry', args });
        return { deleted: true };
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
    expect(await service.listFiles('src')).toEqual({ path: 'src', entries: [] });
    expect(await service.listCanvas(null)).toMatchObject({ folder: null });
    expect(await service.listSupportedFiles(null)).toEqual(['a.md']);
    expect(await service.readFile('a.md', { maxChars: 10 })).toMatchObject({ content: 'hello' });
    expect(await service.writeFile('a.md', 'hello')).toMatchObject({ bytes: 5 });
    expect(await service.renameFile('a.md', 'b.md')).toMatchObject({ to: 'b.md' });
    expect(await service.importFile('/tmp/a.png', 'assets')).toMatchObject({ imported: true });
    expect(await service.createFile('new.md', { content: '' })).toMatchObject({ path: 'new.md' });
    expect(await service.createFolder('notes')).toMatchObject({ path: 'notes' });
    expect(await service.renameEntry('old', 'new', 'folder')).toMatchObject({ renamed: true });
    expect(await service.deleteEntry('new', 'folder')).toMatchObject({ deleted: true });
    await service.setViewport({ offsetX: 1, offsetY: 2, scale: 0.5 });

    expect(calls).toEqual([
      { name: 'startWatcher' },
      { name: 'list' },
      { name: 'listFiles', args: { path: '/tmp/demo' } },
      { name: 'ensureSetup' },
      { name: 'add', args: { path: '/tmp/demo', setup: true } },
      { name: 'createDemo', args: { path: '/tmp/demo' } },
      { name: 'remove', args: { name: 'demo' } },
      { name: 'repath', args: { name: 'demo', path: '/tmp/new', setup: true } },
      { name: 'rename', args: { from: 'demo', to: 'renamed' } },
      { name: 'listFiles', args: { path: 'src' } },
      { name: 'listCanvas', args: { folder: null } },
      { name: 'listSupportedFiles', args: { folder: null } },
      { name: 'readFile', args: { path: 'a.md', maxChars: 10 } },
      { name: 'writeFile', args: { path: 'a.md', content: 'hello' } },
      { name: 'renameFile', args: { from: 'a.md', to: 'b.md' } },
      { name: 'importFile', args: { from: '/tmp/a.png', to: 'assets' } },
      { name: 'createFile', args: { path: 'new.md', content: '' } },
      { name: 'createFolder', args: { path: 'notes' } },
      { name: 'renameEntry', args: { from: 'old', to: 'new', kind: 'folder' } },
      { name: 'deleteEntry', args: { path: 'new', kind: 'folder' } },
      { name: 'setViewport', args: { viewport: { offsetX: 1, offsetY: 2, scale: 0.5 } } },
    ]);
  });
});

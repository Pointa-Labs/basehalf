import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DesktopWorkspaceBackendProvider,
  type WorkspaceBackendProvider,
} from '../src/platform/workspaces/electron-main/workspaceBackendProvider.js';
import { WorkspaceMainService } from '../src/platform/workspaces/electron-main/workspacesMainService.js';

describe('WorkspaceMainService', () => {
  it('delegates workspace operations to the configured backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const workspace = { name: 'demo', path: '/repo', addedAt: 'now' };
    const backend = {
      async startWatcher(...args: [string | null]) {
        calls.push({ name: 'startWatcher', args });
      },
      async list(...args: [string | null]) {
        calls.push({ name: 'list', args });
        return { current: 'demo', workspaces: [workspace] };
      },
      async use(...args: [string | null, { name: string }]) {
        calls.push({ name: 'use', args });
        return { current: workspace };
      },
      async listCanvas(...args: [string | null, { folder: string | null }]) {
        calls.push({ name: 'listCanvas', args });
        return { folder: args[1].folder, children: [], edges: [] };
      },
      async setViewport(
        ...args: [string | null, { viewport: { offsetX: number; offsetY: number; scale: number } }]
      ) {
        calls.push({ name: 'setViewport', args });
        return {};
      },
    } as unknown as WorkspaceBackendProvider;
    const service = new WorkspaceMainService(backend);

    await service.startWatcher('/repo');
    await expect(service.list('/repo')).resolves.toMatchObject({ current: 'demo' });
    await expect(service.use('/repo', { name: 'demo' })).resolves.toMatchObject({
      current: workspace,
    });
    await expect(service.listCanvas('/repo', { folder: null })).resolves.toEqual({
      folder: null,
      children: [],
      edges: [],
    });
    await expect(
      service.setViewport('/repo', { viewport: { offsetX: 1, offsetY: 2, scale: 0.5 } }),
    ).resolves.toEqual({});

    expect(calls).toEqual([
      { name: 'startWatcher', args: ['/repo'] },
      { name: 'list', args: ['/repo'] },
      { name: 'use', args: ['/repo', { name: 'demo' }] },
      { name: 'listCanvas', args: ['/repo', { folder: null }] },
      {
        name: 'setViewport',
        args: ['/repo', { viewport: { offsetX: 1, offsetY: 2, scale: 0.5 } }],
      },
    ]);
  });

  it('handles registry operations in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: {} as WorkspaceBackendProvider,
      });
      await writeFile(
        join(configDir, 'workspaces.json'),
        JSON.stringify({
          version: 1,
          workspaces: {
            zed: {
              path: '/ws/z',
              addedAt: '2020-01-02T00:00:00Z',
              viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
            },
            alpha: {
              path: '/ws/a',
              addedAt: '2020-01-01T00:00:00Z',
              lastOpenedAt: '2024-01-01T00:00:00Z',
            },
          },
        }),
      );

      await expect(backend.list('/WS/A')).resolves.toEqual({
        current: 'alpha',
        workspaces: [
          {
            name: 'alpha',
            path: '/ws/a',
            addedAt: '2020-01-01T00:00:00Z',
            lastOpenedAt: '2024-01-01T00:00:00Z',
          },
          {
            name: 'zed',
            path: '/ws/z',
            addedAt: '2020-01-02T00:00:00Z',
            viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
          },
        ],
      });
      await expect(backend.current('/ws/z')).resolves.toEqual({
        current: {
          name: 'zed',
          path: '/ws/z',
          addedAt: '2020-01-02T00:00:00Z',
          viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
        },
      });
      await expect(backend.use(null, { name: 'alpha' })).resolves.toEqual({
        current: { name: 'alpha', path: '/ws/a', addedAt: '2020-01-01T00:00:00Z' },
      });
      await expect(backend.touch(null, { path: '/WS/A' })).resolves.toEqual({
        touched: true,
        name: 'alpha',
        lastOpenedAt: expect.any(String),
      });
      await expect(backend.rename(null, { from: 'alpha', to: 'beta' })).resolves.toEqual({
        workspace: { name: 'beta', path: '/ws/a', addedAt: '2020-01-01T00:00:00Z' },
      });
      await expect(backend.remove(null, { name: 'beta' })).resolves.toEqual({
        removed: 'beta',
      });
      await expect(backend.use(null, { name: 'beta' })).rejects.toThrow('No such workspace: beta');

      const onDisk = JSON.parse(await readFile(join(configDir, 'workspaces.json'), 'utf8'));
      expect(Object.keys(onDisk.workspaces)).toEqual(['zed']);
    });
  });

  it('persists workspace viewport in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const alphaRoot = join(configDir, 'Alpha');
      const betaRoot = join(configDir, 'Beta');
      await mkdir(alphaRoot);
      await mkdir(betaRoot);
      await writeFile(
        join(configDir, 'workspaces.json'),
        JSON.stringify({
          version: 1,
          workspaces: {
            alpha: {
              path: alphaRoot,
              addedAt: '2020-01-01T00:00:00Z',
              lastOpenedAt: '2024-01-01T00:00:00Z',
              viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
            },
          },
        }),
      );
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: {} as WorkspaceBackendProvider,
      });

      await expect(backend.getViewport(alphaRoot.toUpperCase())).resolves.toEqual({
        offsetX: 1,
        offsetY: 2,
        scale: 0.5,
      });
      await expect(backend.getViewport(betaRoot)).resolves.toBeNull();
      await expect(
        backend.setViewport(null, { viewport: { offsetX: 9, offsetY: 8, scale: 0.25 } }),
      ).resolves.toEqual({});

      await Promise.all([
        backend.setViewport(alphaRoot, {
          viewport: { offsetX: 10, offsetY: 20, scale: 1.5 },
        }),
        backend.add(null, { path: betaRoot, name: 'beta' }),
      ]);

      const onDisk = JSON.parse(await readFile(join(configDir, 'workspaces.json'), 'utf8'));
      expect(onDisk.workspaces.alpha).toEqual({
        path: alphaRoot,
        addedAt: '2020-01-01T00:00:00Z',
        lastOpenedAt: '2024-01-01T00:00:00Z',
        viewport: { offsetX: 10, offsetY: 20, scale: 1.5 },
      });
      expect(onDisk.workspaces.beta).toMatchObject({
        path: betaRoot,
        addedAt: expect.any(String),
      });
    });
  });

  it('adds workspaces in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const workspaceRoot = join(configDir, 'Alpha');
      const otherRoot = join(configDir, 'Other');
      await mkdir(workspaceRoot);
      await mkdir(otherRoot);
      const fallback = {} as WorkspaceBackendProvider;
      const backend = new DesktopWorkspaceBackendProvider({ configDir, fallback });

      await expect(backend.add('/ignored', { path: workspaceRoot, setup: true })).resolves.toEqual({
        workspace: {
          name: 'Alpha',
          path: workspaceRoot,
          addedAt: expect.any(String),
        },
        bhDirCreated: true,
        alreadyRegistered: false,
        setup: expect.objectContaining({
          gitignoreAbsent: true,
          agentHarnessUpdated: true,
          claudeMdUpdated: true,
          agentsMdUpdated: true,
        }),
      });
      await expect(stat(join(workspaceRoot, '.bh'))).resolves.toMatchObject({});
      await expect(readFile(join(workspaceRoot, 'AGENTS.md'), 'utf8')).resolves.toContain(
        '<!-- bh:workspace-hint -->',
      );
      await expect(
        readFile(join(workspaceRoot, '.bh/agent-harness/index.md'), 'utf8'),
      ).resolves.toContain('BaseHalf Agent Harness');

      await expect(backend.add(null, { path: workspaceRoot, name: 'OtherName' })).resolves.toEqual({
        workspace: {
          name: 'Alpha',
          path: workspaceRoot,
          addedAt: expect.any(String),
        },
        bhDirCreated: false,
        alreadyRegistered: true,
      });

      await expect(backend.add(null, { path: otherRoot, name: 'Alpha' })).rejects.toThrow(
        'Workspace already exists: Alpha',
      );
      await expect(backend.add(null, { path: otherRoot })).resolves.toMatchObject({
        workspace: { name: 'Other', path: otherRoot },
        bhDirCreated: true,
        alreadyRegistered: false,
      });
    });
  });

  it('repaths workspaces in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const oldRoot = join(configDir, 'old');
      const newRoot = join(configDir, 'new');
      const otherRoot = join(configDir, 'other');
      await mkdir(oldRoot);
      await mkdir(newRoot);
      await mkdir(otherRoot);
      await writeFile(
        join(configDir, 'workspaces.json'),
        JSON.stringify({
          version: 1,
          workspaces: {
            demo: {
              path: oldRoot,
              addedAt: '2020-01-01T00:00:00Z',
              lastOpenedAt: '2024-01-01T00:00:00Z',
            },
            other: { path: otherRoot, addedAt: '2020-01-02T00:00:00Z' },
          },
        }),
      );
      const fallback = {} as WorkspaceBackendProvider;
      const backend = new DesktopWorkspaceBackendProvider({ configDir, fallback });

      await expect(
        backend.repath('/ignored', { name: 'demo', path: newRoot, setup: true }),
      ).resolves.toEqual({
        workspace: {
          name: 'demo',
          path: newRoot,
          addedAt: '2020-01-01T00:00:00Z',
        },
        bhDirCreated: true,
        setup: expect.objectContaining({
          gitignoreAbsent: true,
          agentHarnessUpdated: true,
          claudeMdUpdated: true,
          agentsMdUpdated: true,
        }),
      });
      await expect(stat(join(newRoot, '.bh'))).resolves.toMatchObject({});

      const onDisk = JSON.parse(await readFile(join(configDir, 'workspaces.json'), 'utf8'));
      expect(onDisk.workspaces.demo).toEqual({
        path: newRoot,
        addedAt: '2020-01-01T00:00:00Z',
      });

      await expect(backend.repath(null, { name: 'demo', path: newRoot })).rejects.toThrow(
        `Workspace demo is already at ${newRoot}`,
      );
      await expect(backend.repath(null, { name: 'demo', path: otherRoot })).rejects.toThrow(
        'That folder is already registered as workspace "other".',
      );
    });
  });

  it('runs workspace setup in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const workspaceRoot = join(configDir, 'work');
      await mkdir(workspaceRoot);
      await writeFile(join(workspaceRoot, '.gitignore'), 'node_modules\n');
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: {} as WorkspaceBackendProvider,
      });

      await expect(backend.ensureSetup(workspaceRoot)).resolves.toMatchObject({
        gitignoreUpdated: true,
        agentHarnessUpdated: true,
        claudeMdUpdated: true,
        agentsMdUpdated: true,
      });
      await expect(readFile(join(workspaceRoot, '.gitignore'), 'utf8')).resolves.toContain(
        '.bh/cache/',
      );
      await expect(backend.ensureSetup(workspaceRoot)).resolves.toMatchObject({
        gitignoreSkipped: true,
        agentHarnessSkipped: true,
        claudeMdSkipped: true,
        agentsMdSkipped: true,
      });
      await expect(backend.ensureSetup(null)).rejects.toThrow('No workspace bound');
      await expect(backend.ensureSetup(join(configDir, 'missing'))).rejects.toThrow(
        'Path does not exist',
      );
    });
  });

  it('creates demo workspaces in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const workspaceRoot = join(configDir, 'demo');
      const fallbackCreateDemo = vi.fn(async () => {
        throw new Error('legacy createDemo should not be called');
      });
      const demoMirror = {
        setBadge: vi.fn(async () => ({})),
        setCanvasCard: vi.fn(async () => ({})),
        connectCanvas: vi.fn(async () => ({})),
        setFocus: vi.fn(async () => ({})),
      };
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: { createDemo: fallbackCreateDemo } as unknown as WorkspaceBackendProvider,
        demo: demoMirror,
      });

      await expect(
        backend.createDemo(null, { path: workspaceRoot, name: 'demo' }),
      ).resolves.toEqual({
        workspace: { name: 'demo', path: workspaceRoot, addedAt: expect.any(String) },
        filesCreated: expect.arrayContaining(['intro.md', 'theory.md', 'practice.md']),
        setup: expect.objectContaining({
          gitignoreAbsent: true,
          agentHarnessUpdated: true,
          claudeMdUpdated: true,
          agentsMdUpdated: true,
        }),
      });
      expect(fallbackCreateDemo).not.toHaveBeenCalled();
      await expect(readFile(join(workspaceRoot, 'intro.md'), 'utf8')).resolves.toMatch(
        /Welcome to your BaseHalf demo workspace/,
      );
      await expect(readFile(join(workspaceRoot, 'CLAUDE.md'), 'utf8')).resolves.toMatch(
        /current_focus\.yaml/,
      );
      expect(demoMirror.setBadge).toHaveBeenCalledWith(
        workspaceRoot,
        expect.objectContaining({ file: 'intro.md' }),
      );
      expect(demoMirror.setCanvasCard).toHaveBeenCalledWith(
        workspaceRoot,
        expect.objectContaining({
          folder: null,
          card: expect.objectContaining({ path: 'intro.md', kind: 'file' }),
        }),
      );
      expect(demoMirror.connectCanvas).toHaveBeenCalledWith(
        workspaceRoot,
        expect.objectContaining({ from: 'intro.md', to: 'theory.md' }),
      );
      expect(demoMirror.setFocus).toHaveBeenCalledWith(workspaceRoot, {
        path: 'intro.md',
        kind: 'file',
      });

      await writeFile(join(workspaceRoot, 'intro.md'), '# Mine\n');
      await expect(
        backend.createDemo(null, { path: workspaceRoot, name: 'demo' }),
      ).resolves.toEqual(
        expect.objectContaining({
          workspace: { name: 'demo', path: workspaceRoot, addedAt: expect.any(String) },
          filesCreated: [],
        }),
      );
      await expect(readFile(join(workspaceRoot, 'intro.md'), 'utf8')).resolves.toBe('# Mine\n');

      const otherRoot = join(configDir, 'other');
      await expect(backend.createDemo(null, { path: otherRoot, name: 'demo' })).rejects.toThrow(
        `Workspace name "demo" is already registered at ${workspaceRoot}. Pick a different demo path.`,
      );
    });
  });

  it('refuses setup writes through symlinked hint files', async () => {
    await withTempConfig(async (configDir) => {
      const workspaceRoot = join(configDir, 'work');
      const outside = join(configDir, 'outside.md');
      await mkdir(workspaceRoot);
      await writeFile(outside, 'outside');
      await symlink(outside, join(workspaceRoot, 'AGENTS.md'));
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: {} as WorkspaceBackendProvider,
      });

      await expect(backend.ensureSetup(workspaceRoot)).resolves.toMatchObject({
        agentsMdSkipped: true,
        claudeMdUpdated: true,
      });
      await expect(readFile(outside, 'utf8')).resolves.toBe('outside');
    });
  });

  it('handles basic workspace file operations in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const workspaceRoot = join(configDir, 'work');
      const outside = join(configDir, 'outside');
      await mkdir(workspaceRoot);
      await mkdir(outside);
      await mkdir(join(workspaceRoot, 'notes'));
      await mkdir(join(workspaceRoot, 'node_modules'));
      await writeFile(join(workspaceRoot, 'b.md'), 'bee');
      await writeFile(join(workspaceRoot, 'a.md'), 'alpha needle');
      await writeFile(join(workspaceRoot, 'LICENSE'), 'license');
      await writeFile(join(workspaceRoot, '.DS_Store'), 'junk');
      await writeFile(join(workspaceRoot, 'notes', 'about.md'), 'hello world');
      await writeFile(join(workspaceRoot, 'node_modules', 'skip.md'), 'skip');
      await writeFile(join(outside, 'secret.md'), 'secret');
      await symlink(outside, join(workspaceRoot, 'escape'));
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: {} as WorkspaceBackendProvider,
      });

      await expect(backend.listFiles(workspaceRoot, { path: workspaceRoot })).resolves.toEqual({
        path: workspaceRoot,
        entries: [
          { name: 'node_modules', type: 'dir' },
          { name: 'notes', type: 'dir' },
          { name: '.DS_Store', type: 'file' },
          { name: 'a.md', type: 'file' },
          { name: 'b.md', type: 'file' },
          { name: 'LICENSE', type: 'file' },
        ],
      });
      await expect(backend.listSupportedFiles(workspaceRoot, { folder: null })).resolves.toEqual({
        files: ['a.md', 'b.md', 'LICENSE', 'notes/about.md'],
      });
      await expect(
        backend.readFile(workspaceRoot, { path: 'notes/about.md', maxChars: 5 }),
      ).resolves.toEqual({
        path: 'notes/about.md',
        content: 'hello',
        truncated: true,
      });
      await expect(
        backend.writeFile(workspaceRoot, { path: 'nested/new.md', content: 'new' }),
      ).resolves.toEqual({
        path: 'nested/new.md',
        bytes: 3,
      });
      await expect(readFile(join(workspaceRoot, 'nested/new.md'), 'utf8')).resolves.toBe('new');
      await writeFile(join(workspaceRoot, 'binary.bin'), Buffer.from([0, 1, 2]));
      await expect(backend.readFile(workspaceRoot, { path: 'binary.bin' })).resolves.toMatchObject({
        path: 'binary.bin',
        binary: true,
      });
      await expect(backend.readFile(null, { path: 'a.md' })).rejects.toThrow('No workspace bound');
      await expect(
        backend.writeFile(workspaceRoot, { path: '../outside.md', content: 'x' }),
      ).rejects.toThrow('Path traversal rejected');
      await expect(
        backend.writeFile(workspaceRoot, { path: 'nested//bad.md', content: 'x' }),
      ).rejects.toThrow('Path must be normalized and relative');
      await expect(backend.listSupportedFiles(workspaceRoot, { folder: '.' })).rejects.toThrow(
        'Path must be normalized and relative',
      );
      await symlink(join(outside, 'secret.md'), join(workspaceRoot, 'link.md'));
      await expect(
        backend.writeFile(workspaceRoot, { path: 'link.md', content: 'x' }),
      ).rejects.toThrow(/outside the workspace/);
      await expect(readFile(join(outside, 'secret.md'), 'utf8')).resolves.toBe('secret');
      await mkdir(join(workspaceRoot, 'folder.md'));
      await expect(
        backend.renameFile(workspaceRoot, { from: 'folder.md', to: 'moved.md' }),
      ).rejects.toThrow('Path is not a file');
      await symlink(join(workspaceRoot, 'a.md'), join(workspaceRoot, 'inside-link.md'));
      await expect(
        backend.renameFile(workspaceRoot, { from: 'inside-link.md', to: 'moved.md' }),
      ).rejects.toThrow(/outside the workspace/);
      await expect(readFile(join(workspaceRoot, 'a.md'), 'utf8')).resolves.toBe('alpha needle');
    });
  });

  it('handles workspace create, import, and rename operations in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const workspaceRoot = join(configDir, 'work');
      const outside = join(configDir, 'outside');
      await mkdir(workspaceRoot);
      await mkdir(outside);
      await mkdir(join(workspaceRoot, 'docs'));
      await writeFile(join(workspaceRoot, 'docs', 'note.md'), 'note');
      await writeFile(join(workspaceRoot, 'docs', 'taken.md'), 'taken');
      await writeFile(join(outside, 'note.md'), 'external');
      await writeFile(join(outside, 'photo.png'), Buffer.from([1, 2, 3]));
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: {} as WorkspaceBackendProvider,
      });

      await expect(
        backend.createFile(workspaceRoot, { path: 'docs/taken.md', content: 'created' }),
      ).resolves.toEqual({ path: 'docs/taken-2.md' });
      await expect(readFile(join(workspaceRoot, 'docs/taken-2.md'), 'utf8')).resolves.toBe(
        'created',
      );

      await expect(backend.createFolder(workspaceRoot, { path: 'docs' })).resolves.toEqual({
        path: 'docs-2',
      });
      await expect(stat(join(workspaceRoot, 'docs-2'))).resolves.toMatchObject({});

      await expect(
        backend.renameFile(workspaceRoot, { from: 'docs/note.md', to: 'docs/taken.md' }),
      ).resolves.toEqual({ from: 'docs/note.md', to: 'docs/taken-3.md', renamed: true });
      await expect(readFile(join(workspaceRoot, 'docs/taken-3.md'), 'utf8')).resolves.toBe('note');

      await expect(
        backend.importFile(workspaceRoot, { from: join(outside, 'note.md'), to: 'docs' }),
      ).resolves.toEqual({
        path: 'docs/note.md',
        name: 'note.md',
        imported: true,
        supported: true,
      });
      await expect(readFile(join(workspaceRoot, 'docs/note.md'), 'utf8')).resolves.toBe('external');
      await expect(readFile(join(outside, 'note.md'), 'utf8')).resolves.toBe('external');

      await expect(
        backend.importFile(workspaceRoot, { from: join(workspaceRoot, 'docs/note.md'), to: null }),
      ).resolves.toEqual({
        path: 'docs/note.md',
        name: 'note.md',
        imported: false,
        supported: true,
      });

      await expect(
        backend.importFile(workspaceRoot, { from: join(outside, 'photo.png'), to: 'missing' }),
      ).rejects.toThrow('Import destination is not a folder');
      await expect(
        backend.createFile(workspaceRoot, { path: '../outside.md', content: 'x' }),
      ).rejects.toThrow('Path traversal rejected');
    });
  });

  it('handles entry rename/delete operations in the desktop workspace backend provider', async () => {
    await withTempConfig(async (configDir) => {
      const workspaceRoot = join(configDir, 'work');
      await mkdir(workspaceRoot);
      await writeFile(join(workspaceRoot, 'old.md'), 'old');
      await writeFile(join(workspaceRoot, 'taken.md'), 'taken');
      await mkdir(join(workspaceRoot, 'docs', 'sub'), { recursive: true });
      await writeFile(join(workspaceRoot, 'docs', 'sub', 'a.md'), 'a');
      const entryMirror = {
        rename: vi.fn(async () => ({})),
        purgeDeletedNode: vi.fn(async () => undefined),
      };
      const trashed: string[] = [];
      const backend = new DesktopWorkspaceBackendProvider({
        configDir,
        fallback: {} as WorkspaceBackendProvider,
        entryMirror,
        trash: async (path) => {
          trashed.push(path);
          await rm(path, { recursive: true });
        },
      });

      await expect(
        backend.renameEntry(workspaceRoot, { from: 'old.md', to: 'taken.md', kind: 'file' }),
      ).resolves.toEqual({ from: 'old.md', to: 'taken-2.md', renamed: true });
      await expect(readFile(join(workspaceRoot, 'taken-2.md'), 'utf8')).resolves.toBe('old');
      expect(entryMirror.rename).toHaveBeenCalledWith(workspaceRoot, {
        from: 'old.md',
        to: 'taken-2.md',
        kind: 'file',
        ifExists: true,
      });

      await expect(
        backend.renameEntry(workspaceRoot, { from: 'docs', to: 'docs-renamed', kind: 'folder' }),
      ).resolves.toEqual({ from: 'docs', to: 'docs-renamed', renamed: true });
      await expect(
        readFile(join(workspaceRoot, 'docs-renamed', 'sub', 'a.md'), 'utf8'),
      ).resolves.toBe('a');
      expect(entryMirror.rename).toHaveBeenCalledWith(workspaceRoot, {
        from: 'docs',
        to: 'docs-renamed',
        kind: 'folder',
        ifExists: true,
      });

      await expect(
        backend.deleteEntry(workspaceRoot, { path: 'taken.md', kind: 'folder' }),
      ).rejects.toThrow('Path is not a folder');
      await expect(readFile(join(workspaceRoot, 'taken.md'), 'utf8')).resolves.toBe('taken');

      await expect(
        backend.deleteEntry(workspaceRoot, { path: 'docs-renamed', kind: 'folder' }),
      ).resolves.toEqual({ deleted: true });
      expect(trashed).toHaveLength(1);
      expect(trashed[0]?.endsWith('/work/docs-renamed')).toBe(true);
      await expect(stat(join(workspaceRoot, 'docs-renamed'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(entryMirror.purgeDeletedNode).toHaveBeenCalledWith(workspaceRoot, {
        path: 'docs-renamed',
        kind: 'folder',
      });
    });
  });
});

async function withTempConfig(run: (configDir: string) => Promise<void>): Promise<void> {
  const configDir = await mkdtemp(join(tmpdir(), 'basehalf-workspace-main-'));
  try {
    await run(configDir);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

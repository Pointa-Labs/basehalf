import { describe, expect, it } from 'vitest';
import type { BaseHalfSandboxApi } from '../src/code/electron-sandbox/sandboxApi.js';
import { createSettingsChannel } from '../src/platform/configuration/browser/settingsChannel.js';
import { createFileEventChannel } from '../src/platform/files/browser/fileEventChannel.js';
import { createWorkspaceFilesChannel } from '../src/platform/files/browser/workspaceFilesChannel.js';
import { createNativeHostChannel } from '../src/platform/native/browser/nativeHostChannel.js';
import { createTerminalChannel } from '../src/platform/terminal/browser/terminalChannel.js';
import { createUpdateChannel } from '../src/platform/update/browser/updateChannel.js';
import { createWorkspaceChannel } from '../src/platform/workspaces/browser/workspaceChannel.js';
import { createGithubChannel } from '../src/workbench/contrib/githubPullRequests/browser/githubChannel.js';
import { createGitChannel } from '../src/workbench/contrib/scm/browser/gitChannel.js';
import { createAdhdChannel } from '../src/workbench/services/mirror/browser/adhdChannel.js';
import { createBadgeChannel } from '../src/workbench/services/mirror/browser/badgeChannel.js';
import { createCanvasChannel } from '../src/workbench/services/mirror/browser/canvasChannel.js';
import { createFocusChannel } from '../src/workbench/services/mirror/browser/focusChannel.js';
import { createSearchChannel } from '../src/workbench/services/search/browser/searchChannel.js';

describe('renderer service channels', () => {
  it('maps native host operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      platform: 'darwin',
      homeDir: '/Users/demo',
      pickWorkspace: async () => {
        calls.push({ name: 'pickWorkspace', args: [] });
        return '/tmp/demo';
      },
      openWorkspace: async (name: string) => {
        calls.push({ name: 'openWorkspace', args: [name] });
        return { reused: true };
      },
      notifyWorkspacesChanged: () => calls.push({ name: 'notifyWorkspacesChanged', args: [] }),
      getZoomFactor: () => {
        calls.push({ name: 'getZoomFactor', args: [] });
        return 1.2;
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createNativeHostChannel(bridge);

    expect(channel.platform).toBe('darwin');
    expect(channel.homeDir).toBe('/Users/demo');
    await expect(channel.pickWorkspace()).resolves.toBe('/tmp/demo');
    await expect(channel.openWorkspace('demo')).resolves.toEqual({ reused: true });
    channel.notifyWorkspacesChanged();
    expect(channel.getZoomFactor()).toBe(1.2);

    expect(calls).toEqual([
      { name: 'pickWorkspace', args: [] },
      { name: 'openWorkspace', args: ['demo'] },
      { name: 'notifyWorkspacesChanged', args: [] },
      { name: 'getZoomFactor', args: [] },
    ]);
  });

  it('maps update operations to the preload bridge', async () => {
    const calls: string[] = [];
    const bridge = {
      updateGetState: async () => {
        calls.push('updateGetState');
        return { phase: 'idle' };
      },
      updateCheck: async () => calls.push('updateCheck'),
      onUpdateState: () => {
        calls.push('onUpdateState');
        return () => calls.push('offUpdateState');
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createUpdateChannel(bridge);

    await expect(channel.getState()).resolves.toEqual({ phase: 'idle' });
    await channel.check();
    const off = channel.onState(() => {});
    off();

    expect(calls).toEqual(['updateGetState', 'updateCheck', 'onUpdateState', 'offUpdateState']);
  });

  it('maps GitHub provider operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      github: {
        repository: async () => {
          calls.push({ name: 'repository', args: [] });
          return null;
        },
        createPullRequestUrl: async (branch: string) => {
          calls.push({ name: 'createPullRequestUrl', args: [branch] });
          return 'https://github.com/o/r/compare/topic?expand=1';
        },
        listRemoteSources: async (query?: string) => {
          calls.push({ name: 'listRemoteSources', args: [query] });
          return [{ name: 'o/r', url: 'https://github.com/o/r.git' }];
        },
        listRemoteBranches: async (remoteUrl: string) => {
          calls.push({ name: 'listRemoteBranches', args: [remoteUrl] });
          return [{ name: 'main' }];
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createGithubChannel(bridge);

    await expect(channel.repository()).resolves.toBeNull();
    await expect(channel.createPullRequestUrl('topic')).resolves.toBe(
      'https://github.com/o/r/compare/topic?expand=1',
    );
    await expect(channel.listRemoteSources('o')).resolves.toEqual([
      { name: 'o/r', url: 'https://github.com/o/r.git' },
    ]);
    await expect(channel.listRemoteBranches('https://github.com/o/r.git')).resolves.toEqual([
      { name: 'main' },
    ]);

    expect(calls).toEqual([
      { name: 'repository', args: [] },
      { name: 'createPullRequestUrl', args: ['topic'] },
      { name: 'listRemoteSources', args: ['o'] },
      { name: 'listRemoteBranches', args: ['https://github.com/o/r.git'] },
    ]);
  });

  it('maps Git operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      git: {
        stage: async (paths: readonly string[]) => calls.push({ name: 'stage', args: [paths] }),
        show: async (ref: string, path: string) => {
          calls.push({ name: 'show', args: [ref, path] });
          return 'content';
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createGitChannel(bridge);

    await channel.stage(['a.ts']);
    await expect(channel.show('HEAD', 'a.ts')).resolves.toBe('content');

    expect(calls).toEqual([
      { name: 'stage', args: [['a.ts']] },
      { name: 'show', args: ['HEAD', 'a.ts'] },
    ]);
  });

  it('maps settings operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      settings: {
        inspect: async (key: string) => {
          calls.push({ name: 'inspect', args: [key] });
          return {
            key,
            scope: 'workspace',
            type: 'boolean',
            defaultValue: false,
            value: true,
          };
        },
        setWorkspace: async (key: string, value: boolean) => {
          calls.push({ name: 'setWorkspace', args: [key, value] });
          return {
            key,
            scope: 'workspace',
            type: 'boolean',
            defaultValue: false,
            value,
          };
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createSettingsChannel(bridge);

    await expect(channel.inspect('editor.readingMode')).resolves.toMatchObject({
      key: 'editor.readingMode',
      value: true,
    });
    await expect(channel.setWorkspace('editor.readingMode', false)).resolves.toMatchObject({
      key: 'editor.readingMode',
      value: false,
    });

    expect(calls).toEqual([
      { name: 'inspect', args: ['editor.readingMode'] },
      { name: 'setWorkspace', args: ['editor.readingMode', false] },
    ]);
  });

  it('maps search operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      search: {
        query: async (args: unknown) => {
          calls.push({ name: 'query', args: [args] });
          return { query: 'needle', hits: [] };
        },
        brief: async (args: unknown) => {
          calls.push({ name: 'brief', args: [args] });
          return { query: 'needle', brief: 'brief', files: [] };
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createSearchChannel(bridge);

    await expect(channel.query({ query: 'needle' })).resolves.toEqual({
      query: 'needle',
      hits: [],
    });
    await expect(channel.brief({ query: 'needle' })).resolves.toEqual({
      query: 'needle',
      brief: 'brief',
      files: [],
    });

    expect(calls).toEqual([
      { name: 'query', args: [{ query: 'needle' }] },
      { name: 'brief', args: [{ query: 'needle' }] },
    ]);
  });

  it('maps focus operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const node = { path: 'docs', kind: 'folder' as const };
    const bridge = {
      focus: {
        set: async (args: unknown) => {
          calls.push({ name: 'set', args: [args] });
          return args;
        },
        get: async () => {
          calls.push({ name: 'get', args: [] });
          return node;
        },
        pruneDangling: async () => {
          calls.push({ name: 'pruneDangling', args: [] });
          return { cleared: true };
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createFocusChannel(bridge);

    await expect(channel.set(node)).resolves.toEqual(node);
    await expect(channel.get()).resolves.toEqual(node);
    await expect(channel.pruneDangling()).resolves.toEqual({ cleared: true });

    expect(calls).toEqual([
      { name: 'set', args: [node] },
      { name: 'get', args: [] },
      { name: 'pruneDangling', args: [] },
    ]);
  });

  it('maps ADHD operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const state = { path: 'a.md', kind: 'file' as const, highlight_keywords: ['term'] };
    const bridge = {
      adhd: {
        get: async (file: string) => {
          calls.push({ name: 'get', args: [file] });
          return state;
        },
        markRead: async (args: unknown) => {
          calls.push({ name: 'markRead', args: [args] });
          return state;
        },
        revision: async () => {
          calls.push({ name: 'revision', args: [] });
          return { count: 1, maxMtimeMs: 2 };
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createAdhdChannel(bridge);

    await expect(channel.get('a.md')).resolves.toEqual(state);
    await expect(channel.markRead({ file: 'a.md', start: 1, end: 3 })).resolves.toEqual(state);
    await expect(channel.revision()).resolves.toEqual({ count: 1, maxMtimeMs: 2 });

    expect(calls).toEqual([
      { name: 'get', args: ['a.md'] },
      { name: 'markRead', args: [{ file: 'a.md', start: 1, end: 3 }] },
      { name: 'revision', args: [] },
    ]);
  });

  it('maps badge operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const badge = { path: 'a.md', kind: 'file' as const, references: [] };
    const bridge = {
      badge: {
        get: async (args: unknown) => {
          calls.push({ name: 'get', args: [args] });
          return badge;
        },
        list: async (args: unknown) => {
          calls.push({ name: 'list', args: [args] });
          return { badges: [badge] };
        },
        addRef: async (args: unknown) => {
          calls.push({ name: 'addRef', args: [args] });
          return badge;
        },
        revision: async () => {
          calls.push({ name: 'revision', args: [] });
          return { count: 1, maxMtimeMs: 2 };
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createBadgeChannel(bridge);

    await expect(channel.get({ file: 'a.md' })).resolves.toEqual(badge);
    await expect(channel.list({ query: 'a' })).resolves.toEqual({ badges: [badge] });
    await expect(channel.addRef({ file: 'a.md', to: 'b.md' })).resolves.toEqual(badge);
    await expect(channel.revision()).resolves.toEqual({ count: 1, maxMtimeMs: 2 });

    expect(calls).toEqual([
      { name: 'get', args: [{ file: 'a.md' }] },
      { name: 'list', args: [{ query: 'a' }] },
      { name: 'addRef', args: [{ file: 'a.md', to: 'b.md' }] },
      { name: 'revision', args: [] },
    ]);
  });

  it('maps canvas operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const canvas = { path: '', cards: [], edges: [] };
    const card = { path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 3, height: 4 };
    const bridge = {
      canvas: {
        get: async (args: unknown) => {
          calls.push({ name: 'get', args: [args] });
          return canvas;
        },
        setCard: async (args: unknown) => {
          calls.push({ name: 'setCard', args: [args] });
          return canvas;
        },
        connect: async (args: unknown) => {
          calls.push({ name: 'connect', args: [args] });
          return canvas;
        },
        revision: async () => {
          calls.push({ name: 'revision', args: [] });
          return { count: 1, maxMtimeMs: 2 };
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createCanvasChannel(bridge);

    await expect(channel.get({ folder: null })).resolves.toEqual(canvas);
    await expect(channel.setCard({ folder: null, card })).resolves.toEqual(canvas);
    await expect(
      channel.connect({
        folder: null,
        from: 'a.md',
        to: 'b.md',
        from_anchor: 'east',
        to_anchor: 'west',
      }),
    ).resolves.toEqual(canvas);
    await expect(channel.revision()).resolves.toEqual({ count: 1, maxMtimeMs: 2 });

    expect(calls).toEqual([
      { name: 'get', args: [{ folder: null }] },
      { name: 'setCard', args: [{ folder: null, card }] },
      {
        name: 'connect',
        args: [
          {
            folder: null,
            from: 'a.md',
            to: 'b.md',
            from_anchor: 'east',
            to_anchor: 'west',
          },
        ],
      },
      { name: 'revision', args: [] },
    ]);
  });

  it('maps workspace operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      workspace: {
        list: async () => {
          calls.push({ name: 'list', args: [] });
          return { current: 'demo', workspaces: [] };
        },
        listFiles: async (args: unknown) => {
          calls.push({ name: 'listFiles', args: [args] });
          return { path: 'src', entries: [] };
        },
        readFile: async (args: unknown) => {
          calls.push({ name: 'readFile', args: [args] });
          return { path: 'a.md', content: 'hello' };
        },
        setViewport: async (args: unknown) => {
          calls.push({ name: 'setViewport', args: [args] });
          return {};
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createWorkspaceChannel(bridge);

    await expect(channel.list()).resolves.toEqual({ current: 'demo', workspaces: [] });
    await expect(channel.listFiles({ path: 'src' })).resolves.toEqual({ path: 'src', entries: [] });
    await expect(channel.readFile({ path: 'a.md' })).resolves.toEqual({
      path: 'a.md',
      content: 'hello',
    });
    await channel.setViewport({ viewport: { offsetX: 1, offsetY: 2, scale: 0.5 } });

    expect(calls).toEqual([
      { name: 'list', args: [] },
      { name: 'listFiles', args: [{ path: 'src' }] },
      { name: 'readFile', args: [{ path: 'a.md' }] },
      { name: 'setViewport', args: [{ viewport: { offsetX: 1, offsetY: 2, scale: 0.5 } }] },
    ]);
  });

  it('maps workspace file operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      files: {
        listFiles: async (args: unknown) => {
          calls.push({ name: 'listFiles', args: [args] });
          return { path: 'src', entries: [] };
        },
        listSupportedFiles: async (args: unknown) => {
          calls.push({ name: 'listSupportedFiles', args: [args] });
          return { files: ['a.md'] };
        },
        readFile: async (args: unknown) => {
          calls.push({ name: 'readFile', args: [args] });
          return { path: 'a.md', content: 'hello' };
        },
        writeFile: async (args: unknown) => {
          calls.push({ name: 'writeFile', args: [args] });
          return { path: 'a.md', bytes: 5 };
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createWorkspaceFilesChannel(bridge);

    await expect(channel.listFiles({ path: 'src' })).resolves.toEqual({
      path: 'src',
      entries: [],
    });
    await expect(channel.listSupportedFiles({ folder: null })).resolves.toEqual({
      files: ['a.md'],
    });
    await expect(channel.readFile({ path: 'a.md' })).resolves.toEqual({
      path: 'a.md',
      content: 'hello',
    });
    await expect(channel.writeFile({ path: 'a.md', content: 'hello' })).resolves.toEqual({
      path: 'a.md',
      bytes: 5,
    });

    expect(calls).toEqual([
      { name: 'listFiles', args: [{ path: 'src' }] },
      { name: 'listSupportedFiles', args: [{ folder: null }] },
      { name: 'readFile', args: [{ path: 'a.md' }] },
      { name: 'writeFile', args: [{ path: 'a.md', content: 'hello' }] },
    ]);
  });

  it('maps terminal operations to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const bridge = {
      terminal: {
        spawn: async (opts: unknown) => {
          calls.push({ name: 'spawn', args: [opts] });
          return { id: '1', cwd: '/tmp/demo' };
        },
        write: (id: string, data: string) => calls.push({ name: 'write', args: [id, data] }),
        onData: (handler: unknown) => {
          calls.push({ name: 'onData', args: [handler] });
          return () => calls.push({ name: 'offData', args: [] });
        },
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createTerminalChannel(bridge);
    const handler = (): void => {};

    await expect(channel.spawn({ cols: 80 })).resolves.toEqual({ id: '1', cwd: '/tmp/demo' });
    channel.write('1', 'x');
    channel.onData(handler)();

    expect(calls).toEqual([
      { name: 'spawn', args: [{ cols: 80 }] },
      { name: 'write', args: ['1', 'x'] },
      { name: 'onData', args: [handler] },
      { name: 'offData', args: [] },
    ]);
  });

  it('maps workspace file events to the preload bridge', () => {
    const calls: unknown[] = [];
    const bridge = {
      onFileEvent: (handler: unknown) => {
        calls.push(handler);
        return () => calls.push('off');
      },
    } as unknown as BaseHalfSandboxApi;
    const channel = createFileEventChannel(bridge);
    const handler = (): void => {};

    channel.onDidChangeFiles(handler)();

    expect(calls).toEqual([handler, 'off']);
  });
});

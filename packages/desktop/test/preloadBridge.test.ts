import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_IPC_CHANNELS } from '../src/platform/configuration/common/configuration.js';
import { createSettingsBridge } from '../src/platform/configuration/electron-sandbox/configurationBridge.js';
import { WATCHER_IPC_CHANNELS } from '../src/platform/files/common/files.js';
import { createFileEventBridge } from '../src/platform/files/electron-sandbox/fileEventBridge.js';
import type { IpcRendererLike } from '../src/platform/ipc/electron-sandbox/ipcRenderer.js';
import { NATIVE_HOST_IPC_CHANNELS } from '../src/platform/native/common/native.js';
import { createNativeHostBridge } from '../src/platform/native/electron-sandbox/nativeHostBridge.js';
import { TERMINAL_IPC_CHANNELS } from '../src/platform/terminal/common/terminal.js';
import { createTerminalBridge } from '../src/platform/terminal/electron-sandbox/terminalBridge.js';
import { UPDATE_IPC_CHANNELS } from '../src/platform/update/common/update.js';
import { createUpdateBridge } from '../src/platform/update/electron-sandbox/updateBridge.js';
import { WINDOW_IPC_CHANNELS } from '../src/platform/windows/common/window.js';
import { WORKSPACE_IPC_CHANNELS } from '../src/platform/workspaces/common/workspaces.js';
import { createWorkspaceBridge } from '../src/platform/workspaces/electron-sandbox/workspaceBridge.js';
import { GITHUB_IPC_CHANNELS } from '../src/workbench/contrib/githubPullRequests/common/githubPullRequests.js';
import { createGithubBridge } from '../src/workbench/contrib/githubPullRequests/electron-sandbox/githubBridge.js';
import { GIT_IPC_CHANNELS } from '../src/workbench/contrib/scm/common/git.js';
import { createGitBridge } from '../src/workbench/contrib/scm/electron-sandbox/gitBridge.js';
import { AUTHENTICATION_IPC_CHANNELS } from '../src/workbench/services/authentication/common/authentication.js';
import { createAuthenticationBridge } from '../src/workbench/services/authentication/electron-sandbox/authenticationBridge.js';
import { ADHD_IPC_CHANNELS } from '../src/workbench/services/mirror/common/adhd.js';
import { BADGE_IPC_CHANNELS } from '../src/workbench/services/mirror/common/badge.js';
import { CANVAS_IPC_CHANNELS } from '../src/workbench/services/mirror/common/canvas.js';
import { FOCUS_IPC_CHANNELS } from '../src/workbench/services/mirror/common/focus.js';
import { createAdhdBridge } from '../src/workbench/services/mirror/electron-sandbox/adhdBridge.js';
import { createBadgeBridge } from '../src/workbench/services/mirror/electron-sandbox/badgeBridge.js';
import { createCanvasBridge } from '../src/workbench/services/mirror/electron-sandbox/canvasBridge.js';
import { createFocusBridge } from '../src/workbench/services/mirror/electron-sandbox/focusBridge.js';
import { SEARCH_IPC_CHANNELS } from '../src/workbench/services/search/common/search.js';
import { createSearchBridge } from '../src/workbench/services/search/electron-sandbox/searchBridge.js';

function fakeIpc(): IpcRendererLike & {
  readonly listeners: Map<string, (...args: unknown[]) => void>;
  readonly invoke: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
  readonly sendSync: ReturnType<typeof vi.fn>;
  readonly on: ReturnType<typeof vi.fn>;
  readonly off: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    invoke: vi.fn(async () => ({ ok: true, result: undefined })),
    send: vi.fn(),
    sendSync: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener);
    }),
    off: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    }),
  };
}

describe('preload bridge modules', () => {
  it('maps native host calls and one-shot subscriptions to Electron IPC', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === NATIVE_HOST_IPC_CHANNELS.pickWorkspace) return '/tmp/demo';
      if (channel === NATIVE_HOST_IPC_CHANNELS.pathKind) return 'file';
      if (channel === SETTINGS_IPC_CHANNELS.prefsGet)
        return { autoUpdateCheck: true, autoDownloadUpdate: false };
      if (channel === WINDOW_IPC_CHANNELS.workspaceOpen) return { reused: true };
      if (channel === WINDOW_IPC_CHANNELS.openWorkspaces) return ['/tmp/demo'];
      return { ok: true };
    });
    const webFrame = { getZoomFactor: vi.fn(() => 1.25) };
    const webUtils = { getPathForFile: vi.fn(() => '/tmp/a.md') };
    const bridge = createNativeHostBridge(ipc, webFrame, webUtils, {
      platform: 'darwin',
      homeDir: '/Users/demo',
    });
    const onSettings = vi.fn();
    const onFullscreen = vi.fn();
    const onZoom = vi.fn();
    const onWorkspaceAction = vi.fn();

    expect(bridge.platform).toBe('darwin');
    expect(bridge.homeDir).toBe('/Users/demo');
    await expect(bridge.pickWorkspace()).resolves.toBe('/tmp/demo');
    await expect(bridge.openWorkspace('demo')).resolves.toEqual({ reused: true });
    await expect(bridge.getOpenWorkspaces()).resolves.toEqual(['/tmp/demo']);
    const file = { name: 'a.md' } as File;
    await expect(bridge.pathKindForFile(file)).resolves.toBe('file');
    expect(bridge.pathForFile(file)).toBe('/tmp/a.md');
    expect(bridge.getZoomFactor()).toBe(1.25);
    expect(await bridge.getPrefs()).toEqual({ autoUpdateCheck: true, autoDownloadUpdate: false });
    bridge.notifyWorkspacesChanged();
    bridge.suppressNextNativeContextMenu();
    const dispose = bridge.onMenuOpenSettings(onSettings);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.menuOpenSettings)?.({});
    dispose();
    const disposeFullscreen = bridge.onFullscreenChange(onFullscreen);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.fullscreen)?.({}, true);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.fullscreen)?.({}, 'true');
    disposeFullscreen();
    const disposeZoom = bridge.onZoomFactor(onZoom);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.zoomFactor)?.({}, 1.5);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.zoomFactor)?.({}, Number.NaN);
    disposeZoom();
    const disposeWorkspaceAction = bridge.onMenuWorkspaceAction(onWorkspaceAction);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.menuWorkspaceAction)?.({}, 'rename');
    ipc.listeners.get(WINDOW_IPC_CHANNELS.menuWorkspaceAction)?.({}, 'delete');
    disposeWorkspaceAction();

    expect(ipc.invoke).toHaveBeenCalledWith(NATIVE_HOST_IPC_CHANNELS.pickWorkspace);
    expect(ipc.invoke).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.workspaceOpen, 'demo');
    expect(ipc.invoke).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.openWorkspaces);
    expect(ipc.invoke).toHaveBeenCalledWith(NATIVE_HOST_IPC_CHANNELS.pathKind, '/tmp/a.md');
    expect(ipc.invoke).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.prefsGet);
    expect(ipc.send).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.workspacesChanged);
    expect(ipc.sendSync).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.suppressNextContextMenu);
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onFullscreen).toHaveBeenCalledWith(true);
    expect(onFullscreen).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenCalledWith(1.5);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onWorkspaceAction).toHaveBeenCalledWith('rename');
    expect(onWorkspaceAction).toHaveBeenCalledTimes(1);
    expect(ipc.off).toHaveBeenCalledWith(
      WINDOW_IPC_CHANNELS.menuOpenSettings,
      expect.any(Function),
    );
  });

  it('maps GitHub provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === GITHUB_IPC_CHANNELS.createPullRequestUrl)
        return 'https://github.com/o/r/compare/topic?expand=1';
      if (channel === GITHUB_IPC_CHANNELS.listRemoteSources)
        return [{ name: 'o/r', url: 'https://github.com/o/r.git' }];
      if (channel === GITHUB_IPC_CHANNELS.listRemoteBranches) return [{ name: 'main' }];
      if (channel === GITHUB_IPC_CHANNELS.listPullRequests) return [];
      return null;
    });
    const bridge = createGithubBridge(ipc).github;

    await expect(bridge.repository()).resolves.toBeNull();
    await expect(bridge.createPullRequestUrl('topic')).resolves.toBe(
      'https://github.com/o/r/compare/topic?expand=1',
    );
    await expect(bridge.listPullRequests('https://github.com/o/r.git')).resolves.toEqual([]);
    await expect(bridge.listRemoteSources('o')).resolves.toEqual([
      { name: 'o/r', url: 'https://github.com/o/r.git' },
    ]);
    await expect(bridge.listRemoteBranches('https://github.com/o/r.git')).resolves.toEqual([
      { name: 'main' },
    ]);

    expect(ipc.invoke).toHaveBeenCalledWith(GITHUB_IPC_CHANNELS.repository);
    expect(ipc.invoke).toHaveBeenCalledWith(GITHUB_IPC_CHANNELS.createPullRequestUrl, 'topic');
    expect(ipc.invoke).toHaveBeenCalledWith(GITHUB_IPC_CHANNELS.listRemoteSources, 'o');
    expect(ipc.invoke).toHaveBeenCalledWith(
      GITHUB_IPC_CHANNELS.listRemoteBranches,
      'https://github.com/o/r.git',
    );
    expect(ipc.invoke).toHaveBeenCalledWith(
      GITHUB_IPC_CHANNELS.listPullRequests,
      'https://github.com/o/r.git',
    );
  });

  it('maps authentication provider calls and session events to Electron IPC', async () => {
    const ipc = fakeIpc();
    const session = {
      id: 'github',
      providerId: 'github',
      account: { id: 'ada', label: 'ada' },
      scopes: ['repo'],
    };
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === AUTHENTICATION_IPC_CHANNELS.getSessions) return [];
      if (channel === AUTHENTICATION_IPC_CHANNELS.createSession) return session;
      return undefined;
    });
    const bridge = createAuthenticationBridge(ipc).authentication;
    const onChange = vi.fn();

    await expect(bridge.getSessions('github')).resolves.toEqual([]);
    await expect(bridge.createSession('github', 'tok')).resolves.toEqual(session);
    await bridge.removeSession('github', 'github');
    const dispose = bridge.onDidChangeSessions(onChange);
    const changeEvent = {
      providerId: 'github',
      label: 'GitHub',
      event: { added: [], removed: [], changed: [] },
    };
    ipc.listeners.get(AUTHENTICATION_IPC_CHANNELS.sessionsChanged)?.({}, changeEvent);
    dispose();

    expect(ipc.invoke).toHaveBeenCalledWith(AUTHENTICATION_IPC_CHANNELS.getSessions, 'github');
    expect(ipc.invoke).toHaveBeenCalledWith(AUTHENTICATION_IPC_CHANNELS.createSession, {
      providerId: 'github',
      secret: 'tok',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(AUTHENTICATION_IPC_CHANNELS.removeSession, {
      providerId: 'github',
      sessionId: 'github',
    });
    expect(onChange).toHaveBeenCalledWith(changeEvent);
    expect(ipc.off).toHaveBeenCalledWith(
      AUTHENTICATION_IPC_CHANNELS.sessionsChanged,
      expect.any(Function),
    );
  });

  it('maps Git provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === GIT_IPC_CHANNELS.show) return 'content';
      if (channel === GIT_IPC_CHANNELS.status) return { isRepo: true, files: [] };
      return undefined;
    });
    const bridge = createGitBridge(ipc).git;

    await bridge.stage(['a.ts']);
    await bridge.commit('msg', { amend: true });
    await bridge.publish();
    await bridge.remotes();
    await bridge.commitFiles('abc', 'parent');
    await bridge.mergeBase(['main', 'origin/main']);
    await expect(bridge.show('HEAD', 'a.ts')).resolves.toBe('content');
    await expect(bridge.status()).resolves.toEqual({ isRepo: true, files: [] });

    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.stage, ['a.ts']);
    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.commit, {
      message: 'msg',
      amend: true,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.publish, {});
    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.remotes);
    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.commitFiles, {
      ref: 'abc',
      parent: 'parent',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.mergeBase, ['main', 'origin/main']);
    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.show, {
      ref: 'HEAD',
      path: 'a.ts',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(GIT_IPC_CHANNELS.status);
  });

  it('maps settings provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    const inspect = {
      key: 'editor.readingMode',
      scope: 'workspace',
      type: 'boolean',
      defaultValue: false,
      value: true,
    };
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === SETTINGS_IPC_CHANNELS.describe) return [{ key: 'editor.readingMode' }];
      if (channel === SETTINGS_IPC_CHANNELS.get) return true;
      return inspect;
    });
    const bridge = createSettingsBridge(ipc).settings;

    await expect(bridge.describe()).resolves.toEqual([{ key: 'editor.readingMode' }]);
    await expect(bridge.inspect('editor.readingMode')).resolves.toEqual(inspect);
    await expect(bridge.get('editor.readingMode')).resolves.toBe(true);
    await bridge.setGlobal('editor.readingMode', true);
    await bridge.setWorkspace('editor.readingMode', false);
    await bridge.clearWorkspace('editor.readingMode');

    expect(ipc.invoke).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.describe);
    expect(ipc.invoke).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.inspect, 'editor.readingMode');
    expect(ipc.invoke).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.get, 'editor.readingMode');
    expect(ipc.invoke).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.setGlobal, {
      key: 'editor.readingMode',
      value: true,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.setWorkspace, {
      key: 'editor.readingMode',
      value: false,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(
      SETTINGS_IPC_CHANNELS.clearWorkspace,
      'editor.readingMode',
    );
  });

  it('maps search provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === SEARCH_IPC_CHANNELS.brief)
        return { query: 'needle', brief: 'brief', files: ['a.md'] };
      return { query: 'needle', hits: [{ file: 'a.md', matches: [], total: 1 }] };
    });
    const bridge = createSearchBridge(ipc).search;

    await expect(bridge.query({ query: 'needle', maxFiles: 3 })).resolves.toEqual({
      query: 'needle',
      hits: [{ file: 'a.md', matches: [], total: 1 }],
    });
    await expect(bridge.brief({ query: 'needle', maxFiles: 2 })).resolves.toEqual({
      query: 'needle',
      brief: 'brief',
      files: ['a.md'],
    });

    expect(ipc.invoke).toHaveBeenCalledWith(SEARCH_IPC_CHANNELS.query, {
      query: 'needle',
      maxFiles: 3,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(SEARCH_IPC_CHANNELS.brief, {
      query: 'needle',
      maxFiles: 2,
    });
  });

  it('maps focus provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    const node = { path: 'docs', kind: 'folder' as const };
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === FOCUS_IPC_CHANNELS.set || channel === FOCUS_IPC_CHANNELS.get) return node;
      if (channel === FOCUS_IPC_CHANNELS.relocate) return { moved: 1, repointed: true };
      if (channel === FOCUS_IPC_CHANNELS.purgeNode) return { removed: 1, cleared: false };
      return { cleared: true };
    });
    const bridge = createFocusBridge(ipc).focus;

    await expect(bridge.set(node)).resolves.toEqual(node);
    await expect(bridge.get()).resolves.toEqual(node);
    await expect(bridge.clear()).resolves.toEqual({ cleared: true });
    await expect(bridge.pruneDangling()).resolves.toEqual({ cleared: true });
    await expect(bridge.relocate({ from: 'a.md', to: 'b.md' })).resolves.toEqual({
      moved: 1,
      repointed: true,
    });
    await expect(bridge.purgeNode({ path: 'b.md' })).resolves.toEqual({
      removed: 1,
      cleared: false,
    });

    expect(ipc.invoke).toHaveBeenCalledWith(FOCUS_IPC_CHANNELS.set, node);
    expect(ipc.invoke).toHaveBeenCalledWith(FOCUS_IPC_CHANNELS.get);
    expect(ipc.invoke).toHaveBeenCalledWith(FOCUS_IPC_CHANNELS.clear);
    expect(ipc.invoke).toHaveBeenCalledWith(FOCUS_IPC_CHANNELS.pruneDangling);
    expect(ipc.invoke).toHaveBeenCalledWith(FOCUS_IPC_CHANNELS.relocate, {
      from: 'a.md',
      to: 'b.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(FOCUS_IPC_CHANNELS.purgeNode, { path: 'b.md' });
  });

  it('maps ADHD provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    const state = { path: 'a.md', kind: 'file' as const, highlight_keywords: ['term'] };
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === ADHD_IPC_CHANNELS.removeKeyword || channel === ADHD_IPC_CHANNELS.markUnread)
        return null;
      if (channel === ADHD_IPC_CHANNELS.revision) return { count: 1, maxMtimeMs: 2 };
      if (channel === ADHD_IPC_CHANNELS.relocate) return { moved: 1 };
      if (channel === ADHD_IPC_CHANNELS.purgeNode) return { removed: 1 };
      return state;
    });
    const bridge = createAdhdBridge(ipc).adhd;

    await expect(bridge.get('a.md')).resolves.toEqual(state);
    await expect(bridge.addKeyword({ file: 'a.md', keyword: 'term' })).resolves.toEqual(state);
    await expect(bridge.removeKeyword({ file: 'a.md', keyword: 'term' })).resolves.toBeNull();
    await expect(bridge.markRead({ file: 'a.md', start: 1, end: 3 })).resolves.toEqual(state);
    await expect(bridge.markUnread({ file: 'a.md', start: 2, end: 2 })).resolves.toBeNull();
    await expect(bridge.set({ file: 'a.md', highlight_keywords: ['x'] })).resolves.toEqual(state);
    await expect(bridge.revision()).resolves.toEqual({ count: 1, maxMtimeMs: 2 });
    await expect(bridge.relocate({ from: 'a.md', to: 'b.md' })).resolves.toEqual({ moved: 1 });
    await expect(bridge.purgeNode({ path: 'b.md' })).resolves.toEqual({ removed: 1 });

    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.get, 'a.md');
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.addKeyword, {
      file: 'a.md',
      keyword: 'term',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.removeKeyword, {
      file: 'a.md',
      keyword: 'term',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.markRead, {
      file: 'a.md',
      start: 1,
      end: 3,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.markUnread, {
      file: 'a.md',
      start: 2,
      end: 2,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.set, {
      file: 'a.md',
      highlight_keywords: ['x'],
    });
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.revision);
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.relocate, {
      from: 'a.md',
      to: 'b.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(ADHD_IPC_CHANNELS.purgeNode, { path: 'b.md' });
  });

  it('maps badge provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    const badge = { path: 'a.md', kind: 'file' as const, references: [] };
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === BADGE_IPC_CHANNELS.list) return { badges: [badge] };
      if (channel === BADGE_IPC_CHANNELS.delete) return { deleted: true };
      if (channel === BADGE_IPC_CHANNELS.markOrphan) return null;
      if (channel === BADGE_IPC_CHANNELS.pruneDangling) return { orphaned: ['missing.md'] };
      if (channel === BADGE_IPC_CHANNELS.revision) return { count: 1, maxMtimeMs: 2 };
      if (channel === BADGE_IPC_CHANNELS.rename)
        return { badge, updatedRefs: ['ref.md'], focusUpdated: true };
      return badge;
    });
    const bridge = createBadgeBridge(ipc).badge;

    await expect(bridge.get({ file: 'a.md' })).resolves.toEqual(badge);
    await expect(bridge.set({ file: 'a.md', patch: { description: 'note' } })).resolves.toEqual(
      badge,
    );
    await expect(bridge.list({ query: 'a' })).resolves.toEqual({ badges: [badge] });
    await expect(bridge.delete({ file: 'a.md' })).resolves.toEqual({ deleted: true });
    await expect(bridge.addRef({ file: 'a.md', to: 'b.md' })).resolves.toEqual(badge);
    await expect(bridge.removeRef({ file: 'a.md', to: 'b.md' })).resolves.toEqual(badge);
    await expect(bridge.markOrphan({ file: 'a.md' })).resolves.toBeNull();
    await expect(bridge.pruneDangling()).resolves.toEqual({ orphaned: ['missing.md'] });
    await expect(bridge.revision()).resolves.toEqual({ count: 1, maxMtimeMs: 2 });
    await expect(bridge.rename({ from: 'a.md', to: 'b.md' })).resolves.toEqual({
      badge,
      updatedRefs: ['ref.md'],
      focusUpdated: true,
    });

    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.get, { file: 'a.md' });
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.set, {
      file: 'a.md',
      patch: { description: 'note' },
    });
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.list, { query: 'a' });
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.delete, { file: 'a.md' });
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.addRef, {
      file: 'a.md',
      to: 'b.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.removeRef, {
      file: 'a.md',
      to: 'b.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.markOrphan, { file: 'a.md' });
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.pruneDangling);
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.revision);
    expect(ipc.invoke).toHaveBeenCalledWith(BADGE_IPC_CHANNELS.rename, {
      from: 'a.md',
      to: 'b.md',
    });
  });

  it('maps canvas provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    const canvas = { path: '', cards: [], edges: [] };
    const card = { path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 3, height: 4 };
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === CANVAS_IPC_CHANNELS.removeCard) return { removed: true };
      if (channel === CANVAS_IPC_CHANNELS.revision) return { count: 1, maxMtimeMs: 2 };
      if (channel === CANVAS_IPC_CHANNELS.relocate) return { moved: 1 };
      if (channel === CANVAS_IPC_CHANNELS.purgeNode) return { removed: 2 };
      return canvas;
    });
    const bridge = createCanvasBridge(ipc).canvas;

    await expect(bridge.get({ folder: null })).resolves.toEqual(canvas);
    await expect(bridge.setCard({ folder: null, card })).resolves.toEqual(canvas);
    await expect(bridge.removeCard({ folder: null, path: 'a.md' })).resolves.toEqual({
      removed: true,
    });
    await expect(
      bridge.setSize({ folder: null, size: { width: 100, height: 80 } }),
    ).resolves.toEqual(canvas);
    await expect(
      bridge.connect({
        folder: null,
        from: 'a.md',
        to: 'b.md',
        from_anchor: 'east',
        to_anchor: 'west',
      }),
    ).resolves.toEqual(canvas);
    await expect(bridge.disconnect({ folder: null, from: 'a.md', to: 'b.md' })).resolves.toEqual(
      canvas,
    );
    await expect(
      bridge.reconnect({
        folder: null,
        previous: { from: 'a.md', to: 'b.md' },
        next: { from: 'a.md', to: 'c.md', from_anchor: 'south', to_anchor: 'north' },
      }),
    ).resolves.toEqual(canvas);
    await expect(bridge.revision()).resolves.toEqual({ count: 1, maxMtimeMs: 2 });
    await expect(bridge.relocate({ from: 'a.md', to: 'b.md' })).resolves.toEqual({ moved: 1 });
    await expect(bridge.purgeNode({ path: 'b.md' })).resolves.toEqual({ removed: 2 });

    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.get, { folder: null });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.setCard, { folder: null, card });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.removeCard, {
      folder: null,
      path: 'a.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.setSize, {
      folder: null,
      size: { width: 100, height: 80 },
    });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.connect, {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.disconnect, {
      folder: null,
      from: 'a.md',
      to: 'b.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.reconnect, {
      folder: null,
      previous: { from: 'a.md', to: 'b.md' },
      next: { from: 'a.md', to: 'c.md', from_anchor: 'south', to_anchor: 'north' },
    });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.revision);
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.relocate, {
      from: 'a.md',
      to: 'b.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(CANVAS_IPC_CHANNELS.purgeNode, { path: 'b.md' });
  });

  it('maps workspace provider calls to explicit Electron IPC channels', async () => {
    const ipc = fakeIpc();
    const workspace = { name: 'demo', path: '/repo', addedAt: 'now' };
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === WORKSPACE_IPC_CHANNELS.list)
        return { current: 'demo', workspaces: [workspace] };
      if (channel === WORKSPACE_IPC_CHANNELS.use) return { current: workspace };
      if (channel === WORKSPACE_IPC_CHANNELS.current) return { current: workspace };
      if (channel === WORKSPACE_IPC_CHANNELS.touch) return { touched: true };
      if (channel === WORKSPACE_IPC_CHANNELS.remove) return { removed: 'demo' };
      if (channel === WORKSPACE_IPC_CHANNELS.listFiles) return { path: 'src', entries: [] };
      if (channel === WORKSPACE_IPC_CHANNELS.listCanvas)
        return { folder: null, children: [], edges: [] };
      if (channel === WORKSPACE_IPC_CHANNELS.listSupportedFiles) return { files: ['a.md'] };
      if (channel === WORKSPACE_IPC_CHANNELS.getViewport)
        return { offsetX: 1, offsetY: 2, scale: 0.5 };
      if (channel === WORKSPACE_IPC_CHANNELS.readFile) return { path: 'a.md', content: 'hello' };
      if (channel === WORKSPACE_IPC_CHANNELS.writeFile) return { path: 'a.md', bytes: 5 };
      if (channel === WORKSPACE_IPC_CHANNELS.renameFile)
        return { from: 'a.md', to: 'b.md', renamed: true };
      if (channel === WORKSPACE_IPC_CHANNELS.importFile)
        return { path: 'assets/a.png', name: 'a.png', imported: true, supported: true };
      if (channel === WORKSPACE_IPC_CHANNELS.createFile) return { path: 'new.md' };
      if (channel === WORKSPACE_IPC_CHANNELS.createFolder) return { path: 'notes' };
      if (channel === WORKSPACE_IPC_CHANNELS.deleteEntry) return { deleted: true };
      if (channel === WORKSPACE_IPC_CHANNELS.renameEntry)
        return { from: 'old', to: 'new', renamed: true };
      return { workspace };
    });
    const bridge = createWorkspaceBridge(ipc).workspace;

    await bridge.startWatcher();
    await bridge.list();
    await bridge.use({ name: 'demo' });
    await bridge.current();
    await bridge.touch({ path: '/repo' });
    await bridge.ensureSetup();
    await bridge.add({ path: '/repo', setup: true });
    await bridge.remove({ name: 'demo' });
    await bridge.rename({ from: 'demo', to: 'renamed' });
    await bridge.repath({ name: 'demo', path: '/new', setup: true });
    await bridge.createDemo({ path: '/demo' });
    await bridge.listFiles({ path: 'src' });
    await bridge.listCanvas({ folder: null });
    await bridge.listSupportedFiles({ folder: null });
    await bridge.getViewport();
    await bridge.setViewport({ viewport: { offsetX: 1, offsetY: 2, scale: 0.5 } });
    await bridge.readFile({ path: 'a.md', maxChars: 10 });
    await bridge.writeFile({ path: 'a.md', content: 'hello' });
    await bridge.renameFile({ from: 'a.md', to: 'b.md' });
    await bridge.importFile({ from: '/tmp/a.png', to: 'assets' });
    await bridge.createFile({ path: 'new.md', content: '' });
    await bridge.createFolder({ path: 'notes' });
    await bridge.deleteEntry({ path: 'new', kind: 'folder' });
    await bridge.renameEntry({ from: 'old', to: 'new', kind: 'folder' });

    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.startWatcher);
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.list);
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.use, { name: 'demo' });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.current);
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.touch, { path: '/repo' });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.ensureSetup);
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.add, {
      path: '/repo',
      setup: true,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.remove, { name: 'demo' });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.rename, {
      from: 'demo',
      to: 'renamed',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.repath, {
      name: 'demo',
      path: '/new',
      setup: true,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.createDemo, { path: '/demo' });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.listFiles, { path: 'src' });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.listCanvas, { folder: null });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.listSupportedFiles, {
      folder: null,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.getViewport);
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.setViewport, {
      viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.readFile, {
      path: 'a.md',
      maxChars: 10,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.writeFile, {
      path: 'a.md',
      content: 'hello',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.renameFile, {
      from: 'a.md',
      to: 'b.md',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.importFile, {
      from: '/tmp/a.png',
      to: 'assets',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.createFile, {
      path: 'new.md',
      content: '',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.createFolder, {
      path: 'notes',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.deleteEntry, {
      path: 'new',
      kind: 'folder',
    });
    expect(ipc.invoke).toHaveBeenCalledWith(WORKSPACE_IPC_CHANNELS.renameEntry, {
      from: 'old',
      to: 'new',
      kind: 'folder',
    });
  });

  it('maps flush, update, file event, and terminal subscriptions', async () => {
    const ipc = fakeIpc();
    const native = createNativeHostBridge(
      ipc,
      { getZoomFactor: () => 1 },
      { getPathForFile: () => '' },
      { platform: 'linux', homeDir: '/home/demo' },
    );
    const update = createUpdateBridge(ipc);
    const files = createFileEventBridge(ipc);
    const terminal = createTerminalBridge(ipc);
    const onUpdate = vi.fn();
    const onFile = vi.fn();
    const onData = vi.fn();
    const flush = vi.fn(async () => false);

    native.onFlushRequest(flush);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.flushRequest)?.({});
    await Promise.resolve();
    update.onUpdateState(onUpdate);
    ipc.listeners.get(UPDATE_IPC_CHANNELS.state)?.({}, { phase: 'staged', version: '1.2.3' });
    files.onFileEvent(onFile);
    ipc.listeners.get(WATCHER_IPC_CHANNELS.fileEvent)?.(
      {},
      { type: 'change', relPath: 'a.md', isDir: false },
    );
    ipc.listeners.get(WATCHER_IPC_CHANNELS.fileEvent)?.(
      {},
      { type: 'change', relPath: '../secret.md', isDir: false },
    );
    ipc.listeners.get(WATCHER_IPC_CHANNELS.fileEvent)?.(
      {},
      {
        type: 'rename',
        fromRelPath: 'a.md',
        toRelPath: '/tmp/secret.md',
        isDir: false,
      },
    );
    terminal.onData(onData);
    ipc.listeners.get(TERMINAL_IPC_CHANNELS.data)?.({}, { id: '1', data: 'hello' });
    terminal.write('1', 'x');
    terminal.resize('1', 80, 24);
    terminal.kill('1');
    await terminal.spawn();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(ipc.send).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.flushReply, false);
    expect(onUpdate).toHaveBeenCalledWith({ phase: 'staged', version: '1.2.3' });
    expect(onFile).toHaveBeenCalledWith({ type: 'change', relPath: 'a.md', isDir: false });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith('1', 'hello');
    expect(ipc.send).toHaveBeenCalledWith(TERMINAL_IPC_CHANNELS.write, { id: '1', data: 'x' });
    expect(ipc.send).toHaveBeenCalledWith(TERMINAL_IPC_CHANNELS.resize, {
      id: '1',
      cols: 80,
      rows: 24,
    });
    expect(ipc.send).toHaveBeenCalledWith(TERMINAL_IPC_CHANNELS.kill, { id: '1' });
    expect(ipc.invoke).toHaveBeenCalledWith(TERMINAL_IPC_CHANNELS.spawn, {});
  });
});

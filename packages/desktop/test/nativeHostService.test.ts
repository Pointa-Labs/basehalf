import { describe, expect, it } from 'vitest';
import { createNativeHostService } from '../src/platform/native/browser/nativeHostService.js';

describe('nativeHostService', () => {
  it('maps workspace window and path helpers to the preload bridge', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const service = createNativeHostService({
      platform: 'darwin',
      homeDir: '/Users/demo',
      pickWorkspace: async () => {
        calls.push({ name: 'pickWorkspace', args: [] });
        return '/tmp/demo';
      },
      openWorkspace: async (name) => {
        calls.push({ name: 'openWorkspace', args: [name] });
        return { reused: false };
      },
      reopenWindow: async (name) => {
        calls.push({ name: 'reopenWindow', args: [name] });
      },
      getOpenWorkspaces: async () => {
        calls.push({ name: 'getOpenWorkspaces', args: [] });
        return ['/tmp/demo'];
      },
      notifyWorkspacesChanged: () => {
        calls.push({ name: 'notifyWorkspacesChanged', args: [] });
      },
      pathKindForFile: async (file) => {
        calls.push({ name: 'pathKindForFile', args: [file] });
        return 'file';
      },
      pathForFile: (file) => {
        calls.push({ name: 'pathForFile', args: [file] });
        return '/tmp/a.md';
      },
      openPath: async (relPath) => {
        calls.push({ name: 'openPath', args: [relPath] });
        return { ok: true };
      },
      openExternal: async (url) => {
        calls.push({ name: 'openExternal', args: [url] });
        return { ok: true };
      },
      suppressNextNativeContextMenu: () => {
        calls.push({ name: 'suppressNextNativeContextMenu', args: [] });
      },
      appVersion: async () => {
        calls.push({ name: 'appVersion', args: [] });
        return '1.2.3';
      },
      getPrefs: async () => {
        calls.push({ name: 'getPrefs', args: [] });
        return { autoUpdateCheck: true, autoDownloadUpdate: false };
      },
      setPrefs: async (patch) => {
        calls.push({ name: 'setPrefs', args: [patch] });
        return { autoUpdateCheck: patch.autoUpdateCheck ?? true, autoDownloadUpdate: false };
      },
      getZoomFactor: () => {
        calls.push({ name: 'getZoomFactor', args: [] });
        return 1.25;
      },
      zoomWindow: async (action) => {
        calls.push({ name: 'zoomWindow', args: [action] });
      },
      onZoomFactor: (handler) => {
        calls.push({ name: 'onZoomFactor', args: [handler] });
        return () => calls.push({ name: 'offZoomFactor', args: [] });
      },
      onWorkspacesWindowsChanged: (handler) => {
        calls.push({ name: 'onWorkspacesWindowsChanged', args: [handler] });
        return () => calls.push({ name: 'offWorkspacesWindowsChanged', args: [] });
      },
      onMenuOpenFolder: (handler) => {
        calls.push({ name: 'onMenuOpenFolder', args: [handler] });
        return () => calls.push({ name: 'offMenuOpenFolder', args: [] });
      },
      onMenuWorkspaceAction: (handler) => {
        calls.push({ name: 'onMenuWorkspaceAction', args: [handler] });
        return () => calls.push({ name: 'offMenuWorkspaceAction', args: [] });
      },
      onMenuOpenSettings: (handler) => {
        calls.push({ name: 'onMenuOpenSettings', args: [handler] });
        return () => calls.push({ name: 'offMenuOpenSettings', args: [] });
      },
      onMenuCloseTab: (handler) => {
        calls.push({ name: 'onMenuCloseTab', args: [handler] });
        return () => calls.push({ name: 'offMenuCloseTab', args: [] });
      },
      onFlushRequest: (handler) => {
        calls.push({ name: 'onFlushRequest', args: [handler] });
        return () => calls.push({ name: 'offFlushRequest', args: [] });
      },
    });
    const file = { name: 'a.md' } as File;
    const noop = () => {};
    const flush = async () => true;

    expect(service.platform).toBe('darwin');
    expect(service.homeDir).toBe('/Users/demo');
    expect(await service.pickWorkspace()).toBe('/tmp/demo');
    expect(await service.openWorkspace('demo')).toEqual({ reused: false });
    await service.reopenWindow(null);
    expect(await service.getOpenWorkspaces()).toEqual(['/tmp/demo']);
    service.notifyWorkspacesChanged();
    expect(await service.pathKindForFile(file)).toBe('file');
    expect(service.pathForFile(file)).toBe('/tmp/a.md');
    expect(await service.openPath('a.md')).toEqual({ ok: true });
    expect(await service.openExternal('https://example.com')).toEqual({ ok: true });
    service.suppressNextNativeContextMenu();
    expect(await service.appVersion()).toBe('1.2.3');
    expect(await service.getPrefs()).toEqual({ autoUpdateCheck: true, autoDownloadUpdate: false });
    expect(await service.setPrefs({ autoUpdateCheck: false })).toEqual({
      autoUpdateCheck: false,
      autoDownloadUpdate: false,
    });
    expect(service.getZoomFactor()).toBe(1.25);
    await service.zoomWindow('in');
    service.onZoomFactor(noop);
    service.onWorkspacesWindowsChanged(noop);
    service.onMenuOpenFolder(noop);
    service.onMenuWorkspaceAction(noop);
    service.onMenuOpenSettings(noop);
    service.onMenuCloseTab(noop);
    service.onFlushRequest(flush);

    expect(calls).toEqual([
      { name: 'pickWorkspace', args: [] },
      { name: 'openWorkspace', args: ['demo'] },
      { name: 'reopenWindow', args: [null] },
      { name: 'getOpenWorkspaces', args: [] },
      { name: 'notifyWorkspacesChanged', args: [] },
      { name: 'pathKindForFile', args: [file] },
      { name: 'pathForFile', args: [file] },
      { name: 'openPath', args: ['a.md'] },
      { name: 'openExternal', args: ['https://example.com'] },
      { name: 'suppressNextNativeContextMenu', args: [] },
      { name: 'appVersion', args: [] },
      { name: 'getPrefs', args: [] },
      { name: 'setPrefs', args: [{ autoUpdateCheck: false }] },
      { name: 'getZoomFactor', args: [] },
      { name: 'zoomWindow', args: ['in'] },
      { name: 'onZoomFactor', args: [noop] },
      { name: 'onWorkspacesWindowsChanged', args: [noop] },
      { name: 'onMenuOpenFolder', args: [noop] },
      { name: 'onMenuWorkspaceAction', args: [noop] },
      { name: 'onMenuOpenSettings', args: [noop] },
      { name: 'onMenuCloseTab', args: [noop] },
      { name: 'onFlushRequest', args: [flush] },
    ]);
  });
});

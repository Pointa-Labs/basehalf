import { describe, expect, it, vi } from 'vitest';
import {
  NativeHostMainService,
  type NativeHostStats,
  isAllowedExternalUrl,
} from '../src/platform/native/electron-main/nativeHostMainService.js';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

function stats(kind: 'dir' | 'file' | 'other'): NativeHostStats {
  return {
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

describe('NativeHostMainService', () => {
  it('picks a workspace with the sender window when one exists', async () => {
    const win = { id: 1 };
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/demo'] })),
    };
    const service = new NativeHostMainService({
      dialog: dialog as never,
      windowLocator: { fromWebContents: vi.fn(() => win as never) },
    });

    await expect(service.pickWorkspace({ id: 7 } as never)).resolves.toBe('/tmp/demo');

    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      win,
      expect.objectContaining({ properties: ['openDirectory', 'createDirectory'] }),
    );
  });

  it('returns null when the workspace picker is cancelled', async () => {
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    };
    const service = new NativeHostMainService({
      dialog: dialog as never,
      windowLocator: { fromWebContents: vi.fn(() => null) },
    });

    await expect(service.pickWorkspace({ id: 7 } as never)).resolves.toBeNull();
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('workspace') }),
    );
  });

  it('opens only resolved paths inside the sender workspace', async () => {
    const shell = { openPath: vi.fn(async () => ''), openExternal: vi.fn() };
    const resolveInsideWorkspace = vi.fn(async () => ({ ok: true as const, abs: '/ws/a.md' }));
    const service = new NativeHostMainService({ resolveInsideWorkspace, shell });

    await expect(service.openPath('/ws', 'a.md')).resolves.toEqual({ ok: true });

    expect(resolveInsideWorkspace).toHaveBeenCalledWith('/ws', 'a.md');
    expect(shell.openPath).toHaveBeenCalledWith('/ws/a.md');
  });

  it('returns an error when opening without a workspace or when shell fails', async () => {
    const shell = {
      openPath: vi.fn(async () => 'bad association'),
      openExternal: vi.fn(),
    };
    const service = new NativeHostMainService({
      resolveInsideWorkspace: vi.fn(async () => ({ ok: true as const, abs: '/ws/a.md' })),
      shell,
    });

    await expect(service.openPath(null, 'a.md')).resolves.toEqual({
      ok: false,
      error: 'No workspace open in this window.',
    });
    await expect(service.openPath('/ws', 'a.md')).resolves.toEqual({
      ok: false,
      error: 'bad association',
    });
  });

  it('classifies absolute paths without leaking stat errors', async () => {
    const service = new NativeHostMainService({
      stat: vi.fn(async (path) => {
        if (path === '/dir') return stats('dir');
        if (path === '/file') return stats('file');
        if (path === '/other') return stats('other');
        throw new Error('missing');
      }),
    });

    await expect(service.pathKind('/dir')).resolves.toBe('dir');
    await expect(service.pathKind('/file')).resolves.toBe('file');
    await expect(service.pathKind('/other')).resolves.toBeNull();
    await expect(service.pathKind('/missing')).resolves.toBeNull();
    await expect(service.pathKind('')).resolves.toBeNull();
  });

  it('allowlists GitHub repository links before delegating to the OS', async () => {
    const shell = { openExternal: vi.fn(async () => undefined), openPath: vi.fn() };
    const service = new NativeHostMainService({ shell });

    await expect(service.openExternal('https://github.com/Pointa-Labs/basehalf')).resolves.toEqual({
      ok: true,
    });
    await expect(
      service.openExternal(
        'https://github.com/octo-org/notes.compare/compare/main...topic?expand=1',
      ),
    ).resolves.toEqual({ ok: true });
    await expect(service.openExternal('https://github.com/octo-org/notes/pull/7')).resolves.toEqual(
      { ok: true },
    );
    await expect(service.openExternal('https://github.com/settings/tokens')).resolves.toEqual({
      ok: false,
      error: 'URL not allowed.',
    });
    await expect(service.openExternal('https://example.com')).resolves.toEqual({
      ok: false,
      error: 'URL not allowed.',
    });

    expect(shell.openExternal).toHaveBeenCalledTimes(3);
  });
});

describe('isAllowedExternalUrl', () => {
  it('accepts GitHub repo URLs and rejects reserved top-level routes', () => {
    expect(isAllowedExternalUrl('https://github.com/octo-org/notes')).toBe(true);
    expect(isAllowedExternalUrl('https://github.com/settings/tokens')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/login')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/octo-org')).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { MirrorNodeOperationMainService } from '../src/workbench/services/mirror/electron-main/mirrorNodeOperationMainService.js';

describe('MirrorNodeOperationMainService', () => {
  it('delegates rename to the badge mirror choke point', async () => {
    const badges = {
      rename: vi.fn(async () => ({ badge: null, updatedRefs: [], focusUpdated: false })),
    };
    const service = createService({ badges });

    await expect(
      service.rename('/repo', { from: 'old.md', to: 'new.md', kind: 'file', ifExists: true }),
    ).resolves.toEqual({ badge: null, updatedRefs: [], focusUpdated: false });
    expect(badges.rename).toHaveBeenCalledWith('/repo', {
      from: 'old.md',
      to: 'new.md',
      kind: 'file',
      ifExists: true,
    });
  });

  it('purges deleted folder nodes across badge, canvas, adhd, and focus services', async () => {
    const badges = {
      delete: vi.fn(async () => ({ deleted: true })),
      list: vi.fn(async () => ({
        badges: [
          { path: 'docs/a.md', kind: 'file', references: [] },
          { path: 'docs/sub', kind: 'folder', references: [] },
          { path: 'other.md', kind: 'file', references: [] },
        ],
      })),
    };
    const canvas = { purgeNode: vi.fn(async () => ({ removed: 1 })) };
    const adhd = { purgeNode: vi.fn(async () => ({ removed: 1 })) };
    const focus = {
      purgeNode: vi.fn(async () => ({ removed: 1, cleared: false })),
      pruneDangling: vi.fn(async () => ({ cleared: true })),
    };
    const service = createService({ badges, canvas, adhd, focus });

    await service.purgeDeletedNode('/repo', { path: 'docs', kind: 'folder' });

    expect(badges.delete).toHaveBeenCalledWith('/repo', { file: 'docs', kind: 'folder' });
    expect(badges.delete).toHaveBeenCalledWith('/repo', { file: 'docs/a.md', kind: 'file' });
    expect(badges.delete).toHaveBeenCalledWith('/repo', { file: 'docs/sub', kind: 'folder' });
    expect(badges.delete).not.toHaveBeenCalledWith('/repo', {
      file: 'other.md',
      kind: 'file',
    });
    expect(canvas.purgeNode).toHaveBeenCalledWith('/repo', { path: 'docs', kind: 'folder' });
    expect(adhd.purgeNode).toHaveBeenCalledWith('/repo', { path: 'docs' });
    expect(focus.purgeNode).toHaveBeenCalledWith('/repo', { path: 'docs' });
    expect(focus.pruneDangling).toHaveBeenCalledWith('/repo');
  });

  it('keeps deletion cleanup best-effort after badge purge succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createService({
      canvas: {
        purgeNode: vi.fn(async () => {
          throw new Error('canvas failed');
        }),
      },
    });

    try {
      await expect(service.purgeDeletedNode('/repo', { path: 'a.md', kind: 'file' })).resolves.toBe(
        undefined,
      );
      expect(warn).toHaveBeenCalledWith(
        '[bh] delete cascade canvas.purgeNode failed:',
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

function createService(overrides: {
  readonly badges?: unknown;
  readonly canvas?: unknown;
  readonly adhd?: unknown;
  readonly focus?: unknown;
}): MirrorNodeOperationMainService {
  return new MirrorNodeOperationMainService({
    badges: {
      delete: vi.fn(async () => ({ deleted: true })),
      list: vi.fn(async () => ({ badges: [] })),
      rename: vi.fn(async () => ({ badge: null, updatedRefs: [], focusUpdated: false })),
      ...(overrides.badges as object),
    } as never,
    canvas: {
      purgeNode: vi.fn(async () => ({ removed: 0 })),
      ...(overrides.canvas as object),
    } as never,
    adhd: {
      purgeNode: vi.fn(async () => ({ removed: 0 })),
      ...(overrides.adhd as object),
    } as never,
    focus: {
      purgeNode: vi.fn(async () => ({ removed: 0, cleared: false })),
      pruneDangling: vi.fn(async () => ({ cleared: false })),
      ...(overrides.focus as object),
    } as never,
  });
}

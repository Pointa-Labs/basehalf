import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFilesMainService } from '../src/platform/files/electron-main/workspaceFilesMainService.js';

describe('WorkspaceFilesMainService', () => {
  it('owns workspace-relative file reads and writes behind the files boundary', async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs', 'note.md'), 'hello world');
      const service = new WorkspaceFilesMainService();

      await expect(service.listFiles(root, { path: 'docs' })).resolves.toEqual({
        path: join(root, 'docs'),
        entries: [{ name: 'note.md', type: 'file' }],
      });
      await expect(service.readFile(root, { path: 'docs/note.md', maxChars: 5 })).resolves.toEqual({
        path: 'docs/note.md',
        content: 'hello',
        truncated: true,
      });
      await expect(
        service.writeFile(root, { path: 'docs/new.md', content: 'new' }),
      ).resolves.toEqual({ path: 'docs/new.md', bytes: 3 });
      await expect(readFile(join(root, 'docs', 'new.md'), 'utf8')).resolves.toBe('new');
    });
  });

  it('notifies mirror participants when workspace entries move or delete', async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs', 'note.md'), 'note');
      const mirror = {
        rename: vi.fn(async () => undefined),
        purgeDeletedNode: vi.fn(async () => undefined),
      };
      const trash = vi.fn(async () => undefined);
      const service = new WorkspaceFilesMainService({ mirror, trash });

      await expect(
        service.renameEntry(root, { from: 'docs', to: 'notes', kind: 'folder' }),
      ).resolves.toEqual({ from: 'docs', to: 'notes', renamed: true });
      await expect(readFile(join(root, 'notes', 'note.md'), 'utf8')).resolves.toBe('note');
      expect(mirror.rename).toHaveBeenCalledWith(root, {
        from: 'docs',
        to: 'notes',
        kind: 'folder',
        ifExists: true,
      });

      await expect(service.deleteEntry(root, { path: 'notes', kind: 'folder' })).resolves.toEqual({
        deleted: true,
      });
      expect(trash).toHaveBeenCalledTimes(1);
      expect(trash.mock.calls[0]?.[0].endsWith('/notes')).toBe(true);
      expect(mirror.purgeDeletedNode).toHaveBeenCalledWith(root, {
        path: 'notes',
        kind: 'folder',
      });
    });
  });
});

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'basehalf-workspace-files-main-service-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

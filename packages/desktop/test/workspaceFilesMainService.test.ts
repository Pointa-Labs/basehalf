import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFilesMainService } from '../src/platform/files/electron-main/workspaceFilesMainService.js';

describe('WorkspaceFilesMainService', () => {
  it('owns workspace-relative file reads, writes, and supported-file listing behind the files boundary', async () => {
    await withTempDir(async (baseDir) => {
      const root = join(baseDir, 'work');
      const outside = join(baseDir, 'outside');
      await mkdir(root);
      await mkdir(outside);
      await mkdir(join(root, 'notes'));
      await mkdir(join(root, 'node_modules'));
      await writeFile(join(root, 'b.md'), 'bee');
      await writeFile(join(root, 'a.md'), 'alpha needle');
      await writeFile(join(root, 'LICENSE'), 'license');
      await writeFile(join(root, '.DS_Store'), 'junk');
      await writeFile(join(root, 'notes', 'about.md'), 'hello world');
      await writeFile(join(root, 'node_modules', 'skip.md'), 'skip');
      await writeFile(join(outside, 'secret.md'), 'secret');
      await symlink(outside, join(root, 'escape'));
      const service = new WorkspaceFilesMainService();

      await expect(service.listFiles(root, { path: root })).resolves.toEqual({
        path: root,
        entries: [
          { name: 'node_modules', type: 'dir' },
          { name: 'notes', type: 'dir' },
          { name: '.DS_Store', type: 'file' },
          { name: 'a.md', type: 'file' },
          { name: 'b.md', type: 'file' },
          { name: 'LICENSE', type: 'file' },
        ],
      });
      await expect(service.listSupportedFiles(root, { folder: null })).resolves.toEqual({
        files: ['a.md', 'b.md', 'LICENSE', 'notes/about.md'],
      });
      await expect(
        service.readFile(root, { path: 'notes/about.md', maxChars: 5 }),
      ).resolves.toEqual({
        path: 'notes/about.md',
        content: 'hello',
        truncated: true,
      });
      await expect(
        service.writeFile(root, { path: 'nested/new.md', content: 'new' }),
      ).resolves.toEqual({
        path: 'nested/new.md',
        bytes: 3,
      });
      await expect(readFile(join(root, 'nested/new.md'), 'utf8')).resolves.toBe('new');
      await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
      await expect(service.readFile(root, { path: 'binary.bin' })).resolves.toMatchObject({
        path: 'binary.bin',
        binary: true,
      });
      await expect(service.readFile(null, { path: 'a.md' })).rejects.toThrow('No workspace bound');
      await expect(
        service.writeFile(root, { path: '../outside.md', content: 'x' }),
      ).rejects.toThrow('Path traversal rejected');
      await expect(
        service.writeFile(root, { path: 'nested//bad.md', content: 'x' }),
      ).rejects.toThrow('Path must be normalized and relative');
      await expect(service.listSupportedFiles(root, { folder: '.' })).rejects.toThrow(
        'Path must be normalized and relative',
      );
      await symlink(join(outside, 'secret.md'), join(root, 'link.md'));
      await expect(service.writeFile(root, { path: 'link.md', content: 'x' })).rejects.toThrow(
        /outside the workspace/,
      );
      await expect(readFile(join(outside, 'secret.md'), 'utf8')).resolves.toBe('secret');
      await mkdir(join(root, 'folder.md'));
      await expect(service.renameFile(root, { from: 'folder.md', to: 'moved.md' })).rejects.toThrow(
        'Path is not a file',
      );
      await symlink(join(root, 'a.md'), join(root, 'inside-link.md'));
      await expect(
        service.renameFile(root, { from: 'inside-link.md', to: 'moved.md' }),
      ).rejects.toThrow(/outside the workspace/);
      await expect(readFile(join(root, 'a.md'), 'utf8')).resolves.toBe('alpha needle');
    });
  });

  it('owns workspace file creation, import, and rename behind the files boundary', async () => {
    await withTempDir(async (baseDir) => {
      const root = join(baseDir, 'work');
      const outside = join(baseDir, 'outside');
      await mkdir(root);
      await mkdir(outside);
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs', 'note.md'), 'note');
      await writeFile(join(root, 'docs', 'taken.md'), 'taken');
      await writeFile(join(outside, 'note.md'), 'external');
      await writeFile(join(outside, 'photo.png'), Buffer.from([1, 2, 3]));
      const service = new WorkspaceFilesMainService();

      await expect(
        service.createFile(root, { path: 'docs/taken.md', content: 'created' }),
      ).resolves.toEqual({ path: 'docs/taken-2.md' });
      await expect(readFile(join(root, 'docs/taken-2.md'), 'utf8')).resolves.toBe('created');

      await expect(service.createFolder(root, { path: 'docs' })).resolves.toEqual({
        path: 'docs-2',
      });
      await expect(stat(join(root, 'docs-2'))).resolves.toMatchObject({});

      await expect(
        service.renameFile(root, { from: 'docs/note.md', to: 'docs/taken.md' }),
      ).resolves.toEqual({ from: 'docs/note.md', to: 'docs/taken-3.md', renamed: true });
      await expect(readFile(join(root, 'docs/taken-3.md'), 'utf8')).resolves.toBe('note');

      await expect(
        service.importFile(root, { from: join(outside, 'note.md'), to: 'docs' }),
      ).resolves.toEqual({
        path: 'docs/note.md',
        name: 'note.md',
        imported: true,
        supported: true,
      });
      await expect(readFile(join(root, 'docs/note.md'), 'utf8')).resolves.toBe('external');
      await expect(readFile(join(outside, 'note.md'), 'utf8')).resolves.toBe('external');

      await expect(
        service.importFile(root, { from: join(root, 'docs/note.md'), to: null }),
      ).resolves.toEqual({
        path: 'docs/note.md',
        name: 'note.md',
        imported: false,
        supported: true,
      });

      await expect(
        service.importFile(root, { from: join(outside, 'photo.png'), to: 'missing' }),
      ).rejects.toThrow('Import destination is not a folder');
      await expect(
        service.createFile(root, { path: '../outside.md', content: 'x' }),
      ).rejects.toThrow('Path traversal rejected');
    });
  });

  it('notifies mirror participants when workspace entries move or delete', async () => {
    await withTempDir(async (baseDir) => {
      const root = join(baseDir, 'work');
      await mkdir(root);
      await writeFile(join(root, 'old.md'), 'old');
      await writeFile(join(root, 'taken.md'), 'taken');
      await mkdir(join(root, 'docs', 'sub'), { recursive: true });
      await writeFile(join(root, 'docs', 'sub', 'a.md'), 'a');
      const mirror = {
        rename: vi.fn(async () => undefined),
        purgeDeletedNode: vi.fn(async () => undefined),
      };
      const trashed: string[] = [];
      const service = new WorkspaceFilesMainService({ mirror, trash });
      async function trash(path: string): Promise<void> {
        trashed.push(path);
        await rm(path, { recursive: true });
      }

      await expect(
        service.renameEntry(root, { from: 'old.md', to: 'taken.md', kind: 'file' }),
      ).resolves.toEqual({ from: 'old.md', to: 'taken-2.md', renamed: true });
      await expect(readFile(join(root, 'taken-2.md'), 'utf8')).resolves.toBe('old');
      expect(mirror.rename).toHaveBeenCalledWith(root, {
        from: 'old.md',
        to: 'taken-2.md',
        kind: 'file',
        ifExists: true,
      });

      await expect(
        service.renameEntry(root, { from: 'docs', to: 'docs-renamed', kind: 'folder' }),
      ).resolves.toEqual({ from: 'docs', to: 'docs-renamed', renamed: true });
      await expect(readFile(join(root, 'docs-renamed', 'sub', 'a.md'), 'utf8')).resolves.toBe('a');
      expect(mirror.rename).toHaveBeenCalledWith(root, {
        from: 'docs',
        to: 'docs-renamed',
        kind: 'folder',
        ifExists: true,
      });

      await expect(service.deleteEntry(root, { path: 'taken.md', kind: 'folder' })).rejects.toThrow(
        'Path is not a folder',
      );
      await expect(readFile(join(root, 'taken.md'), 'utf8')).resolves.toBe('taken');

      await expect(
        service.deleteEntry(root, { path: 'docs-renamed', kind: 'folder' }),
      ).resolves.toEqual({ deleted: true });
      expect(trashed).toHaveLength(1);
      expect(trashed[0]?.endsWith('/work/docs-renamed')).toBe(true);
      await expect(stat(join(root, 'docs-renamed'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(mirror.purgeDeletedNode).toHaveBeenCalledWith(root, {
        path: 'docs-renamed',
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

import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceFileOperationService } from '../src/workbench/services/workspace/browser/workspaceFileOperationService.js';

describe('workspaceFileOperationService', () => {
  it('delegates file operations through the workbench file-operation boundary', async () => {
    const backend = {
      createFile: vi.fn(async (path: string) => ({ path, created: true })),
      createFolder: vi.fn(async (path: string) => ({ path, created: true })),
      deleteEntry: vi.fn(async (path: string, kind: 'file' | 'folder') => ({
        path,
        kind,
        deleted: true,
      })),
      importFile: vi.fn(async (from: string, to: string | null = null) => ({
        path: to === null ? 'paper.pdf' : `${to}/paper.pdf`,
        name: 'paper.pdf',
        imported: true,
        supported: true,
      })),
      renameEntry: vi.fn(async (from: string, to: string, kind: 'file' | 'folder') => ({
        from,
        to,
        kind,
        renamed: true,
      })),
      renameFile: vi.fn(async (from: string, to: string) => ({ from, to, renamed: true })),
    };
    const service = createWorkspaceFileOperationService(backend);

    await expect(service.createFile('notes.md')).resolves.toEqual({
      path: 'notes.md',
      created: true,
    });
    await expect(service.createFolder('docs')).resolves.toEqual({ path: 'docs', created: true });
    await expect(service.deleteEntry('docs', 'folder')).resolves.toEqual({
      path: 'docs',
      kind: 'folder',
      deleted: true,
    });
    await expect(service.importFile('/downloads/paper.pdf', 'inbox')).resolves.toEqual({
      path: 'inbox/paper.pdf',
      name: 'paper.pdf',
      imported: true,
      supported: true,
    });
    await expect(service.renameEntry('docs/a.md', 'docs/b.md', 'file')).resolves.toEqual({
      from: 'docs/a.md',
      to: 'docs/b.md',
      kind: 'file',
      renamed: true,
    });
    await expect(service.renameFile('a.md', 'b.md')).resolves.toEqual({
      from: 'a.md',
      to: 'b.md',
      renamed: true,
    });

    expect(backend.createFile).toHaveBeenCalledWith('notes.md', {});
    expect(backend.createFolder).toHaveBeenCalledWith('docs');
    expect(backend.deleteEntry).toHaveBeenCalledWith('docs', 'folder');
    expect(backend.importFile).toHaveBeenCalledWith('/downloads/paper.pdf', 'inbox');
    expect(backend.renameEntry).toHaveBeenCalledWith('docs/a.md', 'docs/b.md', 'file');
    expect(backend.renameFile).toHaveBeenCalledWith('a.md', 'b.md');
  });
});

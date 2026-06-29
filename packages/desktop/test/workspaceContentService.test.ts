import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceContentService } from '../src/workbench/services/workspace/browser/workspaceContentService.js';

describe('workspaceContentService', () => {
  it('delegates workspace file listing through the workbench content boundary', async () => {
    const backend = {
      listFiles: vi.fn(async (path: string) => ({
        path,
        entries: [{ name: 'notes.md', type: 'file' as const }],
      })),
      listSupportedFiles: vi.fn(async (folder: string | null) =>
        folder === null ? ['notes.md'] : [`${folder}/notes.md`],
      ),
      readFile: vi.fn(async (path: string, options = {}) => ({
        path,
        content: options.maxChars === 4 ? 'note' : 'notes',
        ...(options.maxChars === 4 && { truncated: true }),
      })),
    };
    const service = createWorkspaceContentService(backend);

    await expect(service.listFiles('/repo')).resolves.toEqual({
      path: '/repo',
      entries: [{ name: 'notes.md', type: 'file' }],
    });
    await expect(service.listSupportedFiles(null)).resolves.toEqual(['notes.md']);
    await expect(service.listSupportedFiles('docs')).resolves.toEqual(['docs/notes.md']);
    await expect(service.readFile('notes.md', { maxChars: 4 })).resolves.toEqual({
      path: 'notes.md',
      content: 'note',
      truncated: true,
    });
    expect(backend.listFiles).toHaveBeenCalledWith('/repo');
    expect(backend.listSupportedFiles).toHaveBeenCalledWith(null);
    expect(backend.listSupportedFiles).toHaveBeenCalledWith('docs');
    expect(backend.readFile).toHaveBeenCalledWith('notes.md', { maxChars: 4 });
  });
});

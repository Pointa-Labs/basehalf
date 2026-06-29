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
    };
    const service = createWorkspaceContentService(backend);

    await expect(service.listFiles('/repo')).resolves.toEqual({
      path: '/repo',
      entries: [{ name: 'notes.md', type: 'file' }],
    });
    await expect(service.listSupportedFiles(null)).resolves.toEqual(['notes.md']);
    await expect(service.listSupportedFiles('docs')).resolves.toEqual(['docs/notes.md']);
    expect(backend.listFiles).toHaveBeenCalledWith('/repo');
    expect(backend.listSupportedFiles).toHaveBeenCalledWith(null);
    expect(backend.listSupportedFiles).toHaveBeenCalledWith('docs');
  });
});

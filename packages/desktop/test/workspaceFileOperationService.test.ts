import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceFileOperationService } from '../src/workbench/services/workspace/browser/workspaceFileOperationService.js';

describe('workspaceFileOperationService', () => {
  it('delegates import operations through the workbench file-operation boundary', async () => {
    const backend = {
      importFile: vi.fn(async (from: string, to: string | null = null) => ({
        path: to === null ? 'paper.pdf' : `${to}/paper.pdf`,
        name: 'paper.pdf',
        imported: true,
        supported: true,
      })),
    };
    const service = createWorkspaceFileOperationService(backend);

    await expect(service.importFile('/downloads/paper.pdf', 'inbox')).resolves.toEqual({
      path: 'inbox/paper.pdf',
      name: 'paper.pdf',
      imported: true,
      supported: true,
    });
    expect(backend.importFile).toHaveBeenCalledWith('/downloads/paper.pdf', 'inbox');
  });
});

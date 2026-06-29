import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceCanvasDataService } from '../src/workbench/services/workspace/browser/workspaceCanvasDataService.js';

describe('workspaceCanvasDataService', () => {
  it('delegates canvas workspace reads through the workbench data boundary', async () => {
    const backend = {
      listCanvas: vi.fn(async (folder: string | null) => ({
        folder,
        children: [
          {
            path: folder === null ? 'notes.md' : `${folder}/notes.md`,
            kind: 'file' as const,
            references: [],
            referenced_by: [],
          },
        ],
        edges: [],
      })),
      listSupportedFiles: vi.fn(async (folder: string | null) =>
        folder === null ? ['notes.md'] : [`${folder}/notes.md`],
      ),
      readFile: vi.fn(async (path: string, options = {}) => ({
        path,
        content: options.maxChars === 4 ? 'note' : 'notes',
        ...(options.maxChars === 4 && { truncated: true }),
      })),
      setViewport: vi.fn(async () => undefined),
    };
    const service = createWorkspaceCanvasDataService(backend);

    await expect(service.listCanvas('docs')).resolves.toEqual({
      folder: 'docs',
      children: [
        {
          path: 'docs/notes.md',
          kind: 'file',
          references: [],
          referenced_by: [],
        },
      ],
      edges: [],
    });
    await expect(service.listSupportedFiles(null)).resolves.toEqual(['notes.md']);
    await expect(service.readFile('notes.md', { maxChars: 4 })).resolves.toEqual({
      path: 'notes.md',
      content: 'note',
      truncated: true,
    });
    await expect(service.setViewport({ offsetX: 1, offsetY: 2, scale: 0.5 })).resolves.toBe(
      undefined,
    );

    expect(backend.listCanvas).toHaveBeenCalledWith('docs');
    expect(backend.listSupportedFiles).toHaveBeenCalledWith(null);
    expect(backend.readFile).toHaveBeenCalledWith('notes.md', { maxChars: 4 });
    expect(backend.setViewport).toHaveBeenCalledWith({ offsetX: 1, offsetY: 2, scale: 0.5 });
  });
});

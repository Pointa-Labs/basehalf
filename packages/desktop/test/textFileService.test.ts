import { describe, expect, it, vi } from 'vitest';
import { createTextFileService } from '../src/workbench/services/textfile/browser/textFileService.js';

describe('textFileService', () => {
  it('delegates text file reads and writes through the workbench service boundary', async () => {
    const backend = {
      readFile: vi.fn(async (path: string) => ({ path, content: 'hello' })),
      writeFile: vi.fn(async (path: string, content: string) => ({ path, bytes: content.length })),
    };
    const service = createTextFileService(backend);

    await expect(service.read('a.md')).resolves.toEqual({ path: 'a.md', content: 'hello' });
    await expect(service.write('a.md', 'hello')).resolves.toEqual({ path: 'a.md', bytes: 5 });
    expect(backend.readFile).toHaveBeenCalledWith('a.md');
    expect(backend.writeFile).toHaveBeenCalledWith('a.md', 'hello');
  });
});

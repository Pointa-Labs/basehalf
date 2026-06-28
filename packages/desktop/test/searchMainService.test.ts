import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type SearchBackendProvider,
  WorkbenchSearchBackendProvider,
} from '../src/workbench/services/search/electron-main/searchBackendProvider.js';
import { SearchMainService } from '../src/workbench/services/search/electron-main/searchMainService.js';

describe('SearchMainService', () => {
  it('delegates search operations to the configured backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const backend = {
      async query(...args: [string | null, { query: string; maxFiles: number }]) {
        calls.push({ name: 'query', args });
        return { query: 'needle', hits: [{ file: 'a.md', matches: [], total: 1 }] };
      },
      async brief(...args: [string | null, { query: string; maxFiles: number }]) {
        calls.push({ name: 'brief', args });
        return { query: 'needle', brief: 'brief', files: ['a.md'] };
      },
    } as unknown as SearchBackendProvider;
    const service = new SearchMainService(backend);

    await expect(service.query('/repo', { query: 'needle', maxFiles: 3 })).resolves.toEqual({
      query: 'needle',
      hits: [{ file: 'a.md', matches: [], total: 1 }],
    });
    await expect(service.brief('/repo', { query: 'needle', maxFiles: 2 })).resolves.toEqual({
      query: 'needle',
      brief: 'brief',
      files: ['a.md'],
    });

    expect(calls).toEqual([
      { name: 'query', args: ['/repo', { query: 'needle', maxFiles: 3 }] },
      { name: 'brief', args: ['/repo', { query: 'needle', maxFiles: 2 }] },
    ]);
  });

  it('runs workbench search through explicit workspace and badge services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'basehalf-search-'));
    try {
      await mkdir(join(root, 'notes'));
      const workspace = {
        listFiles: vi.fn(async (_workspaceRoot: string | null, args: { path: string }) => {
          if (args.path === root) {
            return {
              path: root,
              entries: [
                { name: 'plain.md', type: 'file' as const },
                { name: 'notes', type: 'dir' as const },
              ],
            };
          }
          return {
            path: args.path,
            entries: [{ name: 'about.md', type: 'file' as const }],
          };
        }),
        readFile: vi.fn(async (_workspaceRoot: string | null, args: { path: string }) => ({
          path: args.path,
          content: args.path === 'plain.md' ? 'needle once' : 'needle twice\nanother needle line',
        })),
      };
      const badges = {
        list: vi.fn(async () => ({
          badges: [
            {
              path: 'notes/about.md',
              kind: 'file' as const,
              description: 'A note about needle',
              references: [],
            },
          ],
        })),
        get: vi.fn(async (_workspaceRoot: string | null, args: { file: string }) =>
          args.file === 'notes/about.md'
            ? {
                path: args.file,
                kind: 'file' as const,
                description: 'A note about needle',
                references: ['plain.md'],
                referenced_by: ['index.md'],
              }
            : null,
        ),
      };
      const backend = new WorkbenchSearchBackendProvider({ workspace, badges });

      await expect(backend.query(root, { query: 'needle' })).resolves.toMatchObject({
        query: 'needle',
        hits: [
          { file: 'notes/about.md', total: 2 },
          { file: 'plain.md', total: 1 },
        ],
      });

      const brief = await backend.brief(root, { query: 'needle', maxFiles: 1 });
      expect(brief.files).toEqual(['notes/about.md']);
      expect(brief.brief).toContain('description: A note about needle');
      expect(brief.brief).toContain('-> plain.md');
      expect(brief.brief).toContain('<- index.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

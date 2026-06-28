import { describe, expect, it } from 'vitest';
import {
  type GitBackendProvider,
  GitCliBackendProvider,
} from '../src/workbench/contrib/scm/electron-main/gitBackendProvider.js';
import { GitMainService } from '../src/workbench/contrib/scm/electron-main/gitMainService.js';

describe('GitMainService', () => {
  it('delegates typed SCM operations to the configured Git backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const backend = {
      async stage(...args: [string | null, readonly string[]]) {
        calls.push({ name: 'stage', args });
      },
      async deleteWorkspaceEntry(...args: [string | null, string, 'file' | 'folder']) {
        calls.push({ name: 'deleteWorkspaceEntry', args });
      },
      async show(...args: [string | null, string, string]) {
        calls.push({ name: 'show', args });
        return { content: 'content' };
      },
      async diff(...args: [string | null, string, { staged?: boolean }]) {
        calls.push({ name: 'diff', args });
        return { diff: 'patch' };
      },
      async searchHistory(...args: [string | null, { query: string }]) {
        calls.push({ name: 'searchHistory', args });
        return { commits: [{ hash: 'hit' }] };
      },
      async commitFiles(...args: [string | null, string]) {
        calls.push({ name: 'commitFiles', args });
        return { files: [{ path: 'a.ts', status: 'M' }] };
      },
      async stashList(...args: [string | null]) {
        calls.push({ name: 'stashList', args });
        return { entries: [{ ref: 'stash@{0}', message: 'wip' }] };
      },
    } as unknown as GitBackendProvider;
    const service = new GitMainService(backend);

    await service.stage('/repo', ['a.ts']);
    await service.deleteWorkspaceEntry('/repo', 'dir', 'folder');
    expect(await service.show('/repo', 'HEAD', 'a.ts')).toBe('content');
    expect(await service.diff('/repo', 'a.ts', { staged: true })).toBe('patch');
    expect(await service.searchHistory('/repo', { query: 'needle' })).toEqual([{ hash: 'hit' }]);
    expect(await service.commitFiles('/repo', 'abc')).toEqual([{ path: 'a.ts', status: 'M' }]);
    expect(await service.stashList('/repo')).toEqual([{ ref: 'stash@{0}', message: 'wip' }]);

    expect(calls).toEqual([
      { name: 'stage', args: ['/repo', ['a.ts']] },
      { name: 'deleteWorkspaceEntry', args: ['/repo', 'dir', 'folder'] },
      { name: 'show', args: ['/repo', 'HEAD', 'a.ts'] },
      { name: 'diff', args: ['/repo', 'a.ts', { staged: true }] },
      { name: 'searchHistory', args: ['/repo', { query: 'needle' }] },
      { name: 'commitFiles', args: ['/repo', 'abc'] },
      { name: 'stashList', args: ['/repo'] },
    ]);
  });

  it('runs Git operations through the desktop-native CLI backend provider', async () => {
    const calls: Array<{ args: readonly string[]; cwd: string; stdin?: string }> = [];
    const deleted: Array<{ workspaceRoot: string | null; path: string; kind: 'file' | 'folder' }> =
      [];
    const backend = new GitCliBackendProvider({
      git: async (args, opts) => {
        calls.push({ args, cwd: opts.cwd, ...(opts.stdin !== undefined && { stdin: opts.stdin }) });
        if (args[0] === 'status') {
          return {
            stdout: '## main...origin/main [ahead 1]\0 M a.ts\0?? b.ts\0',
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      deleteWorkspaceEntry: async (workspaceRoot, args) => {
        deleted.push({ workspaceRoot, path: args.path, kind: args.kind });
      },
    });

    expect(await backend.status('/repo')).toMatchObject({
      isRepo: true,
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
    });
    await backend.stage('/repo', ['a.ts']);
    await backend.commit('/repo', 'msg');
    await backend.deleteWorkspaceEntry('/repo', 'b.ts', 'file');

    expect(calls).toEqual([
      { args: ['status', '--porcelain=v1', '-z', '--branch'], cwd: '/repo' },
      { args: ['add', '--', 'a.ts'], cwd: '/repo' },
      { args: ['commit', '-F', '-'], cwd: '/repo', stdin: 'msg' },
    ]);
    expect(deleted).toEqual([{ workspaceRoot: '/repo', path: 'b.ts', kind: 'file' }]);
  });

  it('refuses to delete the workspace root through the CLI backend fallback', async () => {
    const backend = new GitCliBackendProvider({
      git: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });

    await expect(backend.deleteWorkspaceEntry('/repo', '.', 'folder')).rejects.toThrow(
      'Path must name an entry inside the workspace.',
    );
  });

  it('reports a friendly pull error when the branch has no upstream', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args) => {
        calls.push([...args]);
        if (args[0] === 'status') {
          return { stdout: '## main\0', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await expect(backend.pull('/repo')).rejects.toThrow(
      'The current branch has no upstream branch. Use Publish Branch first.',
    );
    expect(calls).toEqual([['status', '--porcelain=v1', '-z', '--branch']]);
  });
});

import { describe, expect, it } from 'vitest';
import { GitErrorCodes } from '../src/workbench/contrib/scm/common/git.js';
import type { GitBackendProvider } from '../src/workbench/contrib/scm/electron-main/gitBackend.js';
import { GitCliBackendProvider } from '../src/workbench/contrib/scm/electron-main/gitBackendProvider.js';
import { GitMainService } from '../src/workbench/contrib/scm/electron-main/gitMainService.js';

describe('GitMainService', () => {
  it('delegates typed SCM operations to the configured Git backend provider', async () => {
    const calls: Array<{ name: string; args: readonly unknown[] }> = [];
    const backend = {
      async stage(...args: [string | null, readonly string[]]) {
        calls.push({ name: 'stage', args });
      },
      async publish(...args: [string | null, { remote?: string }]) {
        calls.push({ name: 'publish', args });
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
      async commitFiles(...args: [string | null, string, string?]) {
        calls.push({ name: 'commitFiles', args });
        return { files: [{ path: 'a.ts', status: 'M' }] };
      },
      async mergeBase(...args: [string | null, readonly string[]]) {
        calls.push({ name: 'mergeBase', args });
        return { ref: 'base' };
      },
      async stashList(...args: [string | null]) {
        calls.push({ name: 'stashList', args });
        return { entries: [{ ref: 'stash@{0}', message: 'wip' }] };
      },
    } as unknown as GitBackendProvider;
    const service = new GitMainService(backend);

    await service.stage('/repo', ['a.ts']);
    await service.publish('/repo', { remote: 'origin' });
    await service.deleteWorkspaceEntry('/repo', 'dir', 'folder');
    expect(await service.show('/repo', 'HEAD', 'a.ts')).toBe('content');
    expect(await service.diff('/repo', 'a.ts', { staged: true })).toBe('patch');
    expect(await service.searchHistory('/repo', { query: 'needle' })).toEqual([{ hash: 'hit' }]);
    expect(await service.commitFiles('/repo', 'abc', 'parent')).toEqual([
      { path: 'a.ts', status: 'M' },
    ]);
    expect(await service.mergeBase('/repo', ['main', 'origin/main'])).toBe('base');
    expect(await service.stashList('/repo')).toEqual([{ ref: 'stash@{0}', message: 'wip' }]);

    expect(calls).toEqual([
      { name: 'stage', args: ['/repo', ['a.ts']] },
      { name: 'publish', args: ['/repo', { remote: 'origin' }] },
      { name: 'deleteWorkspaceEntry', args: ['/repo', 'dir', 'folder'] },
      { name: 'show', args: ['/repo', 'HEAD', 'a.ts'] },
      { name: 'diff', args: ['/repo', 'a.ts', { staged: true }] },
      { name: 'searchHistory', args: ['/repo', { query: 'needle' }] },
      { name: 'commitFiles', args: ['/repo', 'abc', 'parent'] },
      { name: 'mergeBase', args: ['/repo', ['main', 'origin/main']] },
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
        if (args[0] === 'remote' && args[1] === '--verbose') {
          return {
            stdout:
              'origin https://github.com/acme/repo.git (fetch)\norigin git@github.com:acme/repo.git (push)\n',
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
    await backend.publish('/repo', { remote: 'origin' });
    await backend.commit('/repo', 'msg');
    await backend.deleteWorkspaceEntry('/repo', 'b.ts', 'file');

    expect(calls).toEqual([
      { args: ['status', '--porcelain=v1', '-z', '--branch'], cwd: '/repo' },
      { args: ['add', '--', 'a.ts'], cwd: '/repo' },
      { args: ['status', '--porcelain=v1', '-z', '--branch'], cwd: '/repo' },
      { args: ['remote', '--verbose'], cwd: '/repo' },
      { args: ['push', '-u', 'origin', 'main'], cwd: '/repo' },
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

  it('classifies pull without upstream before running raw git pull', async () => {
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

    await expect(backend.pull('/repo')).rejects.toMatchObject({
      gitErrorCode: GitErrorCodes.NoUpstreamBranch,
      gitCommand: 'pull',
      stderr: expect.stringContaining('Publish this branch first'),
    });
    expect(calls).toEqual([['status', '--porcelain=v1', '-z', '--branch']]);
  });

  it('loads commit files relative to an explicit parent commit', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args) => {
        calls.push([...args]);
        if (args[0] === 'diff') return { stdout: 'M\u0000a.ts\u0000', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await expect(backend.commitFiles('/repo', 'merge', 'parent')).resolves.toEqual({
      files: [{ path: 'a.ts', status: 'M' }],
    });
    expect(calls).toEqual([['diff', '--name-status', '-z', 'parent', 'merge']]);
  });

  it('resolves a merge-base through the CLI backend provider', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args) => {
        calls.push([...args]);
        if (args[0] === 'merge-base') {
          return { stdout: 'base\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await expect(backend.mergeBase('/repo', ['main', 'origin/main'])).resolves.toEqual({
      ref: 'base',
    });
    expect(calls).toEqual([['merge-base', 'main', 'origin/main']]);
  });

  it('loads refs with local upstream metadata for VS Code-style tracking checkout', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args) => {
        calls.push([...args]);
        if (args[0] === 'status') {
          return { stdout: '## main...origin/main\0', stderr: '', exitCode: 0 };
        }
        if (args[0] === 'for-each-ref') {
          return {
            stdout: [
              'refs/heads/main\u0000abc\u0000origin/main',
              'refs/remotes/origin/main\u0000abc\u0000',
              'refs/tags/v1\u0000tag\u0000',
            ].join('\n'),
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await expect(
      backend.refs('/repo', { includeRemote: true, includeTags: true }),
    ).resolves.toEqual({
      current: 'main',
      refs: [
        {
          id: 'refs/heads/main',
          name: 'main',
          type: 'head',
          current: true,
          upstream: 'origin/main',
          commit: 'abc',
        },
        {
          id: 'refs/remotes/origin/main',
          name: 'origin/main',
          type: 'remoteHead',
          current: false,
          remote: 'origin',
          commit: 'abc',
        },
        {
          id: 'refs/tags/v1',
          name: 'v1',
          type: 'tag',
          current: false,
          commit: 'tag',
        },
      ],
    });
    expect(calls[1]).toEqual([
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)%00%(objectname)%00%(upstream:short)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
  });

  it('normalizes log refs to full ref names and passes multiple refs through stdin', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args, opts) => {
        calls.push([...args]);
        if (args[0] === 'for-each-ref') {
          const wanted = new Set(args.slice(2));
          return {
            stdout: [
              wanted.has('refs/heads/798') ? 'refs/heads/798' : '',
              wanted.has('refs/remotes/origin/main') ? 'refs/remotes/origin/main' : '',
            ]
              .filter(Boolean)
              .join('\n'),
            stderr: '',
            exitCode: 0,
          };
        }
        if (args[0] === 'log') {
          expect(opts.stdin).toBe('refs/heads/798\nrefs/remotes/origin/main');
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await backend.log('/repo', { refNames: ['798', 'origin/main'], maxCount: 5 });

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads/798',
      'refs/remotes/798',
      'refs/tags/798',
    ]);
    expect(calls[1]).toEqual([
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads/origin/main',
      'refs/remotes/origin/main',
      'refs/tags/origin/main',
    ]);
    expect(calls[2]?.slice(0, 3)).toEqual(['log', '--topo-order', '--decorate=full']);
    expect(calls[2]).toContain('--max-count=5');
    expect(calls[2]).toContain('--stdin');
    expect(calls[2]).not.toContain('798');
    expect(calls[2]).not.toContain('origin/main');
    expect(calls[2]).not.toContain('--all');
  });

  it('normalizes hex-looking single log refs before treating them as object ids', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args) => {
        calls.push([...args]);
        if (args[0] === 'for-each-ref') {
          return { stdout: 'refs/heads/deadbee\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await backend.log('/repo', { ref: 'deadbee', maxCount: 5 });

    expect(calls[0]).toEqual([
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads/deadbee',
      'refs/remotes/deadbee',
      'refs/tags/deadbee',
    ]);
    expect(calls[1]).toContain('refs/heads/deadbee');
    expect(calls[1]).not.toContain('deadbee');
  });

  it('passes max-parents through to git log for VS Code-style root commit fallback', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args) => {
        calls.push([...args]);
        if (args[0] === 'for-each-ref') {
          return { stdout: 'refs/heads/main\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await backend.log('/repo', { ref: 'main', maxCount: 1, maxParents: 0 });

    expect(calls.at(-1)).toContain('--max-count=1');
    expect(calls.at(-1)).toContain('--max-parents=0');
    expect(calls.at(-1)).toContain('refs/heads/main');
  });

  it('classifies ambiguous log revisions without adding a git-log wrapper message', async () => {
    const calls: string[][] = [];
    const backend = new GitCliBackendProvider({
      git: async (args) => {
        calls.push([...args]);
        if (args[0] === 'for-each-ref') {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        if (args[0] === 'log') {
          return {
            stdout: '',
            stderr:
              "fatal: ambiguous argument '798': unknown revision or path not in the working tree.\n",
            exitCode: 128,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await expect(backend.log('/repo', { ref: '798', maxCount: 5 })).rejects.toMatchObject({
      message: "fatal: ambiguous argument '798': unknown revision or path not in the working tree.",
      gitErrorCode: GitErrorCodes.BadRevision,
      stderr: expect.stringContaining("ambiguous argument '798'"),
    });
    expect(calls.at(-1)).toContain('798');
  });
});

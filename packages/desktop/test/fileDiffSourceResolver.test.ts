import { describe, expect, it } from 'vitest';
import {
  FILE_DIFF_TOO_LARGE_MESSAGE,
  FileDiffSourceResolverService,
  type FileDiffSourceResolverServices,
  GitFileDiffSourceProvider,
  GitFileDiffSourceResolver,
  MAX_DIFF_CHARS,
} from '../src/workbench/contrib/multiDiffEditor/browser/fileDiffSourceResolver.js';

type Call =
  | { readonly name: 'show'; readonly ref: string; readonly path: string }
  | { readonly name: 'readFile'; readonly path: string };

function createServices(
  gitContents: Readonly<Record<string, string | null>>,
  workspaceContents: Readonly<Record<string, string | Error>>,
  calls: Call[],
): FileDiffSourceResolverServices {
  return {
    git: {
      show: async (ref, path) => {
        calls.push({ name: 'show', ref, path });
        return gitContents[`${ref}:${path}`] ?? null;
      },
    },
    workspace: {
      readFile: async (path) => {
        calls.push({ name: 'readFile', path });
        const content = workspaceContents[path];
        if (content instanceof Error) throw content;
        return { path, content: content ?? '' };
      },
    },
  };
}

describe('GitFileDiffSourceProvider', () => {
  it('maps staged, unstaged, and commit refs into explicit source sides', () => {
    const provider = new GitFileDiffSourceProvider();

    expect(
      provider.provideFileDiffSource('src/a.ts', { leftRef: 'HEAD', rightWorktree: false }),
    ).toEqual({
      original: { kind: 'git', path: 'src/a.ts', ref: 'HEAD', emptyWhenMissing: true },
      modified: { kind: 'git', path: 'src/a.ts', ref: '', emptyWhenMissing: true },
    });

    expect(
      provider.provideFileDiffSource('src/a.ts', { leftRef: '', rightWorktree: true }),
    ).toEqual({
      original: { kind: 'git', path: 'src/a.ts', ref: '', emptyWhenMissing: true },
      modified: { kind: 'workspace', path: 'src/a.ts', emptyWhenMissing: true },
    });

    expect(
      provider.provideFileDiffSource('src/a.ts', {
        leftRef: 'abc123^',
        rightRef: 'abc123',
        rightWorktree: false,
      }),
    ).toEqual({
      original: { kind: 'git', path: 'src/a.ts', ref: 'abc123^', emptyWhenMissing: true },
      modified: { kind: 'git', path: 'src/a.ts', ref: 'abc123', emptyWhenMissing: true },
    });

    expect(
      provider.provideFileDiffSource('src/new.ts', {
        leftRef: 'HEAD',
        rightWorktree: true,
        originalPath: 'src/old.ts',
      }),
    ).toEqual({
      original: { kind: 'git', path: 'src/old.ts', ref: 'HEAD', emptyWhenMissing: true },
      modified: { kind: 'workspace', path: 'src/new.ts', emptyWhenMissing: true },
    });
  });
});

describe('GitFileDiffSourceResolver', () => {
  it('resolves staged/index diffs through git refs', async () => {
    const calls: Call[] = [];
    const source = new GitFileDiffSourceProvider().provideFileDiffSource('src/a.ts', {
      leftRef: 'HEAD',
      rightWorktree: false,
      context: Number.POSITIVE_INFINITY,
    });
    const resolved = await new GitFileDiffSourceResolver().resolveDiffSource(
      source,
      createServices(
        {
          'HEAD:src/a.ts': 'old',
          ':src/a.ts': 'new',
        },
        {},
        calls,
      ),
    );

    expect(calls).toEqual([
      { name: 'show', ref: 'HEAD', path: 'src/a.ts' },
      { name: 'show', ref: '', path: 'src/a.ts' },
    ]);
    expect(resolved.original).toBe('old');
    expect(resolved.modified).toBe('new');
  });

  it('treats a deleted working-tree file as an empty modified side', async () => {
    const calls: Call[] = [];
    const source = new GitFileDiffSourceProvider().provideFileDiffSource('src/deleted.ts', {
      leftRef: '',
      rightWorktree: true,
      context: Number.POSITIVE_INFINITY,
    });
    const resolved = await new GitFileDiffSourceResolver().resolveDiffSource(
      source,
      createServices(
        { ':src/deleted.ts': 'gone\n' },
        { 'src/deleted.ts': new Error('[PATH_NOT_FOUND] src/deleted.ts') },
        calls,
      ),
    );

    expect(calls).toEqual([
      { name: 'show', ref: '', path: 'src/deleted.ts' },
      { name: 'readFile', path: 'src/deleted.ts' },
    ]);
    expect(resolved.modified).toBe('');
  });

  it('resolves original and modified sides with independent paths', async () => {
    const calls: Call[] = [];
    const source = new GitFileDiffSourceProvider().provideFileDiffSource('src/new.ts', {
      leftRef: 'HEAD',
      rightWorktree: true,
      originalPath: 'src/old.ts',
    });
    const resolved = await new GitFileDiffSourceResolver().resolveDiffSource(
      source,
      createServices({ 'HEAD:src/old.ts': 'old name' }, { 'src/new.ts': 'new name' }, calls),
    );

    expect(calls).toEqual([
      { name: 'show', ref: 'HEAD', path: 'src/old.ts' },
      { name: 'readFile', path: 'src/new.ts' },
    ]);
    expect(resolved).toEqual({ original: 'old name', modified: 'new name' });
  });

  it('rejects diffs above the large-file guard before returning rows', async () => {
    const large = 'x'.repeat(MAX_DIFF_CHARS + 1);
    const source = new GitFileDiffSourceProvider().provideFileDiffSource('big.ts', {
      leftRef: 'HEAD',
      rightWorktree: true,
    });

    await expect(
      new GitFileDiffSourceResolver().resolveDiffSource(
        source,
        createServices({ 'HEAD:big.ts': large }, { 'big.ts': '' }, []),
      ),
    ).rejects.toThrow(FILE_DIFF_TOO_LARGE_MESSAGE);
  });
});

describe('FileDiffSourceResolverService', () => {
  it('delegates to the first resolver that can handle the source', async () => {
    const source = new GitFileDiffSourceProvider().provideFileDiffSource('src/a.ts', {
      leftRef: 'parent',
      rightRef: 'child',
      rightWorktree: false,
    });
    const service = new FileDiffSourceResolverService([new GitFileDiffSourceResolver()]);
    const resolved = await service.resolve(
      source,
      createServices(
        {
          'parent:src/a.ts': 'a',
          'child:src/a.ts': 'b',
        },
        {},
        [],
      ),
    );

    expect(resolved?.original).toBe('a');
    expect(resolved?.modified).toBe('b');
  });
});

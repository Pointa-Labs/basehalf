import { describe, expect, it } from 'vitest';
import {
  isSafePullRequestExternalUrl,
  pullRequestFileRows,
  pullRequestViewFiles,
  reviewSuccessMessage,
  selectPullRequestFile,
} from '../src/workbench/contrib/githubPullRequests/browser/pullRequestViewModel.js';
import type { GhPrFile } from '../src/workbench/contrib/githubPullRequests/common/githubPullRequests.js';

const files: readonly GhPrFile[] = [
  {
    filename: 'src/a.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: ['@@ -1 +1 @@', '-old', '+new'].join('\n'),
  },
  {
    filename: 'src/b.ts',
    status: 'renamed',
    additions: 0,
    deletions: 0,
  },
];

describe('pullRequestViewModel', () => {
  it('selects the active PR file by filename', () => {
    expect(selectPullRequestFile(files, 'src/a.ts')).toBe(files[0]);
    expect(selectPullRequestFile(files, 'missing.ts')).toBeNull();
    expect(selectPullRequestFile(null, 'src/a.ts')).toBeNull();
  });

  it('parses displayable GitHub patches and leaves binary/renamed files empty', () => {
    expect(pullRequestFileRows(files[0])).toMatchObject([
      { kind: 'gap', oldStart: 1, newStart: 1 },
      { kind: 'del', oldLine: 1 },
      { kind: 'add', newLine: 1 },
    ]);
    expect(pullRequestFileRows(files[1])).toEqual([]);
    expect(pullRequestFileRows(null)).toEqual([]);
  });

  it('maps review events to user-facing success messages', () => {
    expect(reviewSuccessMessage('APPROVE')).toBe('Approved.');
    expect(reviewSuccessMessage('REQUEST_CHANGES')).toBe('Changes requested.');
    expect(reviewSuccessMessage('COMMENT')).toBe('Comment submitted.');
  });

  it('loads pull request files from either service or provider-shaped sources', async () => {
    await expect(
      pullRequestViewFiles(
        {
          pullRequestFiles: async (remoteUrl, number) => [
            {
              filename: `${remoteUrl}/${number}.ts`,
              status: 'modified',
              additions: 1,
              deletions: 0,
            },
          ],
          reviewPullRequest: async () => {},
        },
        'remote',
        7,
      ),
    ).resolves.toMatchObject([{ filename: 'remote/7.ts' }]);

    await expect(
      pullRequestViewFiles(
        {
          providePullRequestFiles: async (remoteUrl, number) => [
            {
              filename: `${remoteUrl}/${number}.ts`,
              status: 'modified',
              additions: 1,
              deletions: 0,
            },
          ],
          reviewPullRequest: async () => {},
        },
        'remote',
        8,
      ),
    ).resolves.toMatchObject([{ filename: 'remote/8.ts' }]);
  });

  it('allows only the exact github.com pull request URL for external opening', () => {
    expect(isSafePullRequestExternalUrl('https://github.com/owner/repo/pull/12', 12)).toBe(true);
    expect(isSafePullRequestExternalUrl('http://github.com/owner/repo/pull/12', 12)).toBe(false);
    expect(isSafePullRequestExternalUrl('https://gitlab.com/owner/repo/pull/12', 12)).toBe(false);
    expect(isSafePullRequestExternalUrl('https://token@github.com/owner/repo/pull/12', 12)).toBe(
      false,
    );
    expect(isSafePullRequestExternalUrl('https://github.com/owner/repo/pull/13', 12)).toBe(false);
    expect(isSafePullRequestExternalUrl('https://github.com/owner/repo/pull/12?plain=1', 12)).toBe(
      false,
    );
    expect(isSafePullRequestExternalUrl('https://github.com/settings/repo/pull/12', 12)).toBe(
      false,
    );
    expect(isSafePullRequestExternalUrl('https://github.com/owner/repo/pull/12/files', 12)).toBe(
      false,
    );
  });
});

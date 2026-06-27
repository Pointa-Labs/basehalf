import { describe, expect, it } from 'vitest';
import { createPrUrl, webBaseUrl } from '../src/renderer/src/lib/prUrl.js';

describe('webBaseUrl', () => {
  it('parses https with a trailing .git', () => {
    expect(webBaseUrl('https://github.com/Pointa-Labs/basehalf.git')).toBe(
      'https://github.com/Pointa-Labs/basehalf',
    );
  });
  it('parses scp-like ssh', () => {
    expect(webBaseUrl('git@github.com:Pointa-Labs/basehalf.git')).toBe(
      'https://github.com/Pointa-Labs/basehalf',
    );
  });
  it('parses ssh:// url', () => {
    expect(webBaseUrl('ssh://git@example.com/group/sub/repo.git')).toBe(
      'https://example.com/group/sub/repo',
    );
  });
  it('null on garbage', () => {
    expect(webBaseUrl('')).toBeNull();
    expect(webBaseUrl('not a url')).toBeNull();
  });
});

describe('createPrUrl', () => {
  it('GitHub → compare page with the PR form open', () => {
    expect(createPrUrl('git@github.com:o/r.git', 'feature/x')).toBe(
      'https://github.com/o/r/compare/feature%2Fx?expand=1',
    );
  });
  it('GitLab → new merge request', () => {
    expect(createPrUrl('https://gitlab.com/o/r.git', 'feat')).toBe(
      'https://gitlab.com/o/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat',
    );
  });
  it('Bitbucket → new pull request', () => {
    expect(createPrUrl('https://bitbucket.org/o/r.git', 'feat')).toBe(
      'https://bitbucket.org/o/r/pull-requests/new?source=feat',
    );
  });
  it('null when branch empty or remote unparseable', () => {
    expect(createPrUrl('git@github.com:o/r.git', '')).toBeNull();
    expect(createPrUrl('junk', 'feat')).toBeNull();
  });
});

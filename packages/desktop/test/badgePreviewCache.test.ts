import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPreviewCache,
  getMarkdownPreviewHtml,
  getPreviewContent,
  invalidatePreviewCache,
  setMarkdownPreviewHtml,
  setPreviewContent,
} from '../src/workbench/contrib/basehalfCanvas/browser/badge-node/badgePreviewCache.js';

afterEach(() => clearPreviewCache());

describe('badgePreviewCache', () => {
  it('stores and clears raw and markdown preview entries together', () => {
    setPreviewContent('README.md', { text: '# Hello' });
    setMarkdownPreviewHtml('README.md', '<h1>Hello</h1>');

    expect(getPreviewContent('README.md')).toEqual({ text: '# Hello' });
    expect(getMarkdownPreviewHtml('README.md')).toBe('<h1>Hello</h1>');

    invalidatePreviewCache('README.md');
    expect(getPreviewContent('README.md')).toBeUndefined();
    expect(getMarkdownPreviewHtml('README.md')).toBeUndefined();
  });

  it('clears all workspace-relative cache entries on workspace switches', () => {
    setPreviewContent('README.md', { text: 'one' });
    setMarkdownPreviewHtml('docs/intro.md', '<p>two</p>');

    clearPreviewCache();
    expect(getPreviewContent('README.md')).toBeUndefined();
    expect(getMarkdownPreviewHtml('docs/intro.md')).toBeUndefined();
  });
});

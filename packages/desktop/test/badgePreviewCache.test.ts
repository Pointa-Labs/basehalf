import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchFileChangeEvent } from '../src/workbench/services/files/common/fileChangeTypes.js';

const fileChangeMock = vi.hoisted(() => ({
  listeners: new Set<(event: WorkbenchFileChangeEvent) => void>(),
}));

vi.mock('../src/workbench/services/files/browser/fileChangeService.js', () => ({
  workbenchFileChangeService: {
    onDidChangeFiles: vi.fn((listener: (event: WorkbenchFileChangeEvent) => void) => {
      fileChangeMock.listeners.add(listener);
      return () => fileChangeMock.listeners.delete(listener);
    }),
  },
}));

import {
  clearPreviewCache,
  getMarkdownPreviewHtml,
  getPreviewContent,
  invalidatePreviewCache,
  setMarkdownPreviewHtml,
  setPreviewContent,
  subscribeTile,
} from '../src/workbench/contrib/basehalfCanvas/browser/badge-node/badgePreviewCache.js';
import { workbenchFileChangeService } from '../src/workbench/services/files/browser/fileChangeService.js';

afterEach(() => clearPreviewCache());

function emitFileChange(event: WorkbenchFileChangeEvent): void {
  for (const listener of fileChangeMock.listeners) listener(event);
}

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

  it('invalidates previews and notifies tiles from workbench file change events', () => {
    setPreviewContent('README.md', { text: '# Old' });
    setMarkdownPreviewHtml('README.md', '<h1>Old</h1>');
    const received: WorkbenchFileChangeEvent[] = [];
    const unsubscribe = subscribeTile((event) => received.push(event));

    const change = { type: 'change', relPath: 'README.md', isDir: false } as const;
    emitFileChange(change);

    expect(workbenchFileChangeService.onDidChangeFiles).toHaveBeenCalledTimes(1);
    expect(received).toEqual([change]);
    expect(getPreviewContent('README.md')).toBeUndefined();
    expect(getMarkdownPreviewHtml('README.md')).toBeUndefined();

    unsubscribe();
    emitFileChange({ type: 'unlink', relPath: 'README.md', isDir: false });
    expect(received).toEqual([change]);
  });
});

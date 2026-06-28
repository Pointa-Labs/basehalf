import { describe, expect, it } from 'vitest';
import { parseSidebarView } from '../src/workbench/browser/layout/layoutStore.js';

describe('layoutStore', () => {
  it('restores every persisted sidebar view', () => {
    expect(parseSidebarView('files')).toBe('files');
    expect(parseSidebarView('scm')).toBe('scm');
    expect(parseSidebarView('search')).toBe('search');
  });

  it('falls back to files for unknown persisted sidebar views', () => {
    expect(parseSidebarView(null)).toBe('files');
    expect(parseSidebarView('timeline')).toBe('files');
  });
});

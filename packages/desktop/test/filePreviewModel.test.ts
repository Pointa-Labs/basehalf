import { describe, expect, it } from 'vitest';
import {
  filePreviewInput,
  splitPath,
} from '../src/workbench/browser/parts/editor/filePreviewModel.js';

describe('filePreviewModel', () => {
  it('splits relative paths into dirname and basename', () => {
    expect(splitPath('README.md')).toEqual({ dirname: '', basename: 'README.md' });
    expect(splitPath('notes/daily/today.md')).toEqual({
      dirname: 'notes/daily',
      basename: 'today.md',
    });
  });

  it('builds a stable editor input from workspace root and relative path', () => {
    expect(filePreviewInput('/workspace', 'notes/today.md')).toEqual({
      file: 'notes/today.md',
      mode: 'md',
      absPath: '/workspace/notes/today.md',
      basename: 'today.md',
      viewKey: '/workspace\0notes/today.md',
    });
  });

  it('routes binary/media files to dedicated editor panes', () => {
    expect(filePreviewInput('/workspace', 'assets/logo.png').mode).toBe('image');
    expect(filePreviewInput('/workspace', 'paper.pdf').mode).toBe('pdf');
    expect(filePreviewInput('/workspace', 'archive.zip').mode).toBe('other');
  });
});

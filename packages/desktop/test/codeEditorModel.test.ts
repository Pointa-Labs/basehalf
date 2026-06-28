import { describe, expect, it } from 'vitest';
import {
  blameAnnotation,
  didDiskContentChange,
  fileBaseName,
  gitFileStatusSignature,
  isCodeEditorDirty,
  shouldRefreshGitBaseline,
} from '../src/workbench/browser/parts/editor/codeEditorModel.js';

describe('codeEditorModel', () => {
  it('detects dirty buffers and disk drift from the last saved snapshot', () => {
    expect(isCodeEditorDirty('same', 'same')).toBe(false);
    expect(isCodeEditorDirty('next', 'same')).toBe(true);

    expect(didDiskContentChange('same', 'same')).toBe(false);
    expect(didDiskContentChange(undefined, '')).toBe(false);
    expect(didDiskContentChange('external', 'same')).toBe(true);
  });

  it('summarizes git status inputs that should refresh the editor baseline', () => {
    expect(gitFileStatusSignature(undefined)).toBe('');
    expect(gitFileStatusSignature({ x: 'M', y: ' ' })).toBe('M ');

    const main = { branch: 'main', fileSignature: 'M ' };
    expect(shouldRefreshGitBaseline(main, main)).toBe(false);
    expect(shouldRefreshGitBaseline(main, { branch: 'feature', fileSignature: 'M ' })).toBe(true);
    expect(shouldRefreshGitBaseline(main, { branch: 'main', fileSignature: '  ' })).toBe(true);
  });

  it('formats filenames and inline blame annotations for editor chrome', () => {
    expect(fileBaseName('src/components/CodeEditor.tsx')).toBe('CodeEditor.tsx');
    expect(fileBaseName('README.md')).toBe('README.md');

    expect(
      blameAnnotation(
        { sha: '0000000000000000000000000000000000000000' } as Parameters<
          typeof blameAnnotation
        >[0],
        1_700_000_000_000,
      ),
    ).toBe('You · Uncommitted');

    const committed = blameAnnotation(
      {
        sha: 'abcdef1234567890',
        author: 'Ada',
        authorTime: 1_699_999_940_000,
        summary: 'Tighten editor model',
      } as Parameters<typeof blameAnnotation>[0],
      1_700_000_000_000,
    );
    expect(committed).toContain('Ada');
    expect(committed).toContain('Tighten editor model');
  });
});

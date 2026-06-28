import { describe, expect, it } from 'vitest';
import {
  countLabel,
  isPreviewableBadgeType,
  renameTargetForBadgeBasename,
  shouldShowCodeDiffPreview,
  splitBadgePath,
} from '../src/workbench/contrib/basehalfCanvas/browser/badge-node/badgeNodeModel.js';

describe('badgeNodeModel', () => {
  it('splits badge labels into dirname and basename', () => {
    expect(splitBadgePath('README.md')).toEqual({ dirname: '', basename: 'README.md' });
    expect(splitBadgePath('docs/intro.md')).toEqual({ dirname: 'docs', basename: 'intro.md' });
  });

  it('keeps card inline rename basename-only', () => {
    expect(renameTargetForBadgeBasename('README.md', 'Guide.md')).toBe('Guide.md');
    expect(renameTargetForBadgeBasename('README.md', ' Guide.md ')).toBe('Guide.md');
    expect(renameTargetForBadgeBasename('docs/intro.md', 'chapter.md')).toBe('docs/chapter.md');
    expect(renameTargetForBadgeBasename('docs/intro.md', 'nested/chapter.md')).toBe(null);
    expect(renameTargetForBadgeBasename('docs/intro.md', '   ')).toBe(null);
    expect(renameTargetForBadgeBasename('docs/intro.md', '.')).toBe(null);
    expect(renameTargetForBadgeBasename('docs/intro.md', '..')).toBe(null);
  });

  it('classifies preview and diff-capable card types', () => {
    expect(isPreviewableBadgeType('image')).toBe(true);
    expect(isPreviewableBadgeType('text')).toBe(true);
    expect(isPreviewableBadgeType('code')).toBe(true);
    expect(isPreviewableBadgeType('pdf')).toBe(false);

    expect(shouldShowCodeDiffPreview({ previewable: true, type: 'code', x: 'M', y: ' ' })).toBe(
      true,
    );
    expect(shouldShowCodeDiffPreview({ previewable: true, type: 'code', x: 'U', y: ' ' })).toBe(
      false,
    );
    expect(shouldShowCodeDiffPreview({ previewable: true, type: 'text', x: 'M', y: ' ' })).toBe(
      false,
    );
    expect(shouldShowCodeDiffPreview({ previewable: false, type: 'code', x: 'M', y: ' ' })).toBe(
      false,
    );
  });

  it('formats folder count labels', () => {
    expect(countLabel(0)).toBe('empty');
    expect(countLabel(1)).toBe('1 item');
    expect(countLabel(12)).toBe('12 items');
  });
});

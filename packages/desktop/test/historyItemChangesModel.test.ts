import { describe, expect, it } from 'vitest';
import {
  commitDiffTitle,
  historyItemChangeDisplayPath,
  historyItemChangeKey,
} from '../src/workbench/contrib/scm/browser/historyItemChangesModel.js';

describe('historyItemChangesModel', () => {
  it('formats history item changes consistently across details views', () => {
    expect(historyItemChangeDisplayPath({ path: 'src/new.ts', status: 'R' })).toBe('src/new.ts');
    expect(
      historyItemChangeDisplayPath({
        path: 'src/new.ts',
        originalPath: 'src/old.ts',
        status: 'R',
      }),
    ).toBe('src/old.ts -> src/new.ts');
    expect(
      historyItemChangeKey({ path: 'src/new.ts', originalPath: 'src/old.ts', status: 'R' }),
    ).toBe('R:src/old.ts -> src/new.ts');
    expect(commitDiffTitle('abcdef1')).toBe('abcdef1 -> parent');
  });
});

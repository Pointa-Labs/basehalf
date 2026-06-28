import { describe, expect, it } from 'vitest';
import { historyErrorMessage } from '../src/workbench/contrib/scm/browser/useGitGraphHistory.js';

describe('useGitGraphHistory model helpers', () => {
  it('preserves failed git history load messages for the graph UI', () => {
    expect(historyErrorMessage(new Error('git log failed'))).toBe('git log failed');
    expect(historyErrorMessage('fatal: ambiguous argument')).toBe('fatal: ambiguous argument');
  });
});

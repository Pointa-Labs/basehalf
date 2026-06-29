import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BranchQuickPick } from '../src/workbench/contrib/scm/browser/BranchQuickPick.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

const status: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  files: [],
};

describe('BranchQuickPick', () => {
  it('renders the SCM header branch as the shared checkout quick-pick command', () => {
    const html = renderToStaticMarkup(
      createElement(BranchQuickPick, {
        status,
        onAfter: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="scm-branch"');
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Checkout Branch/Tag"');
    expect(html).toContain('main, Checkout Branch/Tag...');
    expect(html).toContain('chevron-down');
  });

  it('keeps the status bar branch as the checkout quick-pick command', () => {
    const html = renderToStaticMarkup(
      createElement(BranchQuickPick, {
        status,
        onAfter: vi.fn(),
        variant: 'statusBar',
      }),
    );

    expect(html).toContain('<button');
    expect(html).toContain('data-testid="statusbar-branch"');
    expect(html).toContain('aria-label="Checkout Branch/Tag"');
    expect(html).toContain('main, Checkout Branch/Tag...');
  });
});

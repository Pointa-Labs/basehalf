import { describe, expect, it } from 'vitest';
import { registerBuiltinScmViewContributions } from '../src/workbench/contrib/scm/browser/scmBuiltinViewContributions.js';
import {
  type ScmViewContribution,
  ScmViewContributionRegistry,
  scmContributionMenuActions,
  scmVisibleViewContributions,
} from '../src/workbench/contrib/scm/browser/scmViewContributions.js';
import type { ScmViewPaneModel } from '../src/workbench/contrib/scm/browser/useScmViewPaneModel.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true,
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [],
    ...overrides,
  };
}

function model(overrides: Partial<ScmViewPaneModel> = {}): ScmViewPaneModel {
  return {
    status: status(),
    ...overrides,
  } as ScmViewPaneModel;
}

function contribution(id: string, label = id): ScmViewContribution {
  return {
    id,
    menuActions: () => [{ label, onClick: () => {} }],
    renderSection: () => ({ contribution: id }) as never,
  };
}

describe('scmViewContributions', () => {
  it('registers built-in SCM contributions through the registry once', () => {
    const registry = new ScmViewContributionRegistry();

    registerBuiltinScmViewContributions(registry);
    registerBuiltinScmViewContributions(registry);

    expect(registry.getScmViewContributions().map((entry) => entry.id)).toEqual([
      'github.pullRequests',
    ]);
  });

  it('keeps menu and render contributions in registration order', () => {
    const registry = new ScmViewContributionRegistry();
    registry.registerScmViewContribution(contribution('first', 'First'));
    registry.registerScmViewContribution(contribution('second', 'Second'));

    const registered = registry.getScmViewContributions();
    const visible = scmVisibleViewContributions(registered, model());

    expect(scmContributionMenuActions(registered, model()).map((action) => action.label)).toEqual([
      'First',
      'Second',
    ]);
    expect(visible.map((entry) => entry.renderSection?.(model()))).toEqual([
      { contribution: 'first' },
      { contribution: 'second' },
    ]);
  });

  it('filters contributions by SCM view context before menus or sections render', () => {
    const registry = new ScmViewContributionRegistry();
    registry.registerScmViewContribution(contribution('always', 'Always'));
    registry.registerScmViewContribution({
      ...contribution('branch-only', 'Branch Only'),
      when: ({ model }) => model.status?.branch === 'feature',
    });

    const mainModel = model({ status: status({ branch: 'main' }) });
    const featureModel = model({ status: status({ branch: 'feature' }) });

    expect(registry.getScmViewContributions({ model: mainModel }).map((entry) => entry.id)).toEqual(
      ['always'],
    );
    expect(
      scmContributionMenuActions(registry.getScmViewContributions(), mainModel).map(
        (action) => action.label,
      ),
    ).toEqual(['Always']);
    expect(
      registry.getScmViewContributions({ model: featureModel }).map((entry) => entry.id),
    ).toEqual(['always', 'branch-only']);
  });
});

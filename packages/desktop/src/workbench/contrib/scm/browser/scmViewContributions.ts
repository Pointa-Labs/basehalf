import type { JSX } from 'react';
import type { MenuAction } from '../../../browser/ui/primitives/Menu.js';
import type { ScmViewPaneModel } from './useScmViewPaneModel.js';

export interface ScmViewContribution {
  readonly id: string;
  readonly menuActions?: (model: ScmViewPaneModel) => readonly MenuAction[];
  readonly renderSection?: (model: ScmViewPaneModel) => JSX.Element | null;
}

export function scmContributionMenuActions(
  contributions: readonly ScmViewContribution[],
  model: ScmViewPaneModel,
): MenuAction[] {
  return contributions.flatMap((contribution) => [...(contribution.menuActions?.(model) ?? [])]);
}

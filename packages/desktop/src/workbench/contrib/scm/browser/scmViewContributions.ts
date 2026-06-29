import type { JSX } from 'react';
import type { MenuAction } from '../../../browser/ui/primitives/Menu.js';
import type { ScmViewPaneModel } from './useScmViewPaneModel.js';

export interface ScmViewContributionContext {
  readonly model: ScmViewPaneModel;
}

export interface ScmViewContribution {
  readonly id: string;
  readonly when?: (context: ScmViewContributionContext) => boolean;
  readonly menuActions?: (model: ScmViewPaneModel) => readonly MenuAction[];
  readonly renderSection?: (model: ScmViewPaneModel) => JSX.Element | null;
}

export interface ScmViewContributionRegistryLike {
  registerScmViewContribution: (contribution: ScmViewContribution) => () => void;
  getScmViewContributions: (context?: ScmViewContributionContext) => readonly ScmViewContribution[];
}

export class ScmViewContributionRegistry implements ScmViewContributionRegistryLike {
  private readonly contributions: ScmViewContribution[] = [];

  registerScmViewContribution(contribution: ScmViewContribution): () => void {
    if (this.contributions.some((registered) => registered.id === contribution.id)) {
      throw new Error(`SCM view contribution '${contribution.id}' is already registered.`);
    }

    this.contributions.push(contribution);
    return () => {
      const index = this.contributions.indexOf(contribution);
      if (index !== -1) this.contributions.splice(index, 1);
    };
  }

  getScmViewContributions(context?: ScmViewContributionContext): readonly ScmViewContribution[] {
    const contributions = [...this.contributions];
    return context === undefined
      ? contributions
      : scmVisibleViewContributions(contributions, context.model);
  }
}

export const scmViewContributionRegistry = new ScmViewContributionRegistry();

export function registerScmViewContribution(
  contribution: ScmViewContribution,
  registry: ScmViewContributionRegistryLike = scmViewContributionRegistry,
): () => void {
  return registry.registerScmViewContribution(contribution);
}

export function scmVisibleViewContributions(
  contributions: readonly ScmViewContribution[],
  model: ScmViewPaneModel,
): ScmViewContribution[] {
  const context: ScmViewContributionContext = { model };
  return contributions.filter((contribution) => contribution.when?.(context) ?? true);
}

export function scmContributionMenuActions(
  contributions: readonly ScmViewContribution[],
  model: ScmViewPaneModel,
): MenuAction[] {
  return scmVisibleViewContributions(contributions, model).flatMap((contribution) => [
    ...(contribution.menuActions?.(model) ?? []),
  ]);
}

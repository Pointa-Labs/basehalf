import { registerGithubPullRequestsScmContribution } from '../../githubPullRequests/browser/githubScmContribution.js';
import {
  type ScmViewContributionRegistryLike,
  scmViewContributionRegistry,
} from './scmViewContributions.js';

const registeredRegistries = new WeakSet<ScmViewContributionRegistryLike>();

/**
 * Registers built-in SCM view contributions from their owning feature modules.
 *
 * This mirrors VS Code's contribution bootstrap shape: the SCM view consumes a
 * registry, while GitHub owns registering its SCM menu/section contribution.
 */
export function registerBuiltinScmViewContributions(
  registry: ScmViewContributionRegistryLike = scmViewContributionRegistry,
): void {
  if (registeredRegistries.has(registry)) return;
  registeredRegistries.add(registry);

  registerGithubPullRequestsScmContribution(registry);
}

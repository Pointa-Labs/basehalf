import type { ScmViewContribution } from '../../scm/browser/scmViewContributions.js';
import { PullRequestsSection } from './PullRequestsSection.js';

export const githubPullRequestsScmContribution: ScmViewContribution = {
  id: 'github.pullRequests',
  menuActions: ({ commands }) => [
    { label: 'Create Pull Request…', onClick: commands.createPullRequest },
  ],
  renderSection: () => <PullRequestsSection />,
};

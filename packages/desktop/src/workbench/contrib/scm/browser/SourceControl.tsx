import type { JSX } from 'react';
import { githubPullRequestsScmContribution } from '../../githubPullRequests/browser/githubScmContribution.js';
import { ScmViewPane } from './ScmViewPane.js';
import { useScmViewPaneModel } from './useScmViewPaneModel.js';

const scmContributions = [githubPullRequestsScmContribution] as const;

export const SourceControl = (): JSX.Element => {
  const model = useScmViewPaneModel();
  return <ScmViewPane contributions={scmContributions} model={model} />;
};

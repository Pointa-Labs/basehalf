import type { JSX } from 'react';
import { ScmViewPane } from './ScmViewPane.js';
import { registerBuiltinScmViewContributions } from './scmBuiltinViewContributions.js';
import { useScmViewPaneModel } from './useScmViewPaneModel.js';

registerBuiltinScmViewContributions();

export const SourceControl = (): JSX.Element => {
  const model = useScmViewPaneModel();
  return <ScmViewPane model={model} />;
};

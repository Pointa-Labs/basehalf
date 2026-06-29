import type { JSX } from 'react';
import { ScmViewPane } from './ScmViewPane.js';
import { useScmViewPaneModel } from './useScmViewPaneModel.js';

export const SourceControl = (): JSX.Element => {
  const model = useScmViewPaneModel();
  return <ScmViewPane model={model} />;
};

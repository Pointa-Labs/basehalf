import type { JSX } from 'react';
import { useWorkspaceStore } from '../services/workspace/browser/workspaceStore.js';
import { WorkbenchLayout } from './WorkbenchLayout.js';
import { useWorkbenchContributions } from './workbenchContributions.js';
import { useWorkbenchDropTarget } from './workbenchDnd.js';
import { selectRegion } from './workbenchRegion.js';

/**
 * Renderer workbench root, analogous to VS Code's browser/electron workbench
 * root: it wires workbench contributions and delegates visual composition to
 * WorkbenchLayout. The renderer entrypoint only boots this component.
 */
export function Workbench(): JSX.Element {
  const error = useWorkspaceStore((state) => state.error);
  const clearError = useWorkspaceStore((state) => state.clearError);
  const notice = useWorkspaceStore((state) => state.notice);
  const clearNotice = useWorkspaceStore((state) => state.clearNotice);
  const current = useWorkspaceStore((state) => state.current);
  const currentReachable = useWorkspaceStore((state) => state.currentReachable);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const dropTarget = useWorkbenchDropTarget();

  useWorkbenchContributions({
    current,
    notice,
    clearNotice,
    refreshWorkspace: refresh,
  });

  return (
    <WorkbenchLayout
      current={current}
      region={selectRegion(current, currentReachable)}
      error={error}
      notice={notice}
      clearError={clearError}
      clearNotice={clearNotice}
      dropTarget={dropTarget}
    />
  );
}

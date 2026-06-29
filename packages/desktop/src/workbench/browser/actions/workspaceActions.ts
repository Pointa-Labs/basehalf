import { WORKBENCH_OPEN_FOLDER_COMMAND_ID } from '../../common/quickaccess/commandPaletteProviders.js';
import { useWorkspaceStore } from '../../services/workspace/browser/workspaceStore.js';
import { type WorkbenchActionDescriptor, registerWorkbenchAction } from './workbenchActions.js';

export { WORKBENCH_OPEN_FOLDER_COMMAND_ID } from '../../common/quickaccess/commandPaletteProviders.js';

export function runOpenFolderAction(): Promise<void> {
  return useWorkspaceStore.getState().pickAndAdd();
}

export const workspaceWorkbenchActions: readonly WorkbenchActionDescriptor[] = [
  {
    id: WORKBENCH_OPEN_FOLDER_COMMAND_ID,
    label: 'Open Folder...',
    category: 'File',
    shortcut: 'CmdOrCtrl+O',
    run: runOpenFolderAction,
  },
];

let registered = false;

export function registerWorkspaceActions(): void {
  if (registered) return;
  registered = true;
  for (const action of workspaceWorkbenchActions) registerWorkbenchAction(action);
}

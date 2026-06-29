import { quickInputService } from '../../../platform/quickinput/browser/quickInputService.js';
import {
  COMMANDS_QUICK_ACCESS_PREFIX,
  WORKBENCH_QUICK_OPEN_COMMAND_ID,
  WORKBENCH_SHOW_COMMANDS_COMMAND_ID,
} from '../../common/quickaccess/commandPaletteProviders.js';
import { type WorkbenchActionDescriptor, registerWorkbenchAction } from './workbenchActions.js';

export function runQuickOpenAction(prefix?: string): void {
  quickInputService.quickAccess.show(typeof prefix === 'string' ? prefix : '');
}

export function runShowCommandsAction(): void {
  quickInputService.quickAccess.show(COMMANDS_QUICK_ACCESS_PREFIX);
}

export const quickAccessWorkbenchActions: readonly WorkbenchActionDescriptor[] = [
  {
    id: WORKBENCH_QUICK_OPEN_COMMAND_ID,
    label: 'Go to File...',
    category: 'Quick Access',
    shortcut: 'CmdOrCtrl+K',
    run: (prefix?: unknown) => runQuickOpenAction(typeof prefix === 'string' ? prefix : undefined),
  },
  {
    id: WORKBENCH_SHOW_COMMANDS_COMMAND_ID,
    label: 'Show All Commands',
    category: 'Quick Access',
    run: runShowCommandsAction,
  },
];

let registered = false;

export function registerQuickAccessActions(): void {
  if (registered) return;
  registered = true;
  for (const action of quickAccessWorkbenchActions) registerWorkbenchAction(action);
}

import {
  type QuickAccessRegistryLike,
  quickAccessRegistry,
} from '../../../platform/quickinput/common/quickAccess.js';
import {
  COMMANDS_QUICK_ACCESS_ID,
  COMMANDS_QUICK_ACCESS_PREFIX,
  DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID,
} from './commandPaletteProviders.js';

const registeredRegistries = new WeakSet<QuickAccessRegistryLike>();

/**
 * Registers the workbench quick access providers.
 *
 * VS Code keeps provider registration in contribution/bootstrap code and keeps
 * provider modules free of import-time side effects. This function is the same
 * boundary for our current React-backed quick access widget.
 */
export function registerCommandPaletteQuickAccessProviders(
  registry: QuickAccessRegistryLike = quickAccessRegistry,
): void {
  if (registeredRegistries.has(registry)) return;
  registeredRegistries.add(registry);

  registry.registerQuickAccessProvider({
    id: DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID,
    prefix: '',
    placeholder: 'Switch workspace, open a file, run an action...',
    helpEntries: [
      {
        description: 'Switch workspace, open a file, or run an action',
        commandId: 'workbench.action.quickOpen',
      },
    ],
  });

  registry.registerQuickAccessProvider({
    id: COMMANDS_QUICK_ACCESS_ID,
    prefix: COMMANDS_QUICK_ACCESS_PREFIX,
    placeholder: 'Type the name of a command to run',
    helpEntries: [
      {
        prefix: COMMANDS_QUICK_ACCESS_PREFIX,
        description: 'Show and run commands',
        commandId: 'workbench.action.showCommands',
      },
    ],
  });
}

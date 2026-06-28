import {
  type QuickAccessRegistryLike,
  quickAccessRegistry,
} from '../../../platform/quickinput/common/quickAccess.js';
import { COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS } from './commandPaletteProviders.js';

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

  for (const provider of COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS) {
    registry.registerQuickAccessProvider(provider.descriptor);
  }
}

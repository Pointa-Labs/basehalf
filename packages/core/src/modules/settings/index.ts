import type { Core } from '../../index.js';
import { commands } from './commands.js';

/**
 * The settings module owns the machine-local `settings.json` — a declarative,
 * registry-driven preference layer with a two-tier (global default +
 * per-workspace override) value model. It's the one extensible door for app
 * settings: a new setting is a registry entry (see `registry.ts`), not a new
 * end-to-end plumbing run. App-shell-only prefs (auto-update) stay in the
 * desktop host; this module is for settings that can vary per workspace.
 */
export function registerSettingsModule(core: Core): void {
  for (const [name, handler] of commands()) {
    core.register(name, handler);
  }
}

import { create } from 'zustand';
import { settingsService } from '../../../../platform/configuration/browser/settingsService.js';

/**
 * Renderer mirror of the `editor.readingMode` setting (the ADHD reading aids
 * toggle), resolved through the settings channel. The effective value already
 * folds in THIS window's workspace override on top of the global default, so the
 * renderer never has to know about the two layers; it just reads the answer.
 *
 * Kept as a tiny store (not a per-component fetch) so the editor and the Settings
 * panel share one source of truth: a toggle in Settings calls `refresh()` and
 * every open editor re-renders. `refresh()` runs on app load and whenever the
 * bound workspace changes.
 */

export const READING_MODE_KEY = 'editor.readingMode';

interface ReadingModeState {
  /** Effective value for the current window's workspace. Defaults OFF until the
   *  first `refresh()` resolves (matches the setting's default, so nothing
   *  flashes on). */
  enabled: boolean;
  /** Re-read the effective value from the settings service. Safe to call repeatedly. */
  refresh: () => Promise<void>;
  /** Optimistic local set — Settings calls this on toggle so the editor updates
   *  before the async write round-trips; `refresh()` then reconciles to truth. */
  setOptimistic: (enabled: boolean) => void;
}

export const useReadingMode = create<ReadingModeState>((set) => ({
  enabled: false,
  refresh: async () => {
    try {
      const value = await settingsService.get(READING_MODE_KEY);
      set({ enabled: value === true });
    } catch {
      set({ enabled: false });
    }
  },
  setOptimistic: (enabled) => set({ enabled }),
}));

import { create } from 'zustand';

/**
 * Renderer mirror of the `editor.readingMode` setting (the ADHD reading aids
 * toggle), resolved through the core settings module. The effective value comes
 * from `settings.get`, which — over the desktop's `bh:run` bridge — already
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
  /** Re-read the effective value from core. Safe to call repeatedly. */
  refresh: () => Promise<void>;
  /** Optimistic local set — Settings calls this on toggle so the editor updates
   *  before the async write round-trips; `refresh()` then reconciles to truth. */
  setOptimistic: (enabled: boolean) => void;
}

export const useReadingMode = create<ReadingModeState>((set) => ({
  enabled: false,
  refresh: async () => {
    try {
      const value = await window.bh.run('settings.get', { key: READING_MODE_KEY });
      set({ enabled: value === true });
    } catch {
      set({ enabled: false });
    }
  },
  setOptimistic: (enabled) => set({ enabled }),
}));

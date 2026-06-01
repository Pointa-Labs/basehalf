// Multi-editor flush registry. With split panes, several MD editors are mounted
// at once (one per pane). Each registers its flush keyed by pane id; the store
// flushes the relevant pane before a tab switch / close, and ALL of them before
// a workspace switch — so auto-saved edits always land before the context
// changes. A flush resolves `false` when an unresolved disk conflict blocks it.
//
// Lives outside the zustand state on purpose: nothing renders off it, and it
// must survive store updates without being a reactive dependency.

const registry = new Map<string, () => Promise<boolean>>();

export const registerFlusher = (paneId: string, fn: () => Promise<boolean>): void => {
  registry.set(paneId, fn);
};

export const unregisterFlusher = (paneId: string, fn?: () => Promise<boolean>): void => {
  // Only delete if the registered fn is still this one — guards against a
  // remount registering the new editor before the old one's cleanup runs.
  if (fn === undefined || registry.get(paneId) === fn) registry.delete(paneId);
};

/** Flush a single pane's editor (before switching its active tab / closing it).
 *  Resolves true when there's no editor registered for that pane. */
export const flushPane = async (paneId: string): Promise<boolean> => {
  const fn = registry.get(paneId);
  if (!fn) return true;
  try {
    return await fn();
  } catch {
    return true; // torn-down editor rejects — non-blocking (matches old behavior)
  }
};

/** Flush EVERY mounted editor (before a workspace switch). Flushes them all even
 *  if one blocks, but returns false if ANY is blocked by an unresolved conflict —
 *  so the switch is held until the user resolves it. */
export const flushAll = async (): Promise<boolean> => {
  let ok = true;
  for (const fn of registry.values()) {
    try {
      if (!(await fn())) ok = false;
    } catch {
      // A torn-down editor rejects — non-blocking.
    }
  }
  return ok;
};

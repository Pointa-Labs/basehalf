// Editor flush registry. A handful of MD editors can be mounted at once — the
// full-canvas editor overlay plus any in-card badge-prompt flushers — each
// registering its flush keyed by a (synthetic) pane id. The store flushes the
// open overlay editor before a file switch / close (`flushPane`), and EVERY
// registered flusher before a workspace switch / quit (`flushAll`) — so
// auto-saved edits always land before the context changes. A flush resolves
// `false` when an unresolved disk conflict / failed write blocks it.
//
// Lives outside the zustand state on purpose: nothing renders off it, and it
// must survive store updates without being a reactive dependency.

export interface FlushOptions {
  /** Serialize even if the editor has not yet observed its own onChange flag.
   *  Used when dismissing an active canvas card editor: the DOM transaction may
   *  have landed in BlockNote before our debounced pending flag flips. */
  forceSerialize?: boolean;
  /** Overwrite a disk drift after the user explicitly chose "keep my edits". */
  forceWrite?: boolean;
}

type FlushFn = (options?: FlushOptions) => Promise<boolean>;

const registry = new Map<string, FlushFn>();
const docRegistry = new Map<string, Set<FlushFn>>();

export const registerFlusher = (paneId: string, fn: FlushFn): void => {
  registry.set(paneId, fn);
};

export const unregisterFlusher = (paneId: string, fn?: FlushFn): void => {
  // Only delete if the registered fn is still this one — guards against a
  // remount registering the new editor before the old one's cleanup runs.
  if (fn === undefined || registry.get(paneId) === fn) registry.delete(paneId);
};

export const registerDocFlusher = (docKey: string, fn: FlushFn): void => {
  const existing = docRegistry.get(docKey);
  if (existing) {
    existing.add(fn);
  } else {
    docRegistry.set(docKey, new Set([fn]));
  }
};

export const unregisterDocFlusher = (docKey: string, fn: FlushFn): void => {
  const existing = docRegistry.get(docKey);
  if (!existing) return;
  existing.delete(fn);
  if (existing.size === 0) docRegistry.delete(docKey);
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

/** Flush every mounted editor bound to a shared document. Only the document
 *  owner actually writes; sibling views return true, so callers can ask "persist
 *  this file now" without knowing which pane currently owns the save loop. */
export const flushDoc = async (docKey: string, options?: FlushOptions): Promise<boolean> => {
  const fns = docRegistry.get(docKey);
  if (!fns || fns.size === 0) return true;
  let ok = true;
  for (const fn of fns) {
    try {
      if (!(await fn(options))) ok = false;
    } catch {
      // A torn-down editor rejects — non-blocking, same as pane flush.
    }
  }
  return ok;
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

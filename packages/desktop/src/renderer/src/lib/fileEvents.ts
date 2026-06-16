// Renderer-side signal for an IN-APP entry removal, for OPTIMISTIC UI updates.
//
// Deleting a file/folder is observer-architecture round-trip: core trashes it →
// the filesystem watcher notices the unlink → the canvas/tree re-read the disk.
// That round-trip (chokidar latency + the canvas's 1100ms unlink-settle debounce)
// is a visible 200ms–1s lag before the thing the user just deleted disappears.
//
// So when the delete SUCCEEDS, `deleteEntry` emits here and the surfaces drop the
// node/row immediately — the watcher's later event just confirms an already-gone
// entry (a no-op). The watcher stays the source of truth; this only takes the
// round-trip out of the FEEDBACK path. Mirrors badgeBus's tiny pub/sub shape.

export type RemovedKind = 'file' | 'folder';
type RemovedListener = (path: string, kind: RemovedKind) => void;

const removedListeners = new Set<RemovedListener>();

export function emitEntryRemoved(path: string, kind: RemovedKind): void {
  for (const l of removedListeners) l(path, kind);
}

export function subscribeEntryRemoved(listener: RemovedListener): () => void {
  removedListeners.add(listener);
  return () => {
    removedListeners.delete(listener);
  };
}

// Same idea for RENAME: a rename is core renameEntry → watcher rename event →
// reload, the same 200ms+ round-trip. On success `renameEntry` emits here with the
// actual landing path, and the surfaces remap the node/row in place immediately;
// the watcher's rename event then just confirms it.
type RenamedListener = (from: string, to: string, kind: RemovedKind) => void;

const renamedListeners = new Set<RenamedListener>();

export function emitEntryRenamed(from: string, to: string, kind: RemovedKind): void {
  for (const l of renamedListeners) l(from, to, kind);
}

export function subscribeEntryRenamed(listener: RenamedListener): () => void {
  renamedListeners.add(listener);
  return () => {
    renamedListeners.delete(listener);
  };
}

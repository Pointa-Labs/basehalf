// Renderer-side signal for in-app badge METADATA changes (prompt / references)
// made through the editor's badge panel.
//
// Why this exists: those edits write `.bh/badges/*.json`, and the file watcher
// deliberately IGNORES `.bh/` writes (it would otherwise loop on bh's own
// writes — see the watcher module). So there's no FileEvent for the canvas to
// react to, and a panel edit would leave the canvas badge showing a stale prompt
// or missing a just-added edge until a reload. The canvas drag-to-connect path
// refreshes itself; the panel path had no such signal. The panel now emits here
// after each successful mutation, and the Canvas subscribes to re-derive its
// nodes + edges. (Mirrors the file-event tile hub in BadgeNode.)
type Listener = () => void;
const listeners = new Set<Listener>();

export function emitBadgeChange(): void {
  for (const l of listeners) l();
}

export function subscribeBadgeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

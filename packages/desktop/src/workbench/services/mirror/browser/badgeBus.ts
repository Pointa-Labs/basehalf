// Renderer-side signal for in-app badge METADATA changes (prompt / references).
//
// Why this exists: those edits write `.bh/badges/*.json`, and the file watcher
// deliberately IGNORES `.bh/` writes (it would otherwise loop on bh's own
// writes — see the watcher module). So there's no FileEvent for the other views
// to react to, and an edit on one surface would leave the other showing a stale
// prompt or missing a just-added edge until a reload.
//
// Surfaces don't emit on this bus by hand — all badge writes go through
// `lib/badgeMutations`, which emits here automatically (so no call site can
// forget to, which is exactly how the canvas→panel direction used to silently
// break).
//
// `origin` identifies the EMITTING instance, so a surface ignores only its OWN
// write (it already refreshed inline) and reacts to every other — including a
// second badge panel open in a split. The canvas is a singleton so it uses a
// constant ('canvas'); each badge panel mints a unique id (useId). An opaque
// string, compared by equality — never switched on.
export type BadgeChangeOrigin = string;
type Listener = (origin?: BadgeChangeOrigin) => void;
const listeners = new Set<Listener>();

export function emitBadgeChange(origin?: BadgeChangeOrigin): void {
  for (const l of listeners) l(origin);
}

export function subscribeBadgeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

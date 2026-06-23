/**
 * A one-way latch the workspace-switch flow sets right before it reloads the
 * window, so DEBOUNCED "mirror writers" (focus.set / canvas.setCard /
 * workspace.setViewport) that haven't fired yet SKIP instead of writing an
 * OLD-workspace-relative path into the NEWLY-bound workspace.
 *
 * Why it's needed: a workspace switch is main rebinding this window's root +
 * `webContents.reload()`. The reload doesn't commit synchronously — the old
 * page's event loop keeps running for a few ms until the navigation lands — so a
 * pending debounce timer can still fire in that gap, and `bh:run` would resolve
 * it against the window's NEW bound root (planting e.g. an old file path into the
 * new workspace's `.bh/`). `flushAll()` drains the editors; this latch covers the
 * non-editor debounced viewport/position/focus writers. The damage was minor +
 * self-healing (pruneDangling on the new load), but the binding model is meant to
 * make a switch race-free, so we close it here rather than rely on the heal.
 *
 * Set once at switch time, never reset: the reload loads a fresh module instance,
 * which starts back at `false`.
 */
let suspended = false;

/** Called by the switch flow immediately before `window.bh.openWorkspace(...)`. */
export function suspendMirrorWrites(): void {
  suspended = true;
}

/** Debounced mirror writers check this at FIRE time and skip when true. */
export function mirrorWritesSuspended(): boolean {
  return suspended;
}

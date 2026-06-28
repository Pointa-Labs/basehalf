/**
 * A one-way latch the REOPEN-HERE flow sets right before it reloads the window,
 * so DEBOUNCED "mirror writers" (focus.set / canvas.setCard /
 * workspace.setViewport) that haven't fired yet SKIP instead of writing an
 * OLD-workspace-relative path into the NEWLY-bound workspace.
 *
 * Why it's needed: removing the open workspace (→ welcome) or a repath rebinds
 * THIS window's root + `webContents.reload()`. The reload doesn't commit
 * synchronously — the old page's event loop keeps running for a few ms until the
 * navigation lands — so a pending debounce timer can still fire in that gap, and
 * the explicit IPC channels would resolve it against the window's NEW bound root
 * (planting e.g. an old file path into the new workspace's `.bh/`). `flushAll()`
 * drains the editors; this latch covers the non-editor debounced viewport/
 * position/focus writers. The damage was minor + self-healing (pruneDangling on
 * the new load), but the binding model is meant to make this race-free, so we
 * close it here rather than heal.
 *
 * (Open-or-focus another workspace does NOT reload this window — it focuses/opens
 * a different one — so it does NOT set this latch.)
 *
 * Set once before the reload, never reset: the reload loads a fresh module
 * instance, which starts back at `false`.
 */
let suspended = false;

/** Called by `reopenHere(...)` immediately before the host rebinds/reloads. */
export function suspendMirrorWrites(): void {
  suspended = true;
}

/** Debounced mirror writers check this at FIRE time and skip when true. */
export function mirrorWritesSuspended(): boolean {
  return suspended;
}

/**
 * Renderer mirror of the self-update state machine. Main owns the real machine
 * (main/updater.ts — background checks run before any window exists); this store
 * mirrors its `update:state` pushes so the chrome update indicator reflects
 * activity even if it started before any UI subscribed.
 *
 * Per the VS Code separation (values / actions / transient-state): this is the
 * TRANSIENT STATE leg. It is surfaced in app chrome (the title-bar UpdateChip),
 * NOT in the Settings surface — Settings holds only the update POLICY (the
 * "check automatically" toggle). The check/download/restart ACTIONS are verbs
 * (the chip + the app menu's "Check for Updates…"), not settings.
 */

import { create } from 'zustand';

export type UpdateUiState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate'; version: string }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; received: number; total: number }
  | { phase: 'staged'; version: string }
  | { phase: 'error'; message: string };

/** Narrow main's `unknown` push into the UI union; anything unrecognized
 *  degrades to idle rather than crashing the indicator. */
function asUpdateUiState(raw: unknown): UpdateUiState {
  if (typeof raw !== 'object' || raw === null) return { phase: 'idle' };
  const r = raw as Record<string, unknown>;
  switch (r.phase) {
    case 'checking':
      return { phase: 'checking' };
    case 'upToDate':
      return typeof r.version === 'string'
        ? { phase: 'upToDate', version: r.version }
        : { phase: 'idle' };
    case 'available':
      return typeof r.version === 'string'
        ? { phase: 'available', version: r.version }
        : { phase: 'idle' };
    case 'downloading':
      return typeof r.version === 'string' &&
        typeof r.received === 'number' &&
        typeof r.total === 'number'
        ? { phase: 'downloading', version: r.version, received: r.received, total: r.total }
        : { phase: 'idle' };
    case 'staged':
      return typeof r.version === 'string'
        ? { phase: 'staged', version: r.version }
        : { phase: 'idle' };
    case 'error':
      return typeof r.message === 'string'
        ? { phase: 'error', message: r.message }
        : { phase: 'idle' };
    default:
      return { phase: 'idle' };
  }
}

export const useUpdateStore = create<{ state: UpdateUiState }>(() => ({
  state: { phase: 'idle' },
}));

let updateBridgeWired = false;

/** Idempotent: seed the mirror once and subscribe to pushes. App calls this at
 *  startup so a check that resolved before the UI mounted is never missed. */
export function wireUpdateBridge(): void {
  if (updateBridgeWired) return;
  updateBridgeWired = true;
  void window.bh
    .updateGetState()
    .then((s) => useUpdateStore.setState({ state: asUpdateUiState(s) }));
  window.bh.onUpdateState((s) => useUpdateStore.setState({ state: asUpdateUiState(s) }));
}

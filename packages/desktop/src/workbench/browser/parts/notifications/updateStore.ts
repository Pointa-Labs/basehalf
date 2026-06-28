/**
 * Renderer mirror of the self-update state machine. Main owns the real machine
 * (platform/update/electron-main/updater.ts; background checks run before any
 * window exists). This store mirrors its `update:state` pushes so workbench
 * chrome reflects activity even if it started before any UI subscribed.
 *
 * Per the VS Code separation (values / actions / transient-state): this is the
 * TRANSIENT STATE leg. It is surfaced in app chrome (the title-bar UpdateChip),
 * NOT in the Settings surface. Settings holds only the update POLICY (the
 * "check automatically" toggle). The check/download/restart ACTIONS are verbs
 * (the chip + the app menu's "Check for Updates..."), not settings.
 */

import { create } from 'zustand';
import { updateService } from '../../../../platform/update/browser/updateService.js';
import type { UpdateState } from '../../../../platform/update/common/update.js';

export type UpdateUiState = UpdateState;

export const useUpdateStore = create<{ state: UpdateState }>(() => ({
  state: { phase: 'idle' },
}));

let updateBridgeWired = false;

/** Idempotent: seed the mirror once and subscribe to pushes. Workbench calls this at
 *  startup so a check that resolved before the UI mounted is never missed. */
export function wireUpdateBridge(): void {
  if (updateBridgeWired) return;
  updateBridgeWired = true;
  void updateService.getState().then((state) => useUpdateStore.setState({ state }));
  updateService.onState((state) => useUpdateStore.setState({ state }));
}

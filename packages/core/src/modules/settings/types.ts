/**
 * Settings module contracts. The settings store is a single machine-LOCAL
 * `settings.json` in the config dir (NOT in `.bh/`, NOT in git): a personal
 * preference layer keyed, for workspace-scoped settings, by absolute workspace
 * path — the same "per-workspace, per-machine" shape as window-state.json.
 *
 *   {
 *     "version": 1,
 *     "global": { "editor.readingMode": true },
 *     "workspaces": { "/users/x/notes": { "editor.readingMode": false } }
 *   }
 *
 * Workspace keys are lowercased absolute paths (path = identity, compared
 * case-insensitively, matching the workspaces registry).
 */

import type { SettingDescriptor, SettingScope, SettingType, SettingValue } from './registry.js';

export interface SettingsFile {
  readonly version: 1;
  /** Global-layer values, keyed by setting key. */
  readonly global: Readonly<Record<string, SettingValue>>;
  /** Per-workspace override values: workspaceKey → (settingKey → value). */
  readonly workspaces: Readonly<Record<string, Readonly<Record<string, SettingValue>>>>;
}

export const EMPTY_SETTINGS: SettingsFile = Object.freeze({
  version: 1,
  // Deep-frozen: readSettings returns this shared singleton on the missing/corrupt
  // path, so its nested maps must not be mutable (a future writer that mutated in
  // place — instead of spreading a copy — would corrupt every later read).
  global: Object.freeze({}),
  workspaces: Object.freeze({}),
});

/** Per-layer view of one setting — the shape mirrors VS Code's `inspect()`:
 *  each layer is exposed separately plus the merged effective `value`. */
export interface SettingInspect {
  readonly key: string;
  readonly scope: SettingScope;
  readonly type: SettingType;
  readonly defaultValue: SettingValue;
  /** The global-layer value, if set (and valid). */
  readonly globalValue?: SettingValue;
  /** The current workspace's override, if a workspace is bound and it's set. */
  readonly workspaceValue?: SettingValue;
  /** Effective value: `workspaceValue ?? globalValue ?? defaultValue`. */
  readonly value: SettingValue;
}

// ── Command args / results ──────────────────────────────────────────────────

export interface SettingsDescribeArgs {
  readonly _?: never;
}
/** Every registered setting's descriptor — drives a settings UI generically. */
export type SettingsDescribeResult = readonly SettingDescriptor[];

export interface SettingsInspectArgs {
  readonly key: string;
}
export type SettingsInspectResult = SettingInspect;

export interface SettingsGetArgs {
  readonly key: string;
}
export type SettingsGetResult = SettingValue;

export interface SettingsSetGlobalArgs {
  readonly key: string;
  readonly value: SettingValue;
}
export type SettingsSetGlobalResult = SettingInspect;

export interface SettingsSetWorkspaceArgs {
  readonly key: string;
  readonly value: SettingValue;
}
export type SettingsSetWorkspaceResult = SettingInspect;

export interface SettingsClearWorkspaceArgs {
  readonly key: string;
}
export type SettingsClearWorkspaceResult = SettingInspect;

/** Thrown when a command references a key no setting is registered for. */
export class UnknownSetting extends Error {
  override readonly name = 'UnknownSetting';
  constructor(public readonly key: string) {
    super(`Unknown setting: ${key}`);
  }
}

/** Thrown when a write's value doesn't match the setting's declared type, or
 *  when a per-workspace override is attempted on a global-only setting. */
export class InvalidSettingValue extends Error {
  override readonly name = 'InvalidSettingValue';
}

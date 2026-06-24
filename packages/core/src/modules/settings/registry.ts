/**
 * The declarative settings registry — the single source of truth for every app
 * setting BaseHalf exposes. A setting is DECLARED here (key, scope, type,
 * default, UI metadata); the store and commands are generic over the registry,
 * so adding a setting is ONE entry — not a new plumbing run end-to-end (the
 * pain the old hand-wired prefs path had: interface + defaults + sanitizer +
 * IPC + preload + UI per field).
 *
 * Scope is the two-layer model distilled from VS Code's `ConfigurationScope`
 * (8 scopes / 8 targets there → 2 layers here, taking the core idea without the
 * machinery):
 *   - 'global'    — only the global layer may set it (an app-shell preference,
 *                   like VS Code's APPLICATION scope). No per-workspace override.
 *   - 'workspace' — a global DEFAULT plus an optional per-workspace OVERRIDE
 *                   (VS Code's WINDOW/RESOURCE scope).
 * The effective value is `workspaceValue ?? globalValue ?? default`.
 *
 * To add a value TYPE later (enum / number / string): widen `SettingType` +
 * `SettingValue` and add a case to `isValidValue` — nothing else changes.
 */

export type SettingScope = 'global' | 'workspace';

/** The value types a setting may hold. Widen as settings need it. */
export type SettingType = 'boolean';

/** The union of all setting value types. Widen alongside `SettingType`. */
export type SettingValue = boolean;

export interface SettingDescriptor {
  /** Dotted, namespaced key (e.g. `editor.readingMode`). Stable contract. */
  readonly key: string;
  /** Which layers may set it — see the scope model above. */
  readonly scope: SettingScope;
  /** Value type, used to validate writes and reject corrupt stored values. */
  readonly type: SettingType;
  /** The bottom layer — returned when neither global nor workspace sets it. */
  readonly default: SettingValue;
  /** Short human label for the settings UI. */
  readonly label: string;
  /** One-line explanation for the settings UI. */
  readonly description: string;
}

/**
 * The built-in settings. The first one wires Reading mode (the ADHD reading
 * aids) to a per-workspace toggle, defaulting OFF so it never surprises an
 * editing session — turning it on per project is the deliberate gesture.
 */
export const SETTINGS: readonly SettingDescriptor[] = Object.freeze([
  {
    key: 'editor.readingMode',
    scope: 'workspace',
    type: 'boolean',
    default: false,
    label: 'Reading mode',
    description:
      'Highlight keywords and track your place as you read a note — finished paragraphs fade so what is left stands out.',
  },
]);

const BY_KEY = new Map<string, SettingDescriptor>(SETTINGS.map((s) => [s.key, s]));

/** The descriptor for `key`, or `undefined` if no setting is registered for it. */
export function getDescriptor(key: string): SettingDescriptor | undefined {
  return BY_KEY.get(key);
}

/** True when `value` is a valid instance of the descriptor's declared type.
 *  Used both to validate writes and to discard a corrupt/forward-version value
 *  on read (so it degrades to the next layer rather than poisoning a lookup). */
export function isValidValue(d: SettingDescriptor, value: unknown): value is SettingValue {
  switch (d.type) {
    case 'boolean':
      return typeof value === 'boolean';
    default: {
      // Exhaustiveness guard: adding a SettingType without a case here fails to
      // compile (the "widen the type in one place" promise, enforced).
      const _exhaustive: never = d.type;
      return _exhaustive;
    }
  }
}

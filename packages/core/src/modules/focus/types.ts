/**
 * Focus signal — the file the agent reads on every message to know what
 * the user is currently focused on. Published to <workspace>/.bh/focus.md
 * (Markdown, not JSON, so agents paste it into context without translation).
 *
 * Schema: SR-v0 §3.3.
 */

export interface FocusSetArgs {
  /** Explicit file list. Empty array clears focus. */
  readonly files?: readonly string[];
  /** Or, point at a saved view; its members become the active list. */
  readonly viewId?: string;
}
export interface FocusSetResult {
  readonly active: readonly string[];
}

export type FocusGetArgs = Record<string, never>;
export interface FocusGetResult {
  readonly active: readonly string[];
}

export type FocusClearArgs = Record<string, never>;
export interface FocusClearResult {
  readonly cleared: true;
}

export type FocusInitArgs = Record<string, never>;
export interface FocusInitResult {
  /** True when this call wrote the empty template; false when it was already
   *  present and we left it alone. */
  readonly created: boolean;
}
